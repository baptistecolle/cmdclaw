import { Sandbox } from "e2b";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { skill } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { downloadFromS3 } from "@/server/storage/s3-client";

// Use custom template with npm + claude CLI pre-installed
const TEMPLATE_NAME = env.E2B_TEMPLATE || "bap-agent-dev";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Cache of active sandboxes by conversation ID
const activeSandboxes = new Map<string, Sandbox>();

export interface SandboxConfig {
  conversationId: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
}

// SDK stream-json output types (base event structure)
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id?: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
    }>;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  total_cost_usd?: number;
  error?: string;
}

// SDK Agent events (superset of ClaudeStreamEvent)
export interface SDKAgentEvent extends ClaudeStreamEvent {
  // Additional fields for approval flow
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
  command?: string;
}

// Get the active sandbox for a conversation (used by approval endpoint)
export function getActiveSandbox(conversationId: string): Sandbox | undefined {
  return activeSandboxes.get(conversationId);
}

/**
 * Get or create a sandbox for a conversation
 */
export async function getOrCreateSandbox(config: SandboxConfig): Promise<Sandbox> {
  // Check if we have an active sandbox for this conversation
  let sandbox = activeSandboxes.get(config.conversationId);

  if (sandbox) {
    // Verify sandbox is still alive
    try {
      await sandbox.commands.run("echo alive", { timeoutMs: 5000 });
      return sandbox;
    } catch {
      // Sandbox is dead, remove from cache and create new one
      activeSandboxes.delete(config.conversationId);
    }
  }

  // Create new sandbox
  const hasApiKey = !!config.anthropicApiKey;
  console.log("[E2B] Creating sandbox from template:", TEMPLATE_NAME);
  console.log("[E2B] API key:", hasApiKey ? "present" : "MISSING");

  sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      ...config.integrationEnvs,
    },
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  // Cache the sandbox
  activeSandboxes.set(config.conversationId, sandbox);

  return sandbox;
}


/**
 * Kill a sandbox for a conversation
 */
export async function killSandbox(conversationId: string): Promise<void> {
  const sandbox = activeSandboxes.get(conversationId);
  if (sandbox) {
    try {
      await sandbox.kill();
    } catch (error) {
      console.error("[E2B] Failed to kill sandbox:", error);
    }
    activeSandboxes.delete(conversationId);
  }
}

/**
 * Cleanup all sandboxes (call on server shutdown)
 */
export async function cleanupAllSandboxes(): Promise<void> {
  const promises = Array.from(activeSandboxes.values()).map((sandbox) =>
    sandbox.kill().catch(console.error)
  );
  await Promise.all(promises);
  activeSandboxes.clear();
}

/**
 * Check if E2B is configured
 */
export function isE2BConfigured(): boolean {
  return !!env.E2B_API_KEY;
}

/**
 * Write user's skills to the sandbox
 * Skills are written to /app/.claude/skills/<skill-name>/
 */
export async function writeSkillsToSandbox(
  sandbox: Sandbox,
  userId: string
): Promise<string[]> {
  // Fetch all enabled skills for user with their files and documents
  const skills = await db.query.skill.findMany({
    where: and(eq(skill.userId, userId), eq(skill.enabled, true)),
    with: {
      files: true,
      documents: true,
    },
  });

  if (skills.length === 0) {
    return [];
  }

  console.log(`[E2B] Writing ${skills.length} skills to sandbox`);

  // Create skills directory
  await sandbox.commands.run("mkdir -p /app/.claude/skills");

  const writtenSkills: string[] = [];

  for (const s of skills) {
    const skillDir = `/app/.claude/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    // Write skill files (text-based, stored in DB)
    for (const file of s.files) {
      const filePath = `${skillDir}/${file.path}`;

      // Create parent directories if needed (for nested paths like scripts/helper.py)
      const lastSlash = filePath.lastIndexOf("/");
      const parentDir = filePath.substring(0, lastSlash);
      if (parentDir !== skillDir) {
        await sandbox.commands.run(`mkdir -p "${parentDir}"`);
      }

      // Write the file
      await sandbox.files.write(filePath, file.content);
    }

    // Write skill documents (binary files from S3) at the same level as skill files
    for (const doc of s.documents) {
      try {
        // Download document from S3
        const buffer = await downloadFromS3(doc.storageKey);
        const docPath = `${skillDir}/${doc.filename}`;

        // Write to sandbox (convert Buffer to ArrayBuffer for e2b)
        const arrayBuffer = new Uint8Array(buffer).buffer;
        await sandbox.files.write(docPath, arrayBuffer);
        console.log(`[E2B] Written document: ${doc.filename} (${doc.sizeBytes} bytes)`);
      } catch (error) {
        console.error(`[E2B] Failed to write document ${doc.filename}:`, error);
        // Continue with other documents even if one fails
      }
    }

    writtenSkills.push(s.name);
    console.log(`[E2B] Written skill: ${s.name} (${s.files.length} files, ${s.documents.length} documents)`);
  }

  return writtenSkills;
}

/**
 * Get the system prompt addition for skills
 */
export function getSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return `
# Custom Skills

You have access to custom skills in /app/.claude/skills/. Each skill directory contains:
- A SKILL.md file with instructions
- Any associated documents (PDFs, images, etc.) at the same level

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

export interface RunSDKAgentOptions {
  model?: string;
  resume?: string;
  systemPrompt?: string;
}

/**
 * Run SDK Agent in the sandbox with real-time streaming
 */
export async function* runSDKAgentInSandbox(
  sandbox: Sandbox,
  prompt: string,
  options?: RunSDKAgentOptions
): AsyncGenerator<SDKAgentEvent, void, unknown> {
  // Create a queue for events
  const eventQueue: SDKAgentEvent[] = [];
  let resolveWait: (() => void) | null = null;
  let isComplete = false;
  let error: Error | null = null;

  // Buffer for partial JSON lines
  let buffer = "";

  // Process incoming stdout data
  const processStdout = (data: string) => {
    buffer += data;

    // Process complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as SDKAgentEvent;
        eventQueue.push(event);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      } catch (e) {
        // Not valid JSON, might be other output
        console.log("[E2B SDK stdout]:", line);
      }
    }
  };

  // Build agent config
  const agentConfig = {
    prompt,
    model: options?.model,
    resume: options?.resume,
    systemPrompt: options?.systemPrompt,
  };

  // Write config to a file (more reliable than env var for large prompts)
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2);
  const configFile = `/tmp/agent-config-${timestamp}-${randomId}.json`;
  await sandbox.files.write(configFile, JSON.stringify(agentConfig));

  // Debug: Log prompt
  console.log("[E2B SDK] User prompt:", prompt.slice(0, 500));

  // Build the command - read config from file and pass to agent runner
  const command = `AGENT_CONFIG="$(cat ${configFile})" NODE_PATH=$(npm root -g) npx tsx /app/agent-runner.ts`;

  console.log("[E2B SDK] Running SDK agent");

  // Start the command (don't await - we want to stream)
  const runPromise = sandbox.commands.run(command, {
    timeoutMs: 0, // No timeout for long-running operations
    onStdout: processStdout,
    onStderr: (data) => {
      console.error("[E2B SDK stderr]:", data);
    },
  });

  // Handle completion
  runPromise
    .then((result) => {
      console.log("[E2B SDK] Agent completed:", {
        exitCode: result.exitCode,
        stdout: result.stdout?.slice(0, 500),
        stderr: result.stderr,
      });
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as SDKAgentEvent;
          eventQueue.push(event);
        } catch (e) {
          console.log("[E2B SDK final stdout]:", buffer);
        }
      }
      isComplete = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    })
    .catch((err: any) => {
      console.error("[E2B SDK] Agent failed:", {
        message: err.message,
        exitCode: err.result?.exitCode,
        stdout: err.result?.stdout?.slice(0, 1000),
        stderr: err.result?.stderr,
      });
      error = err;
      isComplete = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

  // Yield events as they arrive
  while (true) {
    // Yield all queued events
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    // Check if we're done
    if (isComplete) {
      if (error) {
        throw error;
      }
      break;
    }

    // Wait for more events
    await new Promise<void>((resolve) => {
      resolveWait = resolve;
      // Also resolve after a short timeout to check for completion
      setTimeout(resolve, 100);
    });
  }
}

/**
 * Write an approval response to the sandbox for the SDK agent to read
 */
export async function writeApprovalResponse(
  sandbox: Sandbox,
  toolUseId: string,
  decision: "allow" | "deny"
): Promise<void> {
  const response = { toolUseId, decision };
  await sandbox.files.write(
    "/tmp/approval-response.json",
    JSON.stringify(response)
  );
  console.log("[E2B SDK] Wrote approval response:", response);
}

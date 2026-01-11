import { Sandbox } from "e2b";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { skill } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";

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

// Claude CLI stream-json output types
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

export interface RunClaudeOptions {
  model?: string;
  resume?: string;
  systemPrompt?: string;
}

/**
 * Run Claude Code in the sandbox with real-time streaming
 */
export async function* runClaudeInSandbox(
  sandbox: Sandbox,
  prompt: string,
  options?: RunClaudeOptions
): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
  // Create a queue for events
  const eventQueue: ClaudeStreamEvent[] = [];
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
        const event = JSON.parse(line) as ClaudeStreamEvent;
        eventQueue.push(event);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      } catch (e) {
        // Not valid JSON, might be other output
        console.log("[E2B stdout]:", line);
      }
    }
  };

  // Write prompt to a temp file to avoid shell escaping issues
  // Use a unique filename to avoid permission issues on multi-turn conversations
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).slice(2);
  const promptFile = `/tmp/prompt-${timestamp}-${randomId}.txt`;
  await sandbox.files.write(promptFile, prompt);

  // Debug: Log prompt
  console.log("[E2B] User prompt:", prompt.slice(0, 500));

  // Build the command
  let command = `cat ${promptFile} | claude -p --dangerously-skip-permissions --output-format stream-json --verbose`;

  if (options?.model) {
    command += ` --model ${options.model}`;
  }

  if (options?.resume) {
    command += ` --resume ${options.resume}`;
  }

  // Add system prompt if provided
  if (options?.systemPrompt) {
    const systemPromptFile = `/tmp/system-${timestamp}-${randomId}.txt`;
    await sandbox.files.write(systemPromptFile, options.systemPrompt);
    command += ` --system-prompt "$(cat ${systemPromptFile})"`;
    console.log("[E2B] System prompt:", options.systemPrompt.slice(0, 500));
  }

  console.log("[E2B] Running command:", command.slice(0, 300));

  // Start the command (don't await - we want to stream)
  const runPromise = sandbox.commands.run(command, {
    timeoutMs: 0, // No timeout for long-running operations
    onStdout: processStdout,
    onStderr: (data) => {
      console.error("[E2B stderr]:", data);
    },
  });

  // Handle completion
  runPromise
    .then((result) => {
      console.log("[E2B] Command completed:", {
        exitCode: result.exitCode,
        stdout: result.stdout?.slice(0, 500),
        stderr: result.stderr,
      });
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as ClaudeStreamEvent;
          eventQueue.push(event);
        } catch (e) {
          console.log("[E2B final stdout]:", buffer);
        }
      }
      isComplete = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    })
    .catch((err: any) => {
      console.error("[E2B] Command failed:", {
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
  // Fetch all enabled skills for user with their files
  const skills = await db.query.skill.findMany({
    where: and(eq(skill.userId, userId), eq(skill.enabled, true)),
    with: {
      files: true,
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

    writtenSkills.push(s.name);
    console.log(`[E2B] Written skill: ${s.name} (${s.files.length} files)`);
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

You have access to custom skills in /app/.claude/skills/. Each skill directory contains a SKILL.md file with instructions.

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

import { Sandbox } from "e2b";
import fs from "fs/promises";
import path from "path";
import { env } from "@/env";

const TEMPLATE_NAME = "anthropic-claude-code";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Agent config directory (local)
const AGENT_CONFIG_DIR = "claude-agent";

// Sandbox paths
const SANDBOX_CLAUDE_DIR = "/home/user/.claude";
const SANDBOX_SKILLS_DIR = `${SANDBOX_CLAUDE_DIR}/skills`;

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
  console.log("[E2B] Creating sandbox with API key:", hasApiKey ? "present" : "MISSING");

  sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      ...config.integrationEnvs,
    },
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  // Verify the env var is set in the sandbox
  const checkEnv = await sandbox.commands.run("echo $ANTHROPIC_API_KEY | head -c 20", { timeoutMs: 5000 });
  console.log("[E2B] API key in sandbox:", checkEnv.stdout ? "set" : "NOT SET");

  // Setup skills directory
  await setupSkillsInSandbox(sandbox);

  // Cache the sandbox
  activeSandboxes.set(config.conversationId, sandbox);

  return sandbox;
}

/**
 * Setup agent config (settings and skills) in the sandbox
 */
async function setupSkillsInSandbox(sandbox: Sandbox): Promise<void> {
  const agentDir = path.join(process.cwd(), AGENT_CONFIG_DIR);
  const skillsDir = path.join(agentDir, "skills");

  try {
    // Create the .claude directory structure
    await sandbox.commands.run(`mkdir -p ${SANDBOX_SKILLS_DIR}`, { timeoutMs: 10000 });

    // Sync settings.local.json if it exists
    const settingsPath = path.join(agentDir, "settings.local.json");
    try {
      const settingsContent = await fs.readFile(settingsPath, "utf-8");
      await sandbox.files.write(`${SANDBOX_CLAUDE_DIR}/settings.local.json`, settingsContent);
      console.log("[E2B] Settings synced to sandbox");
    } catch {
      // Settings file doesn't exist, skip
    }

    // Read local skills directory
    const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of skillEntries) {
      if (entry.isDirectory()) {
        const skillName = entry.name;
        const skillPath = path.join(skillsDir, skillName);
        const sandboxSkillPath = `${SANDBOX_SKILLS_DIR}/${skillName}`;

        // Create skill directory in sandbox
        await sandbox.commands.run(`mkdir -p ${sandboxSkillPath}`, { timeoutMs: 10000 });

        // Sync skill files
        await syncDirectoryToSandbox(sandbox, skillPath, sandboxSkillPath);
      }
    }

    console.log("[E2B] Skills synced to sandbox");
  } catch (error) {
    console.error("[E2B] Failed to setup agent config in sandbox:", error);
  }
}

/**
 * Recursively sync a local directory to the sandbox
 */
async function syncDirectoryToSandbox(
  sandbox: Sandbox,
  localPath: string,
  sandboxPath: string
): Promise<void> {
  const entries = await fs.readdir(localPath, { withFileTypes: true });

  for (const entry of entries) {
    const localEntryPath = path.join(localPath, entry.name);
    const sandboxEntryPath = `${sandboxPath}/${entry.name}`;

    if (entry.isDirectory()) {
      await sandbox.commands.run(`mkdir -p "${sandboxEntryPath}"`, { timeoutMs: 10000 });
      await syncDirectoryToSandbox(sandbox, localEntryPath, sandboxEntryPath);
    } else if (entry.isFile()) {
      const content = await fs.readFile(localEntryPath, "utf-8");
      await sandbox.files.write(sandboxEntryPath, content);
    }
  }
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
  const promptFile = "/tmp/prompt.txt";
  await sandbox.files.write(promptFile, prompt);

  // Build the command
  let command = `cat ${promptFile} | claude -p --dangerously-skip-permissions --output-format stream-json --verbose`;

  if (options?.model) {
    command += ` --model ${options.model}`;
  }

  if (options?.resume) {
    command += ` --resume ${options.resume}`;
  }

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

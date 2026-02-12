/**
 * Local sandbox execution for the Bap daemon.
 * Runs commands in isolated workspace directories using Bun.spawn().
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { logger } from "./logger";
import { getSandboxDir } from "./config";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// Active sandbox working directories
const sandboxes = new Map<string, string>();

/**
 * Set up a sandbox workspace for a conversation.
 */
export function setupSandbox(conversationId: string, workDir?: string): string {
  const dir = workDir || getSandboxDir(conversationId);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  sandboxes.set(conversationId, dir);
  logger.info("sandbox", `Set up sandbox at ${dir}`, { conversationId });
  return dir;
}

/**
 * Execute a shell command in the sandbox.
 */
export async function executeCommand(
  command: string,
  opts?: {
    conversationId?: string;
    timeout?: number;
    env?: Record<string, string>;
  },
): Promise<ExecResult> {
  const cwd = opts?.conversationId
    ? sandboxes.get(opts.conversationId) || getSandboxDir(opts.conversationId)
    : process.cwd();

  const timeout = opts?.timeout || DEFAULT_TIMEOUT_MS;

  logger.debug("sandbox", `Executing: ${command.slice(0, 200)}`, { cwd });

  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
      env: {
        ...process.env,
        ...opts?.env,
        // Sandbox isolation
        HOME: cwd,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    // Wait for completion
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    logger.debug("sandbox", `Exit code: ${exitCode}`, {
      stdout: stdout.slice(0, 200),
      stderr: stderr.slice(0, 200),
    });

    return { exitCode, stdout, stderr };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    logger.error("sandbox", `Execution error: ${errorMsg}`);
    return { exitCode: 1, stdout: "", stderr: errorMsg };
  }
}

/**
 * Write a file in the sandbox.
 */
export function writeFile(path: string, content: string): void {
  const resolved = resolve(path);

  // Ensure parent directory exists
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(resolved, content, "utf-8");
  logger.debug("sandbox", `Wrote file: ${resolved}`);
}

/**
 * Read a file from the sandbox.
 */
export function readFile(path: string): string {
  const resolved = resolve(path);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  return readFileSync(resolved, "utf-8");
}

/**
 * Tear down a sandbox.
 */
export function teardownSandbox(conversationId: string): void {
  sandboxes.delete(conversationId);
  logger.info("sandbox", `Torn down sandbox for ${conversationId}`);
}

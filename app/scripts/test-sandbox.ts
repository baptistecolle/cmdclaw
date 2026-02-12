#!/usr/bin/env bun
/**
 * Test script for E2B sandbox with Google Gmail and Slack integration
 *
 * Usage:
 *   bun e2b:sandbox
 *
 * Automatically loads integration tokens from the database for the configured user.
 */

import { Sandbox } from "e2b";
import { createInterface } from "readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/server/db/schema";

// Load env
import "dotenv/config";

const TEMPLATE_NAME = process.env.E2B_TEMPLATE || "bap-agent-dev";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const TEST_USER_EMAIL = "collebaptiste@gmail.com";

type IntegrationType =
  | "gmail"
  | "slack"
  | "notion"
  | "linear"
  | "github"
  | "airtable";

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  gmail: "GMAIL_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  linear: "LINEAR_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
};

function shouldUsePty(cmd: string): boolean {
  const firstToken = cmd.trim().split(/\s+/)[0]?.toLowerCase();
  return firstToken === "opencode" || firstToken === "claude";
}

function normalizeInteractiveCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstToken === "opencode") {
    return `OPENCODE_CONFIG=/app/opencode.json ${trimmed}`;
  }
  return trimmed;
}

async function runInteractiveCommandWithPty(
  sandbox: Sandbox,
  cmd: string,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      "[warn] PTY mode requires a TTY; falling back to non-interactive command mode.",
    );
    const result = await sandbox.commands.run(cmd, {
      timeoutMs: 60 * 60 * 1000,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  let stdinRawEnabled = false;
  let stdinCarry = new Uint8Array();

  const ptyHandle = await sandbox.pty.create({
    cols,
    rows,
    cwd: "/app",
    timeoutMs: 60 * 60 * 1000,
    envs: {
      COLORTERM: "truecolor",
    },
    onData: (data) => {
      process.stdout.write(Buffer.from(data));
    },
  });

  const filterProbeResponses = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdinCarry.length + chunk.length);
    merged.set(stdinCarry);
    merged.set(chunk, stdinCarry.length);
    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];

      if (b === 0x1b && i + 1 < merged.length) {
        const next = merged[i + 1];

        // OSC response (eg: ESC ] 11;rgb:.... BEL or ESC \)
        if (next === 0x5d) {
          let j = i + 2;
          while (
            j < merged.length &&
            merged[j] !== 0x07 &&
            !(
              merged[j] === 0x1b &&
              j + 1 < merged.length &&
              merged[j + 1] === 0x5c
            )
          ) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const oscPayload = decoder.decode(merged.slice(i + 2, j));
          const isOscTerminatedBySt = merged[j] === 0x1b;
          const end = isOscTerminatedBySt ? j + 1 : j;

          if (/^1[01];rgb:/i.test(oscPayload)) {
            i = end + 1;
            continue;
          }

          for (let k = i; k <= end; k += 1) out.push(merged[k]);
          i = end + 1;
          continue;
        }

        // CSI response (eg: ESC [ ? ... $y)
        if (next === 0x5b) {
          let j = i + 2;
          while (j < merged.length && (merged[j] < 0x40 || merged[j] > 0x7e)) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const finalByte = merged[j];
          const csiBody = decoder.decode(merged.slice(i + 2, j));

          if (
            finalByte === 0x79 &&
            csiBody.startsWith("?") &&
            csiBody.includes("$")
          ) {
            i = j + 1;
            continue;
          }

          for (let k = i; k <= j; k += 1) out.push(merged[k]);
          i = j + 1;
          continue;
        }
      }

      out.push(b);
      i += 1;
    }

    stdinCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const stdinHandler = (chunk: Buffer | string) => {
    if (typeof chunk === "string") {
      // Some terminal capability/color probe responses can leak as text when readline is active.
      // Ignore those so they are not injected back into the remote TUI as user input.
      if (
        /(?:^|])11;rgb:[0-9a-f/]+/i.test(chunk) ||
        /\?\d+(?:;\d+)*\$[a-z]/i.test(chunk)
      ) {
        return;
      }
    }

    const rawInput =
      typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);
    const filteredInput = filterProbeResponses(rawInput);
    if (filteredInput.length === 0) return;
    sandbox.pty.sendInput(ptyHandle.pid, filteredInput).catch(() => {});
  };

  const resizeHandler = () => {
    const nextCols = process.stdout.columns ?? cols;
    const nextRows = process.stdout.rows ?? rows;
    sandbox.pty
      .resize(ptyHandle.pid, { cols: nextCols, rows: nextRows })
      .catch(() => {});
  };

  try {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      stdinRawEnabled = true;
    }
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.stdout.on("resize", resizeHandler);

    const normalizedCommand = normalizeInteractiveCommand(cmd);
    await sandbox.pty.sendInput(
      ptyHandle.pid,
      encoder.encode(`exec env ${normalizedCommand}\n`),
    );
    const result = await ptyHandle.wait();
    return result.exitCode;
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    return 1;
  } finally {
    process.stdin.off("data", stdinHandler);
    process.stdout.off("resize", resizeHandler);
    if (stdinRawEnabled && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  }
}

async function getIntegrationTokens(
  userEmail: string,
): Promise<Record<string, string>> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    // Find user by email
    const [foundUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, userEmail))
      .limit(1);

    if (!foundUser) {
      console.error(`User not found: ${userEmail}`);
      return {};
    }

    // Get all enabled integrations with their tokens
    const results = await db
      .select({
        type: schema.integration.type,
        accessToken: schema.integrationToken.accessToken,
      })
      .from(schema.integration)
      .innerJoin(
        schema.integrationToken,
        eq(schema.integration.id, schema.integrationToken.integrationId),
      )
      .where(
        and(
          eq(schema.integration.userId, foundUser.id),
          eq(schema.integration.enabled, true),
        ),
      );

    const envVars: Record<string, string> = {};
    for (const row of results) {
      const envVar = ENV_VAR_MAP[row.type as IntegrationType];
      if (envVar) {
        envVars[envVar] = row.accessToken;
      }
    }

    return envVars;
  } finally {
    await pool.end();
  }
}

async function main() {
  // Validate required env vars
  if (!process.env.E2B_API_KEY) {
    console.error("Error: E2B_API_KEY environment variable required");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable required");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable required");
    process.exit(1);
  }

  console.log(`Loading integration tokens for ${TEST_USER_EMAIL}...`);
  const integrationEnvs = await getIntegrationTokens(TEST_USER_EMAIL);

  // Build environment variables for the sandbox
  const envs: Record<string, string> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ...integrationEnvs,
  };

  // Log which integrations are enabled
  if (integrationEnvs.GMAIL_ACCESS_TOKEN) {
    console.log("✓ Google Gmail integration enabled");
  } else {
    console.log("○ Google Gmail integration not found in database");
  }

  if (integrationEnvs.SLACK_ACCESS_TOKEN) {
    console.log("✓ Slack integration enabled");
  } else {
    console.log("○ Slack integration not found in database");
  }

  if (integrationEnvs.NOTION_ACCESS_TOKEN) {
    console.log("✓ Notion integration enabled");
  }

  if (integrationEnvs.LINEAR_ACCESS_TOKEN) {
    console.log("✓ Linear integration enabled");
  }

  if (integrationEnvs.GITHUB_ACCESS_TOKEN) {
    console.log("✓ GitHub integration enabled");
  }

  if (integrationEnvs.AIRTABLE_ACCESS_TOKEN) {
    console.log("✓ Airtable integration enabled");
  }

  console.log(`\nCreating sandbox from template: ${TEMPLATE_NAME}...`);

  const sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);
  console.log("\nAvailable CLI commands in sandbox:");
  console.log("  google-gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  claude -p <prompt>          - Run Claude Code\n");

  // Interactive REPL
  const makeReadline = () =>
    createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  let rl = makeReadline();

  const prompt = () => {
    rl.question("sandbox> ", async (input) => {
      const cmd = input.trim();

      if (!cmd) {
        prompt();
        return;
      }

      if (cmd === "exit" || cmd === "quit") {
        console.log("Killing sandbox...");
        await sandbox.kill();
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (cmd === "help") {
        console.log(`
Commands:
  <any bash command>   - Run command in sandbox
  google-gmail <cmd>   - Gmail CLI (list, get, unread, send)
  slack <cmd>          - Slack CLI (channels, history, send, search, users)
  claude -p <prompt>   - Run Claude Code
  env                  - Show environment variables
  exit/quit            - Kill sandbox and exit
`);
        prompt();
        return;
      }

      try {
        if (shouldUsePty(cmd)) {
          rl.close();
          const exitCode = await runInteractiveCommandWithPty(sandbox, cmd);
          rl = makeReadline();
          if (exitCode !== 0) {
            console.log(`\n[Exit code: ${exitCode}]`);
          }
        } else {
          const result = await sandbox.commands.run(cmd, {
            timeoutMs: 60000,
            onStdout: (data) => {
              process.stdout.write(data);
            },
            onStderr: (data) => {
              process.stderr.write(data);
            },
          });

          if (result.exitCode !== 0) {
            console.log(`\n[Exit code: ${result.exitCode}]`);
          }
        }
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
      }

      prompt();
    });
  };

  console.log('Type "help" for available commands, "exit" to quit.\n');
  prompt();

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", async () => {
    console.log("\nKilling sandbox...");
    await sandbox.kill();
    console.log("Goodbye!");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

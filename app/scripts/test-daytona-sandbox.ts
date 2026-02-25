#!/usr/bin/env bun
/**
 * Test script for Daytona sandbox with Google Gmail and Slack integration.
 *
 * Usage:
 *   bun daytona:sandbox
 *
 * Automatically loads integration tokens from the database for the configured user.
 */

import { Daytona } from "@daytonaio/sdk";
import * as dotenvConfig from "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createInterface } from "readline";
import * as schema from "../src/server/db/schema";

void dotenvConfig;

const SNAPSHOT_NAME =
  process.env.E2B_DAYTONA_SANDBOX_NAME ||
  process.env.DAYTONA_SNAPSHOT ||
  process.env.DAYTONA_SNAPSHOT_DEV ||
  "cmdclaw-agent-dev";
const SANDBOX_NAME = process.env.E2B_DAYTONA_SANDBOX_NAME || SNAPSHOT_NAME;
const DEFAULT_WORKDIR = "/app";
const TEST_USER_EMAIL = "collebaptiste@gmail.com";
const INTERACTIVE_TIMEOUT_SECONDS = 60 * 60; // 1 hour

type IntegrationType = "gmail" | "slack" | "notion" | "linear" | "github" | "airtable";

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

function buildPtyEnvs(): Record<string, string> {
  const termFromHost = process.env.TERM;
  const safeTerm =
    !termFromHost || termFromHost === "dumb" || termFromHost === "unknown"
      ? "xterm-256color"
      : termFromHost;

  const envs: Record<string, string> = {
    TERM: safeTerm,
    COLORTERM: process.env.COLORTERM || "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
  };

  if (process.env.TERM_PROGRAM) {
    envs.TERM_PROGRAM = process.env.TERM_PROGRAM;
  }
  if (process.env.TERM_PROGRAM_VERSION) {
    envs.TERM_PROGRAM_VERSION = process.env.TERM_PROGRAM_VERSION;
  }

  return envs;
}

type DaytonaPtyHandle = {
  waitForConnection: () => Promise<void>;
  sendInput: (data: string | Uint8Array) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<unknown>;
  wait: () => Promise<{ exitCode?: number; error?: string }>;
  disconnect: () => Promise<void>;
};

type DaytonaSandboxWithPty = {
  process: {
    createPty: (options: {
      id: string;
      cwd?: string;
      envs?: Record<string, string>;
      cols?: number;
      rows?: number;
      onData: (data: Uint8Array) => void | Promise<void>;
    }) => Promise<DaytonaPtyHandle>;
  };
};

async function runInteractiveCommandWithPty(
  sandbox: DaytonaSandboxWithPty,
  cmd: string,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[warn] PTY mode requires a TTY; cannot run interactive command.");
    return 1;
  }

  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let stdinRawEnabled = false;
  let stdinCarry = new Uint8Array();
  let stdoutCarry = new Uint8Array();

  const filterTerminalQueriesFromOutput = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdoutCarry.length + chunk.length);
    merged.set(stdoutCarry);
    merged.set(chunk, stdoutCarry.length);

    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];
      if (b !== 0x1b || i + 1 >= merged.length) {
        out.push(b);
        i += 1;
        continue;
      }

      const next = merged[i + 1];

      // OSC queries like ESC ] 10;? BEL and ESC ] 11;? BEL (or ESC \ terminator)
      if (next === 0x5d) {
        let j = i + 2;
        while (
          j < merged.length &&
          merged[j] !== 0x07 &&
          !(merged[j] === 0x1b && j + 1 < merged.length && merged[j + 1] === 0x5c)
        ) {
          j += 1;
        }
        if (j >= merged.length) {
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const payload = decoder.decode(merged.slice(i + 2, j));
        const isStTerminated = merged[j] === 0x1b;
        const end = isStTerminated ? j + 1 : j;
        if (/^1[01];\?/i.test(payload)) {
          i = end + 1;
          continue;
        }

        for (let k = i; k <= end; k += 1) {
          out.push(merged[k]);
        }
        i = end + 1;
        continue;
      }

      // CSI terminal queries that can trigger local terminal responses.
      if (next === 0x5b) {
        let j = i + 2;
        while (j < merged.length && (merged[j] < 0x40 || merged[j] > 0x7e)) {
          j += 1;
        }
        if (j >= merged.length) {
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const finalByte = merged[j];
        const body = decoder.decode(merged.slice(i + 2, j));
        const isCsiQuery =
          // DECRQM requests: ESC [ ? ... $ p
          (finalByte === 0x70 && body.startsWith("?") && body.includes("$")) ||
          // DSR/window/status queries: ESC [ ... n/t/u/q
          ((finalByte === 0x6e || finalByte === 0x74 || finalByte === 0x75 || finalByte === 0x71) &&
            /^[?>]?[0-9;]*\$?[a-z]?$/i.test(body));
        if (isCsiQuery) {
          i = j + 1;
          continue;
        }

        for (let k = i; k <= j; k += 1) {
          out.push(merged[k]);
        }
        i = j + 1;
        continue;
      }

      out.push(b);
      i += 1;
    }

    stdoutCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const pty = await sandbox.process.createPty({
    id: `cmdclaw-${Date.now()}`,
    cwd: DEFAULT_WORKDIR,
    envs: buildPtyEnvs(),
    cols,
    rows,
    onData: (data) => {
      const filtered = filterTerminalQueriesFromOutput(data);
      if (filtered.length > 0) {
        process.stdout.write(Buffer.from(filtered));
      }
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
            !(merged[j] === 0x1b && j + 1 < merged.length && merged[j + 1] === 0x5c)
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

          for (let k = i; k <= end; k += 1) {
            out.push(merged[k]);
          }
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

          if (finalByte === 0x79 && csiBody.includes("$")) {
            i = j + 1;
            continue;
          }

          for (let k = i; k <= j; k += 1) {
            out.push(merged[k]);
          }
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
    const rawInput = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);
    const decodedInput = decoder.decode(rawInput);
    // Some terminals can surface probe responses in plain text (without leading ESC bytes).
    // Drop these before forwarding stdin to remote PTY.
    if (
      /(?:^|[\s>])1[01];rgb:[0-9a-f/]+(?:\s|$)/i.test(decodedInput) ||
      /\d+(?:;\d+)*\$y/i.test(decodedInput)
    ) {
      return;
    }

    const filteredInput = filterProbeResponses(rawInput);
    if (filteredInput.length === 0) {
      return;
    }
    pty.sendInput(filteredInput).catch(() => {});
  };

  const resizeHandler = () => {
    const nextCols = process.stdout.columns ?? cols;
    const nextRows = process.stdout.rows ?? rows;
    pty.resize(nextCols, nextRows).catch(() => {});
  };

  try {
    await pty.waitForConnection();
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      stdinRawEnabled = true;
    }
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.stdout.on("resize", resizeHandler);

    const normalizedCommand = normalizeInteractiveCommand(cmd);
    await pty.sendInput(`exec env ${normalizedCommand}\n`);
    const result = await pty.wait();
    if (result.error) {
      console.error(result.error);
    }
    return result.exitCode ?? 0;
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    return 1;
  } finally {
    process.stdin.off("data", stdinHandler);
    process.stdout.off("resize", resizeHandler);
    if (stdinRawEnabled && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    await pty.disconnect().catch(() => {});
  }
}

function getDaytonaConfig(): {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
} {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      "Missing Daytona auth. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.",
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

async function getIntegrationTokens(userEmail: string): Promise<Record<string, string>> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const [foundUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, userEmail))
      .limit(1);

    if (!foundUser) {
      console.error(`User not found: ${userEmail}`);
      return {};
    }

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
        and(eq(schema.integration.userId, foundUser.id), eq(schema.integration.enabled, true)),
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

async function deleteExistingSandboxesWithSameName(
  daytona: Daytona,
  sandboxName: string,
  snapshotName: string,
): Promise<void> {
  const pageSize = 100;
  const matches: Array<{ id: string; name: string }> = [];

  const collectMatches = async (page: number): Promise<void> => {
    const result = await daytona.list(undefined, page, pageSize);
    const items = result.items ?? [];

    for (const sandbox of items) {
      if (sandbox.name !== sandboxName) {
        continue;
      }
      if (sandbox.snapshot && sandbox.snapshot !== snapshotName) {
        continue;
      }
      matches.push({ id: sandbox.id, name: sandbox.name });
    }

    if (result.totalPages && page < result.totalPages) {
      await collectMatches(page + 1);
    }
  };

  await collectMatches(1);

  if (matches.length === 0) {
    return;
  }

  console.log(`Found ${matches.length} existing sandbox(es) named "${sandboxName}", deleting...`);
  const deletions = await Promise.allSettled(
    matches.map(async (match) => {
      const existing = await daytona.get(match.id);
      await existing.delete();
    }),
  );

  const failures = deletions.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    console.warn(`[warn] Failed to delete ${failures.length} existing sandbox(es).`);
  } else {
    console.log("✓ Existing sandboxes deleted");
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable required");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable required");
    process.exit(1);
  }

  const daytonaConfig = getDaytonaConfig();

  console.log(`Loading integration tokens for ${TEST_USER_EMAIL}...`);
  const integrationEnvs = await getIntegrationTokens(TEST_USER_EMAIL);
  const envs: Record<string, string> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ...integrationEnvs,
  };

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

  const daytona = new Daytona(daytonaConfig);
  await deleteExistingSandboxesWithSameName(daytona, SANDBOX_NAME, SNAPSHOT_NAME);
  console.log(`\nCreating Daytona sandbox from snapshot: ${SNAPSHOT_NAME}...`);

  const sandbox = await daytona.create({
    name: SANDBOX_NAME,
    snapshot: SNAPSHOT_NAME,
    envVars: envs,
  });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    await sandbox.delete().catch(() => {});
  };

  console.log(`✓ Sandbox created: ${sandbox.id}`);
  console.log("\nAvailable CLI commands in sandbox:");
  console.log("  google-gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  opencode                  - Run OpenCode interactive CLI");
  console.log("  claude -p <prompt>          - Run Claude Code\n");

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
        await cleanup();
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
  opencode             - OpenCode interactive CLI
  claude -p <prompt>   - Run Claude Code
  env                  - Show environment variables
  exit/quit            - Kill sandbox and exit
`);
        prompt();
        return;
      }

      try {
        if (shouldUsePty(cmd)) {
          // Disable readline while interactive PTY is running to prevent probe responses
          // from being echoed by the local line editor.
          rl.close();
          const exitCode = await runInteractiveCommandWithPty(
            sandbox as unknown as DaytonaSandboxWithPty,
            cmd,
          );
          if (exitCode !== 0) {
            console.log(`\n[Exit code: ${exitCode}]`);
          }
          rl = makeReadline();
          prompt();
          return;
        }

        const result = (await sandbox.process.executeCommand(
          cmd,
          DEFAULT_WORKDIR,
          undefined,
          INTERACTIVE_TIMEOUT_SECONDS,
        )) as {
          exitCode?: number;
          result?: string;
          stdout?: string;
          stderr?: string;
          artifacts?: { stdout?: string };
        };

        const stdout = result.stdout ?? result.result ?? result.artifacts?.stdout ?? "";
        if (stdout) {
          process.stdout.write(stdout);
          if (!stdout.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }
        if (result.stderr) {
          process.stderr.write(result.stderr);
          if (!result.stderr.endsWith("\n")) {
            process.stderr.write("\n");
          }
        }

        if ((result.exitCode ?? 0) !== 0) {
          console.log(`\n[Exit code: ${result.exitCode}]`);
        }
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
      }

      prompt();
    });
  };

  console.log('Type "help" for available commands, "exit" to quit.\n');
  prompt();

  process.on("SIGINT", async () => {
    console.log("\nKilling sandbox...");
    await cleanup();
    console.log("Goodbye!");
    rl.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

#!/usr/bin/env bun
/**
 * Test script for E2B sandbox with Gmail and Slack integration
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

type IntegrationType = "gmail" | "slack" | "notion" | "linear" | "github" | "airtable";

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  gmail: "GMAIL_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  linear: "LINEAR_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
};

async function getIntegrationTokens(userEmail: string): Promise<Record<string, string>> {
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
        eq(schema.integration.id, schema.integrationToken.integrationId)
      )
      .where(
        and(
          eq(schema.integration.userId, foundUser.id),
          eq(schema.integration.enabled, true)
        )
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
    console.log("✓ Gmail integration enabled");
  } else {
    console.log("○ Gmail integration not found in database");
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
  console.log("  gmail list|get|unread|send  - Gmail operations");
  console.log("  slack channels|history|send|search|users - Slack operations");
  console.log("  claude -p <prompt>          - Run Claude Code\n");

  // Interactive REPL
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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
  gmail <cmd>          - Gmail CLI (list, get, unread, send)
  slack <cmd>          - Slack CLI (channels, history, send, search, users)
  claude -p <prompt>   - Run Claude Code
  env                  - Show environment variables
  exit/quit            - Kill sandbox and exit
`);
        prompt();
        return;
      }

      try {
        const result = await sandbox.commands.run(cmd, {
          timeoutMs: 60000,
          onStdout: (data) => { process.stdout.write(data); },
          onStderr: (data) => { process.stderr.write(data); },
        });

        if (result.exitCode !== 0) {
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

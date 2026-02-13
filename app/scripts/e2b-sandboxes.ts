#!/usr/bin/env bun

import * as dotenvConfig from "dotenv/config";
import { Sandbox } from "e2b";

void dotenvConfig;

type SandboxRecord = {
  sandboxId?: string;
  id?: string;
  templateId?: string;
  startedAt?: string | Date;
};

async function fetchSandboxes(): Promise<SandboxRecord[]> {
  const sandboxApi = Sandbox as unknown as {
    list?: () => {
      hasNext: boolean;
      nextItems: () => Promise<SandboxRecord[]>;
    };
  };

  if (!sandboxApi.list) {
    throw new Error("Sandbox.list is not available in this E2B SDK version.");
  }

  const paginator = sandboxApi.list();

  async function collectPages(acc: SandboxRecord[]): Promise<SandboxRecord[]> {
    if (!paginator.hasNext) {
      return acc;
    }

    const page = await paginator.nextItems();
    return collectPages([...acc, ...page]);
  }

  return collectPages([]);
}

function getSandboxId(sandbox: SandboxRecord): string | null {
  if (sandbox.sandboxId && sandbox.sandboxId.length > 0) {
    return sandbox.sandboxId;
  }

  if (sandbox.id && sandbox.id.length > 0) {
    return sandbox.id;
  }

  return null;
}

async function killSandboxById(sandboxId: string): Promise<void> {
  const sandboxApi = Sandbox as unknown as {
    kill?: (id: string) => Promise<void>;
    connect?: (id: string) => Promise<{ kill: () => Promise<void> }>;
  };

  if (sandboxApi.kill) {
    await sandboxApi.kill(sandboxId);
    return;
  }

  if (sandboxApi.connect) {
    const sandbox = await sandboxApi.connect(sandboxId);
    await sandbox.kill();
    return;
  }

  throw new Error("Neither Sandbox.kill nor Sandbox.connect is available in this E2B SDK version.");
}

async function listCommand(): Promise<void> {
  const sandboxes = await fetchSandboxes();

  console.log(`Found ${sandboxes.length} sandbox(es).`);
  for (const sandbox of sandboxes) {
    const sandboxId = getSandboxId(sandbox) ?? "<unknown-id>";
    const templateId = sandbox.templateId ?? "<unknown-template>";
    const startedAt = sandbox.startedAt ?? "<unknown-start-time>";
    console.log(`- ${sandboxId} (template: ${templateId}, startedAt: ${startedAt})`);
  }
}

async function killAllCommand(): Promise<void> {
  const sandboxes = await fetchSandboxes();

  if (sandboxes.length === 0) {
    console.log("No active sandboxes to kill.");
    return;
  }

  const results = await Promise.all(
    sandboxes.map(async (sandbox) => {
      const sandboxId = getSandboxId(sandbox);
      if (!sandboxId) {
        console.error("Failed: sandbox has no id.");
        return { killed: 0, failed: 1 };
      }

      try {
        await killSandboxById(sandboxId);
        console.log(`Killed ${sandboxId}`);
        return { killed: 1, failed: 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to kill ${sandboxId}: ${message}`);
        return { killed: 0, failed: 1 };
      }
    }),
  );

  const killed = results.reduce((acc, result) => acc + result.killed, 0);
  const failed = results.reduce((acc, result) => acc + result.failed, 0);

  console.log(`Done. Killed: ${killed}, Failed: ${failed}`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "list";

  if (!process.env.E2B_API_KEY) {
    console.error("E2B_API_KEY is required.");
    process.exit(1);
  }

  switch (command) {
    case "list":
      await listCommand();
      break;
    case "kill-all":
      await killAllCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage: bun scripts/e2b-sandboxes.ts [list|kill-all]");
      process.exit(1);
  }
}

await main();

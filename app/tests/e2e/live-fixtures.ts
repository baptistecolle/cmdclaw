import { test as base, expect } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { Sandbox } from "e2b";
import { db } from "../../src/server/db/client";
import { generation } from "../../src/server/db/schema";
import { resolveLiveE2EModel } from "./live-chat-model";

type LiveFixtures = {
  e2bSandboxCleanup: void;
};
type LiveWorkerFixtures = {
  liveChatModel: string;
};

function collectNestedStringFields(payload: unknown, fieldName: string): string[] {
  const values = new Set<string>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (key === fieldName && typeof value === "string" && value.trim().length > 0) {
        values.add(value);
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return Array.from(values);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  }
}

export const test = base.extend<LiveFixtures, LiveWorkerFixtures>({
  liveChatModel: [
    async ({}, provideModel) => {
      const model = await resolveLiveE2EModel();
      await provideModel(model);
    },
    { scope: "worker" },
  ],
  e2bSandboxCleanup: [
    async ({ page }, provideCleanup) => {
      const conversationIds = new Set<string>();
      const generationIds = new Set<string>();
      const onResponse = (response: {
        url: () => string;
        request: () => { method: () => string };
        json: () => Promise<unknown>;
      }) => {
        if (!response.url().includes("startGeneration")) {
          return;
        }
        if (response.request().method() !== "POST") {
          return;
        }
        response
          .json()
          .then((payload) => {
            for (const id of collectNestedStringFields(payload, "conversationId")) {
              conversationIds.add(id);
            }
            for (const id of collectNestedStringFields(payload, "generationId")) {
              generationIds.add(id);
            }
          })
          .catch(() => {});
      };

      page.on("response", onResponse);
      await provideCleanup();
      page.off("response", onResponse);

      if ((conversationIds.size === 0 && generationIds.size === 0) || !process.env.E2B_API_KEY) {
        return;
      }

      const resolveSandboxIds = async (attempt: number): Promise<string[]> => {
        const [rowsByGeneration, rowsByConversation] = await Promise.all([
          generationIds.size > 0
            ? db.query.generation.findMany({
                where: inArray(generation.id, Array.from(generationIds)),
                columns: { sandboxId: true },
              })
            : Promise.resolve([]),
          conversationIds.size > 0
            ? db.query.generation.findMany({
                where: inArray(generation.conversationId, Array.from(conversationIds)),
                columns: { sandboxId: true },
              })
            : Promise.resolve([]),
        ]);

        const sandboxIds = Array.from(
          new Set(
            [...rowsByGeneration, ...rowsByConversation]
              .map((row) => row.sandboxId)
              .filter((sandboxId): sandboxId is string => Boolean(sandboxId)),
          ),
        );

        if (sandboxIds.length > 0 || attempt >= 5) {
          return sandboxIds;
        }

        await sleep(1_000);
        return resolveSandboxIds(attempt + 1);
      };

      const sandboxIds = await resolveSandboxIds(0);

      if (sandboxIds.length === 0) {
        console.warn(
          `[live-e2e] no sandbox IDs found for cleanup (generationIds=${generationIds.size}, conversationIds=${conversationIds.size})`,
        );
        return;
      }

      await Promise.allSettled(
        sandboxIds.map(async (sandboxId) => {
          try {
            await killSandboxById(sandboxId);
            console.log(`[live-e2e] killed sandbox ${sandboxId}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[live-e2e] failed to kill sandbox ${sandboxId}: ${msg}`);
          }
        }),
      );
    },
    { auto: true },
  ],
});

export { expect };

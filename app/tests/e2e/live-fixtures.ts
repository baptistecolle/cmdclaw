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
      const onResponse = (response: {
        url: () => string;
        request: () => { method: () => string };
        json: () => Promise<unknown>;
      }) => {
        if (!response.url().includes("/api/rpc/generation/startGeneration")) {
          return;
        }
        if (response.request().method() !== "POST") {
          return;
        }
        response
          .json()
          .then((payload) => {
            const id =
              payload &&
              typeof payload === "object" &&
              "conversationId" in payload &&
              typeof payload.conversationId === "string"
                ? payload.conversationId
                : null;
            if (id) {
              conversationIds.add(id);
            }
          })
          .catch(() => {});
      };

      page.on("response", onResponse);
      await provideCleanup();
      page.off("response", onResponse);

      if (conversationIds.size === 0 || !process.env.E2B_API_KEY) {
        return;
      }

      const rows = await db.query.generation.findMany({
        where: inArray(generation.conversationId, Array.from(conversationIds)),
        columns: { sandboxId: true },
      });
      const sandboxIds = Array.from(
        new Set(
          rows
            .map((row) => row.sandboxId)
            .filter((sandboxId): sandboxId is string => Boolean(sandboxId)),
        ),
      );

      if (sandboxIds.length === 0) {
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

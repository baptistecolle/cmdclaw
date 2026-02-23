import { and, desc, eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db/client";
import { conversation, message, user } from "@/server/db/schema";
import {
  assertExitOk,
  defaultServerUrl,
  ensureCliAuth,
  expectedUserEmail,
  getCliClient,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
} from "../../../tests/e2e-cli/live-fixtures";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

let liveModel = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChatCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("bun", args, {
      env: {
        ...process.env,
        BAP_SERVER_URL: defaultServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveDone({ code: -1, stdout, stderr, timedOut });
    });
  });
}

async function listActiveGenerationIds(userId: string): Promise<Set<string>> {
  const rows = await db.query.conversation.findMany({
    where: eq(conversation.userId, userId),
    columns: {
      currentGenerationId: true,
      generationStatus: true,
    },
  });

  return new Set(
    rows
      .filter((row) =>
        row.currentGenerationId
          ? ["generating", "awaiting_approval", "awaiting_auth", "paused"].includes(
              row.generationStatus,
            )
          : false,
      )
      .map((row) => row.currentGenerationId as string),
  );
}

async function waitForNewActiveGeneration(args: {
  userId: string;
  existingIds: Set<string>;
  timeoutMs: number;
}): Promise<{ conversationId: string; generationId: string }> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<{ conversationId: string; generationId: string }> => {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for a newly started active generation.");
    }

    const rows = await db.query.conversation.findMany({
      where: eq(conversation.userId, args.userId),
      columns: {
        id: true,
        currentGenerationId: true,
        generationStatus: true,
        updatedAt: true,
      },
      orderBy: (fields) => [desc(fields.updatedAt), desc(fields.createdAt)],
    });

    const active = rows.find((row) => {
      if (!row.currentGenerationId) {
        return false;
      }
      if (args.existingIds.has(row.currentGenerationId)) {
        return false;
      }
      return ["generating", "awaiting_approval", "awaiting_auth", "paused"].includes(
        row.generationStatus,
      );
    });

    if (active?.currentGenerationId) {
      return {
        conversationId: active.id,
        generationId: active.currentGenerationId,
      };
    }
    await sleep(250);
    return poll();
  };

  return poll();
}

describe.runIf(liveEnabled)("@live CLI chat interrupt", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "cancels in-flight generation and prints cancelled marker",
    { timeout: Math.max(responseTimeoutMs + 90_000, 270_000) },
    async () => {
      const dbUser = await db.query.user.findFirst({
        where: eq(user.email, expectedUserEmail),
        columns: { id: true },
      });
      if (!dbUser) {
        throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
      }

      const existingActiveIds = await listActiveGenerationIds(dbUser.id);

      const prompt =
        process.env.E2E_CHAT_INTERRUPT_PROMPT ??
        "Print numbers from 1 to 10000, one per line, and do not summarize.";

      const runPromise = runChatCommand(
        ["run", "chat", "--", "--message", prompt, "--model", liveModel, "--no-validate"],
        Math.max(responseTimeoutMs, 180_000),
      );

      const target = await waitForNewActiveGeneration({
        userId: dbUser.id,
        existingIds: existingActiveIds,
        timeoutMs: 90_000,
      });

      const client = getCliClient();
      const cancelResult = await client.generation.cancelGeneration({
        generationId: target.generationId,
      });
      expect(cancelResult.success).toBe(true);

      const result = await runPromise;
      assertExitOk(result, "chat interrupt");
      expect(result.stdout).toContain("[cancelled]");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");

      const assistantMessages = await db
        .select({
          content: message.content,
          contentParts: message.contentParts,
        })
        .from(message)
        .innerJoin(conversation, eq(message.conversationId, conversation.id))
        .where(and(eq(conversation.id, target.conversationId), eq(message.role, "assistant")))
        .orderBy(desc(message.createdAt))
        .limit(1);

      const latest = assistantMessages[0];
      if (!latest) {
        throw new Error(
          `No assistant message persisted for interrupted generation in conversation ${target.conversationId}`,
        );
      }

      const hasInterruptedText =
        latest.content.includes("Interrupted by user") ||
        (Array.isArray(latest.contentParts) &&
          latest.contentParts.some(
            (part) =>
              part &&
              typeof part === "object" &&
              "type" in part &&
              "content" in part &&
              part.type === "system" &&
              part.content === "Interrupted by user",
          ));
      expect(hasInterruptedText).toBe(true);
    },
  );
});

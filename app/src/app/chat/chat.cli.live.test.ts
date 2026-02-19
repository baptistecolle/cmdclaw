import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  expectedUserEmail,
  extractConversationId,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
  withIntegrationTokensTemporarilyRemoved,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "sends prompt and receives assistant answer",
    { timeout: Math.max(responseTimeoutMs + 60_000, 240_000) },
    async () => {
      const promptText = process.env.E2E_CHAT_PROMPT ?? "hi";
      const result = await runChatMessage({
        message: promptText,
        model: liveModel,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat single-message");
      expect(result.stdout).toContain("[model]");
      expect(result.stdout).toContain("[auth]");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");
    },
  );

  test(
    "shows awaiting_auth when asking for latest created Google Sheet",
    { timeout: Math.max(responseTimeoutMs + 60_000, 240_000) },
    async () => {
      const promptText =
        process.env.E2E_CHAT_AWAITING_AUTH_PROMPT ?? "what is my latest create google sheet?";
      const result = await withIntegrationTokensTemporarilyRemoved({
        email: expectedUserEmail,
        integrationType: "google_sheets",
        run: () =>
          runChatMessage({
            message: promptText,
            model: liveModel,
            timeoutMs: responseTimeoutMs,
          }),
      });

      expect(result.stdout).toContain("[status] awaiting_auth");
      expect(result.stdout).toContain("[auth_needed] google_sheets");
      expect(result.stdout).toContain("[conversation]");
    },
  );

  test(
    "keeps context across two messages in the same conversation",
    { timeout: Math.max(responseTimeoutMs * 2 + 60_000, 360_000) },
    async () => {
      const token = `ctx-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const first = await runChatMessage({
        message: `Remember this exact token for the next message: ${token}. Reply exactly ACK.`,
        model: liveModel,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(first, "chat same-conversation first message");
      expect(first.stdout).toContain("ACK");
      expect(first.stdout).toContain("[conversation]");
      expect(first.stdout).not.toContain("[error]");

      const conversationId = extractConversationId(first.stdout);
      const second = await runChatMessage({
        conversation: conversationId,
        message: "What exact token did I ask you to remember? Reply with token only.",
        model: liveModel,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(second, "chat same-conversation second message");
      expect(second.stdout).toContain(token);
      expect(second.stdout).toContain("[conversation]");
      expect(extractConversationId(second.stdout)).toBe(conversationId);
      expect(second.stdout).not.toContain("[error]");
    },
  );
});

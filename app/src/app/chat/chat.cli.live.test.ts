import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  expectedUserEmail,
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
});

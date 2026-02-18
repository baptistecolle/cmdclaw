import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
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
});

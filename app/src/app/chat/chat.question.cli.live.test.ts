import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  liveEnabled,
  questionPrompt,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat question", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "submits Beta and model uses selected answer",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const result = await runChatMessage({
        message: questionPrompt,
        model: liveModel,
        questionAnswers: ["Beta"],
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat question");
      expect(result.stdout).toContain("SELECTED=Beta");
      expect(result.stdout).not.toContain("[error]");
    },
  );
});

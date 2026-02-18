import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  buildSlackPrompt,
  closeDbPool,
  echoPrefix,
  ensureCliAuth,
  getSlackAccessTokenForExpectedUser,
  liveEnabled,
  parseSlackTimestamp,
  pollSlackEchoMessage,
  readLatestMessage,
  responseTimeoutMs,
  resolveChannelId,
  resolveLiveModel,
  runChatMessage,
  slackPostVerifyTimeoutMs,
  sourceChannelName,
  targetChannelName,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat slack", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "reads source channel and echoes to target channel",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const slackAccessToken = await getSlackAccessTokenForExpectedUser();
      const sourceChannelId = await resolveChannelId(slackAccessToken, sourceChannelName);
      const targetChannelId = await resolveChannelId(slackAccessToken, targetChannelName);
      const latestSourceMessage = await readLatestMessage(slackAccessToken, sourceChannelId);
      const latestTargetBeforePrompt = await readLatestMessage(slackAccessToken, targetChannelId);
      const latestTargetBeforePromptTs = parseSlackTimestamp(latestTargetBeforePrompt.ts);

      const marker = `slack-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const result = await runChatMessage({
        message: buildSlackPrompt(marker),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat slack echo");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");

      const postedText = await pollSlackEchoMessage({
        token: slackAccessToken,
        channelId: targetChannelId,
        afterTs: latestTargetBeforePromptTs,
        marker,
        deadlineMs: Date.now() + Math.min(responseTimeoutMs, slackPostVerifyTimeoutMs),
      });

      expect(postedText).not.toBe("");
      expect(postedText.includes(echoPrefix)).toBeTruthy();
      expect(postedText.includes(marker)).toBeTruthy();
      expect(postedText.includes(latestSourceMessage.text)).toBeTruthy();
    },
  );

  test(
    "with auto-approve enabled, posts without approval prompts in CLI output",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const marker = `slack-e2e-auto-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const result = await runChatMessage({
        message: buildSlackPrompt(marker),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat slack auto-approve");
      expect(result.stdout).not.toContain("[approval_needed]");
      expect(result.stdout).not.toContain("[error]");
    },
  );
});

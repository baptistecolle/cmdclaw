import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  closeDbPool,
  ensureCliAuth,
  expectedUserEmail,
  getGmailAccessTokenForExpectedUser,
  liveEnabled,
  readLatestInboxMessage,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

function buildGmailReadWritePrompt(args: { marker: string }): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    "Use Gmail tools to read the most recent inbox email subject.",
    `Return only: READ_SUBJECT=[${args.marker}] <subject>`,
  ].join("\n");
}

function buildGmailAutoApprovePrompt(args: { marker: string }): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    "Use Gmail tools to read the most recent inbox email subject.",
    `Return only: READ_SUBJECT=[${args.marker}] <subject>`,
  ].join("\n");
}

describe.runIf(liveEnabled)("@live CLI chat gmail", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "reads inbox and verifies subject against Gmail API",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const gmailAccessToken = await getGmailAccessTokenForExpectedUser();
      const latestInboxBeforePrompt = await readLatestInboxMessage({ token: gmailAccessToken });
      const marker = `gmail-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

      const result = await runChatMessage({
        message: buildGmailReadWritePrompt({ marker }),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat gmail read-write");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).not.toContain("User denied this action");
      expect(result.stdout).toContain("[tool_integration] gmail");
      expect(result.stdout).toContain(`READ_SUBJECT=[${marker}]`);
      expect(result.stdout).toContain(latestInboxBeforePrompt.subject);
    },
  );

  test(
    "with auto-approve enabled, emits no approval prompt",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const marker = `gmail-e2e-auto-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

      const result = await runChatMessage({
        message: buildGmailAutoApprovePrompt({ marker }),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat gmail auto-approve");
      expect(result.stdout).not.toContain("[approval_needed]");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).not.toContain("User denied this action");
      expect(result.stdout).toContain(`READ_SUBJECT=[${marker}]`);
    },
  );
});

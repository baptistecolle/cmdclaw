import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  closeDbPool,
  ensureCliAuth,
  expectedUserEmail,
  getLinkedInAccountIdForExpectedUser,
  liveEnabled,
  readLinkedInOwnProfile,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildLinkedInReadPrompt(args: { marker: string }): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    "Use LinkedIn tools to read my own profile headline.",
    `Return only: LINKEDIN_HEADLINE=[${args.marker}] <headline>`,
  ].join("\n");
}

describe.runIf(liveEnabled)("@live CLI chat linkedin", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "reads own profile headline and verifies against LinkedIn provider API",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const linkedInAccountId = await getLinkedInAccountIdForExpectedUser();
      const ownProfile = await readLinkedInOwnProfile({ accountId: linkedInAccountId });
      const marker = `linkedin-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

      const result = await runChatMessage({
        message: buildLinkedInReadPrompt({ marker }),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat linkedin read-only");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).not.toContain("User denied this action");
      expect(result.stdout).toContain(`LINKEDIN_HEADLINE=[${marker}]`);
      expect(normalizeWhitespace(result.stdout)).toContain(
        normalizeWhitespace(ownProfile.headline),
      );
    },
  );
});

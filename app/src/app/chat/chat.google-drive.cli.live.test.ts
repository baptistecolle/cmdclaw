import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  closeDbPool,
  ensureCliAuth,
  expectedUserEmail,
  getGoogleDriveAccessTokenForExpectedUser,
  liveEnabled,
  readLatestGoogleDriveFile,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildGoogleDriveReadPrompt(args: { fileId: string }): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    `Use Google Drive tools to read the file metadata for id ${args.fileId}.`,
    `Return only: GDRIVE_FILE_ID=${args.fileId} <name>`,
  ].join("\n");
}

describe.runIf(liveEnabled)("@live CLI chat google-drive", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "reads a Drive file and verifies against Google Drive provider API",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const googleDriveAccessToken = await getGoogleDriveAccessTokenForExpectedUser();
      const latestDriveFile = await readLatestGoogleDriveFile({ token: googleDriveAccessToken });

      const result = await runChatMessage({
        message: buildGoogleDriveReadPrompt({ fileId: latestDriveFile.id }),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat google_drive read-only");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).toContain(`GDRIVE_FILE_ID=${latestDriveFile.id}`);
      expect(normalizeWhitespace(result.stdout)).toContain(
        normalizeWhitespace(latestDriveFile.name),
      );
    },
  );
});

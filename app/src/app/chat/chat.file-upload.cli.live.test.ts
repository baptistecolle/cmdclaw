import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

const fixtureFilePath = resolve(process.cwd(), "tests/e2e/fixtures/hello.txt");
const expectedToken = "404df6e0-8ec4-4453-9997-f6e2285acb77";
const fileUploadPrompt =
  process.env.E2E_CHAT_FILE_UPLOAD_PROMPT ??
  "What is the exact content of the attached file? Reply with the file content only.";

let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat file upload", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "uploads txt file and assistant can read its content",
    { timeout: Math.max(responseTimeoutMs + 60_000, 240_000) },
    async () => {
      if (!existsSync(fixtureFilePath)) {
        throw new Error(`Missing test fixture at ${fixtureFilePath}`);
      }

      const result = await runChatMessage({
        message: fileUploadPrompt,
        model: liveModel,
        files: [fixtureFilePath],
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat file-upload");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).toContain(expectedToken);
    },
  );
});

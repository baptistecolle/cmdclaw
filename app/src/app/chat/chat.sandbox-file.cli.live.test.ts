import { beforeAll, describe, expect, test } from "vitest";
import {
  artifactTimeoutMs,
  assertExitOk,
  ensureCliAuth,
  extractConversationId,
  getCliClient,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

const sandboxFilePrompt =
  process.env.E2E_SANDBOX_FILE_PROMPT ??
  "Create a file in the sandbox called 'hello.txt' with content 'hello'.";

let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat sandbox-file", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "creates hello.txt artifact and downloads exact hello content",
    { timeout: Math.max(responseTimeoutMs + artifactTimeoutMs + 60_000, 300_000) },
    async () => {
      const result = await runChatMessage({
        message: sandboxFilePrompt,
        model: liveModel,
        autoApprove: true,
        timeoutMs: Math.max(responseTimeoutMs, artifactTimeoutMs),
      });

      assertExitOk(result, "chat sandbox-file");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");

      const conversationId = extractConversationId(result.stdout);
      const client = getCliClient();
      const conversation = await client.conversation.get({ id: conversationId });

      const assistantMessages = conversation.messages.filter(
        (message) => message.role === "assistant",
      );
      const file = assistantMessages
        .flatMap((message) => message.sandboxFiles ?? [])
        .find((candidate) => candidate.filename === "hello.txt");

      if (!file) {
        throw new Error(
          `No hello.txt assistant artifact found in conversation ${conversationId}. stdout:\n${result.stdout}`,
        );
      }

      const download = await client.conversation.downloadSandboxFile({ fileId: file.fileId });
      const fileResponse = await fetch(download.url);
      if (!fileResponse.ok) {
        throw new Error(`Failed to download hello.txt artifact: HTTP ${fileResponse.status}`);
      }

      const fileText = (await fileResponse.text()).trim();
      expect(fileText).toBe("hello");
    },
  );
});

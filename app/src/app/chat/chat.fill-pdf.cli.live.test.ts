import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  artifactTimeoutMs,
  assertExitOk,
  containsPdfText,
  ensureCliAuth,
  extractConversationId,
  fillPdfPrompt,
  getCliClient,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

const fixturePdfPath = resolve(process.cwd(), "tests/e2e/fixtures/questionnaire-auto.pdf");
let liveModel = "";

describe.runIf(liveEnabled)("@live CLI chat fill-pdf", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "uploads PDF and downloads openable output containing Sandra",
    { timeout: Math.max(responseTimeoutMs + artifactTimeoutMs + 90_000, 300_000) },
    async () => {
      if (!existsSync(fixturePdfPath)) {
        throw new Error(`Missing test fixture PDF at ${fixturePdfPath}`);
      }

      const result = await runChatMessage({
        message: fillPdfPrompt,
        model: liveModel,
        files: [fixturePdfPath],
        autoApprove: true,
        timeoutMs: Math.max(responseTimeoutMs, artifactTimeoutMs),
      });

      assertExitOk(result, "chat fill-pdf");
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
        .find((candidate) => /\.pdf$/i.test(candidate.filename));

      if (!file) {
        throw new Error(
          `No assistant PDF artifact found in conversation ${conversationId}. stdout:\n${result.stdout}`,
        );
      }

      const download = await client.conversation.downloadSandboxFile({ fileId: file.fileId });
      const pdfResponse = await fetch(download.url);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF artifact: HTTP ${pdfResponse.status}`);
      }

      const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
      expect(pdfBytes.byteLength).toBeGreaterThan(100);
      expect(pdfBytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      expect(pdfBytes.includes(Buffer.from("%%EOF"))).toBeTruthy();
      expect(containsPdfText(pdfBytes, "Sandra")).toBeTruthy();
    },
  );
});

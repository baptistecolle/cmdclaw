import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "../../../tests/e2e/live-fixtures";
import type { Download, Page, Response } from "@playwright/test";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "120000");
const artifactTimeoutMs = Number(process.env.E2E_ARTIFACT_TIMEOUT_MS ?? "45000");
const fillPdfPrompt =
  process.env.E2E_FILL_PDF_PROMPT ??
  "I attached a PDF form. Fill the PDF with the name Sandra wherever a name is requested. Save the output as filled-sandra.pdf and reply with one short confirmation sentence.";
const fixturePdfPath = resolve(process.cwd(), "tests/e2e/fixtures/questionnaire-auto.pdf");

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.getByTestId("chat-model-selector").click();
  const option = page.getByTestId(`chat-model-option-${modelId}`).first();

  await expect(
    option,
    `Model \"${modelId}\" is unavailable in the model picker. Ensure provider auth is connected for that model.`,
  ).toBeVisible({ timeout: 10_000 });

  const expectedLabel = (await option.textContent())?.trim() || modelId;
  await option.click();
  await expect(page.getByTestId("chat-model-selector")).toContainText(expectedLabel);
}

async function ensureAutoApproveEnabled(page: Page): Promise<void> {
  const autoApproveSwitch = page.getByRole("switch", { name: /auto-approve/i });
  await expect(autoApproveSwitch).toBeVisible();
  await expect(autoApproveSwitch).toBeEnabled();

  const currentState = await autoApproveSwitch.getAttribute("aria-checked");
  if (currentState !== "true") {
    await autoApproveSwitch.click();
  }

  await expect(autoApproveSwitch).toHaveAttribute("aria-checked", "true");
}

function findFirstHttpUrl(value: unknown): string | null {
  if (typeof value === "string") {
    return value.startsWith("http://") || value.startsWith("https://") ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstHttpUrl(item);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const objectValue of Object.values(value)) {
      const found = findFirstHttpUrl(objectValue);
      if (found) return found;
    }
  }

  return null;
}

async function readDownloadedPdfBytes(
  page: Page,
  clickAction: Promise<void>,
  testInfo: { outputPath: (...segments: string[]) => string },
): Promise<Buffer> {
  const downloadPromise = page
    .waitForEvent("download", { timeout: artifactTimeoutMs })
    .then(async (download: Download) => {
      const destinationPath = testInfo.outputPath(
        download.suggestedFilename() || "filled-sandra.pdf",
      );
      await download.saveAs(destinationPath);
      return readFile(destinationPath);
    })
    .catch(() => null);

  const sandboxDownloadResponsePromise = page.waitForResponse(
    (response: Response) =>
      response.request().method() === "POST" && response.url().includes("downloadSandboxFile"),
    { timeout: artifactTimeoutMs },
  );

  await clickAction;
  const [downloadBytes, sandboxDownloadResponse] = await Promise.all([
    downloadPromise,
    sandboxDownloadResponsePromise,
  ]);

  if (downloadBytes) {
    return downloadBytes;
  }

  const sandboxDownloadPayload: unknown = await sandboxDownloadResponse.json();
  const presignedUrl = findFirstHttpUrl(sandboxDownloadPayload);

  if (!presignedUrl) {
    throw new Error("Failed to resolve a presigned download URL after clicking the PDF artifact.");
  }

  const pdfResponse = await page.request.get(presignedUrl);
  if (!pdfResponse.ok()) {
    throw new Error(`Failed to download PDF from presigned URL: HTTP ${pdfResponse.status()}`);
  }

  return Buffer.from(await pdfResponse.body());
}

test.describe("@live chat fill-pdf", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("uploads a PDF, fills it with Sandra, and downloads an openable PDF output", async ({
    page,
    liveChatModel,
  }, testInfo) => {
    test.setTimeout(Math.max(responseTimeoutMs + artifactTimeoutMs + 45_000, 180_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at \"${storageStatePath}\". Generate it first before running @live e2e tests.`,
      );
    }

    if (!existsSync(fixturePdfPath)) {
      throw new Error(`Missing test fixture PDF at \"${fixturePdfPath}\".`);
    }

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat(?:\/[^/?#]+)?(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    await selectModel(page, liveChatModel);
    await ensureAutoApproveEnabled(page);

    const assistantMessages = page.getByTestId("chat-message-assistant");
    const initialAssistantCount = await assistantMessages.count();

    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(fixturePdfPath);
    await expect(page.getByText("questionnaire-auto.pdf")).toBeVisible();

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill(fillPdfPrompt);
    await page.getByTestId("chat-send").click();

    await expect
      .poll(
        async () => {
          const currentCount = await assistantMessages.count();
          if (currentCount > initialAssistantCount) return "assistant";

          const waitingForApproval = await page
            .getByText("Waiting for approval")
            .first()
            .isVisible()
            .catch(() => false);
          if (waitingForApproval) return "approval_blocked";

          return "waiting";
        },
        {
          timeout: responseTimeoutMs,
          message: "Assistant did not produce a persisted message within timeout",
        },
      )
      .toBe("assistant");

    await expect
      .poll(async () => page.url(), {
        timeout: responseTimeoutMs,
        message: "Conversation URL was not updated to /chat/:id",
      })
      .toMatch(/\/chat\/[^/?#]+/);

    const assistantBubble = page.getByTestId("chat-bubble-assistant").last();
    await expect
      .poll(
        async () => {
          const text = (await assistantBubble.textContent())?.trim() ?? "";
          if (!text) return "empty";
          if (text.startsWith("Error:")) return "error";
          return "ok";
        },
        {
          timeout: responseTimeoutMs,
          message: "Assistant response was empty or an error",
        },
      )
      .toBe("ok");

    const assistantMessage = page.getByTestId("chat-message-assistant").last();
    const pdfOutputButton = assistantMessage.locator("button", { hasText: /\.pdf/i }).first();
    await expect(
      pdfOutputButton,
      "Assistant output did not expose a downloadable PDF artifact.",
    ).toBeVisible({ timeout: artifactTimeoutMs });

    const pdfBytes = await readDownloadedPdfBytes(page, pdfOutputButton.click(), testInfo);

    expect(pdfBytes.byteLength).toBeGreaterThan(100);
    expect(pdfBytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdfBytes.includes(Buffer.from("%%EOF"))).toBeTruthy();
  });
});

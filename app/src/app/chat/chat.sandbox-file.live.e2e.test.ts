import type { Download, Page, Response } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "../../../tests/e2e/live-fixtures";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
const artifactTimeoutMs = Number(process.env.E2E_ARTIFACT_TIMEOUT_MS ?? "45000");
const sandboxFilePrompt =
  process.env.E2E_SANDBOX_FILE_PROMPT ??
  "Create a file in the sandbox called 'hello.txt' with content 'hello'.";

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.getByTestId("chat-model-selector").click();
  const option = page.getByTestId(`chat-model-option-${modelId}`).first();

  await expect(
    option,
    `Model "${modelId}" is unavailable in the model picker. Ensure provider auth is connected for that model.`,
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
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const objectValue of Object.values(value)) {
      const found = findFirstHttpUrl(objectValue);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function readDownloadedBytes(
  page: Page,
  clickAction: Promise<void>,
  testInfo: { outputPath: (...segments: string[]) => string },
): Promise<Buffer> {
  const fallbackDestinationPath = testInfo.outputPath("hello.txt");
  const downloadPromise = page
    .waitForEvent("download", { timeout: artifactTimeoutMs })
    .then(async (download: Download) => {
      const destinationPath = testInfo.outputPath(download.suggestedFilename() || "hello.txt");
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
    throw new Error("Failed to resolve a presigned download URL after clicking hello.txt.");
  }

  const fileResponse = await page.request.get(presignedUrl);
  if (!fileResponse.ok()) {
    throw new Error(
      `Failed to download hello.txt from presigned URL: HTTP ${fileResponse.status()}`,
    );
  }

  const fileBytes = Buffer.from(await fileResponse.body());
  await mkdir(dirname(fallbackDestinationPath), { recursive: true });
  await writeFile(fallbackDestinationPath, fileBytes);
  return fileBytes;
}

test.describe("@live chat sandbox-file", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("creates hello.txt and downloads exact hello content", async ({
    page,
    liveChatModel,
  }, testInfo) => {
    test.setTimeout(Math.max(responseTimeoutMs + artifactTimeoutMs + 60_000, 300_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at "${storageStatePath}". Generate it first before running @live e2e tests.`,
      );
    }

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat(?:\/[^/?#]+)?(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    await selectModel(page, liveChatModel);
    await ensureAutoApproveEnabled(page);

    const assistantMessages = page.getByTestId("chat-message-assistant");
    const initialAssistantCount = await assistantMessages.count();

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill(sandboxFilePrompt);
    await page.getByTestId("chat-send").click();

    await expect
      .poll(async () => assistantMessages.count(), {
        timeout: responseTimeoutMs,
        message: "Assistant did not produce a persisted message within timeout",
      })
      .toBeGreaterThan(initialAssistantCount);

    const assistantMessage = page.getByTestId("chat-message-assistant").last();
    const fileButton = assistantMessage.locator("button", { hasText: "hello.txt" }).first();
    await expect(
      fileButton,
      "Assistant output did not expose a downloadable hello.txt artifact.",
    ).toBeVisible({ timeout: artifactTimeoutMs });

    const fileBytes = await readDownloadedBytes(page, fileButton.click(), testInfo);
    const fileText = fileBytes.toString("utf8").trim();
    expect(fileText).toBe("hello");
  });
});

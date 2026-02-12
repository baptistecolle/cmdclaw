import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { expect, test } from "../../../tests/e2e/live-fixtures";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const promptText = process.env.E2E_CHAT_PROMPT ?? "hi";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "90000");
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

test.describe("@live chat", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("sends hi and receives an answer", async ({ page, liveChatModel }) => {
    test.setTimeout(Math.max(responseTimeoutMs + 30_000, 120_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at \"${storageStatePath}\". Generate it first before running @live e2e tests.`,
      );
    }

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat(?:\/[^/?#]+)?(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    await selectModel(page, liveChatModel);

    const assistantMessages = page.getByTestId("chat-message-assistant");
    const initialAssistantCount = await assistantMessages.count();

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill(promptText);
    await page.getByTestId("chat-send").click();

    await expect
      .poll(async () => assistantMessages.count(), {
        timeout: responseTimeoutMs,
        message: "Assistant did not produce a persisted message within timeout",
      })
      .toBeGreaterThan(initialAssistantCount);

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
          if (!text) {
            return "empty";
          }
          if (text.startsWith("Error:")) {
            return "error";
          }
          return "ok";
        },
        {
          timeout: responseTimeoutMs,
          message: "Assistant response was empty or an error",
        },
      )
      .toBe("ok");
  });
});

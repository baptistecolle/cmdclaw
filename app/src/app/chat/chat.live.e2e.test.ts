import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const promptText = process.env.E2E_CHAT_PROMPT ?? "hi";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "90000");
const requestedModel = process.env.E2E_CHAT_MODEL;

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  "gpt-5.1-codex": "GPT-5.1 Codex",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
};

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.getByTestId("chat-model-selector").click();
  const option = page.getByTestId(`chat-model-option-${modelId}`).first();

  await expect(
    option,
    `Model \"${modelId}\" is unavailable in the model picker. Ensure provider auth is connected for that model.`
  ).toBeVisible({ timeout: 10_000 });

  await option.click();

  const expectedLabel = MODEL_LABELS[modelId] ?? modelId;
  await expect(page.getByTestId("chat-model-selector")).toContainText(expectedLabel);
}

test.describe("@live chat", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("sends hi and receives an answer", async ({ page }) => {
    test.setTimeout(Math.max(responseTimeoutMs + 30_000, 120_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at \"${storageStatePath}\". Generate it first before running @live e2e tests.`
      );
    }

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat(?:\/[^/?#]+)?(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    if (requestedModel) {
      await selectModel(page, requestedModel);
    }

    const assistantMessages = page.getByTestId("chat-message-assistant");
    const initialAssistantCount = await assistantMessages.count();

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill(promptText);
    await page.getByTestId("chat-send").click();

    await expect.poll(
      async () => assistantMessages.count(),
      {
        timeout: responseTimeoutMs,
        message: "Assistant did not produce a persisted message within timeout",
      }
    ).toBeGreaterThan(initialAssistantCount);

    await expect.poll(
      async () => page.url(),
      {
        timeout: responseTimeoutMs,
        message: "Conversation URL was not updated to /chat/:id",
      }
    ).toMatch(/\/chat\/[^/?#]+/);

    const assistantBubble = page.getByTestId("chat-bubble-assistant").last();

    await expect.poll(
      async () => {
        const text = (await assistantBubble.textContent())?.trim() ?? "";
        if (!text) return "empty";
        if (text.startsWith("Error:")) return "error";
        return "ok";
      },
      {
        timeout: responseTimeoutMs,
        message: "Assistant response was empty or an error",
      }
    ).toBe("ok");
  });
});

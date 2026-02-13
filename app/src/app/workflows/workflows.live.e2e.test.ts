import { existsSync } from "node:fs";
import { expect, test } from "../../../tests/e2e/live-fixtures";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
const workflowInstruction = process.env.E2E_WORKFLOW_PROMPT ?? "say hi";

test.describe("@live workflows", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("creates manual workflow, runs it, and receives an answer", async ({ page }) => {
    test.setTimeout(Math.max(responseTimeoutMs + 120_000, 300_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at "${storageStatePath}". Generate it first before running @live e2e tests.`,
      );
    }

    await page.goto("/workflows");
    await expect(page).toHaveURL(/\/workflows(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    await page.getByRole("button", { name: "New Workflow" }).first().click();
    await expect
      .poll(async () => page.url(), {
        timeout: responseTimeoutMs,
        message: "Workflow creation did not navigate to /workflows/:id",
      })
      .toMatch(/\/workflows\/[^/?#]+/);

    const promptInput = page.locator("textarea").first();
    await expect(promptInput).toBeVisible();
    await promptInput.fill(workflowInstruction);

    const runNowButton = page.getByRole("button", { name: "Test now" });
    if (await runNowButton.isDisabled()) {
      await page.getByRole("switch").first().click();
    }
    await expect(runNowButton).toBeEnabled({ timeout: responseTimeoutMs });

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Workflow saved.")).toBeVisible({ timeout: responseTimeoutMs });

    await runNowButton.click();
    await expect(page).toHaveURL(/\/workflows\/[^/?#]+(?:\?.*)?$/);
    await expect(page.getByText("Test run started.")).toBeVisible({ timeout: responseTimeoutMs });

    const assistantMessages = page.getByTestId("chat-message-assistant");
    await expect
      .poll(async () => assistantMessages.count(), {
        timeout: responseTimeoutMs,
        message: "Workflow run did not produce an assistant message",
      })
      .toBeGreaterThan(0);

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
          message: "Workflow assistant response was empty or an error",
        },
      )
      .toBe("ok");
  });
});

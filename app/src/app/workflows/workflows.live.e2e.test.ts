import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { expect, test } from "../../../tests/e2e/live-fixtures";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
const workflowInstruction = process.env.E2E_WORKFLOW_PROMPT ?? "say hi";

async function getWorkflowRunHrefs(page: Page) {
  const runLinks = page.locator("a[href^='/workflows/runs/']");
  return runLinks.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute("href"))
      .filter((href): href is string => Boolean(href)),
  );
}

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

    await page.getByRole("switch").first().click();
    await expect(page.getByText("Workflow is on")).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Workflow saved.")).toBeVisible({ timeout: responseTimeoutMs });

    const initialRunHrefs = await getWorkflowRunHrefs(page);

    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("Workflow run started.")).toBeVisible({
      timeout: responseTimeoutMs,
    });

    let newRunHref = "";
    await expect
      .poll(
        async () => {
          const runHrefs = await getWorkflowRunHrefs(page);
          const nextRunHref = runHrefs.find((href) => !initialRunHrefs.includes(href));
          return nextRunHref ?? "";
        },
        {
          timeout: responseTimeoutMs,
          message: "New workflow run did not appear in the recent runs list",
        },
      )
      .not.toBe("");

    const runHrefs = await getWorkflowRunHrefs(page);
    newRunHref = runHrefs.find((href) => !initialRunHrefs.includes(href)) ?? "";
    expect(newRunHref).not.toBe("");

    await page.locator(`a[href='${newRunHref}']`).first().click();
    await expect(page).toHaveURL(/\/workflows\/runs\/[^/?#]+/);

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

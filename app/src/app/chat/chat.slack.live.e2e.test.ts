import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { closePool, db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getValidTokensForUser } from "@/server/integrations/token-refresh";
import { expect, test } from "../../../tests/e2e/live-fixtures";

type SlackMessage = {
  ts?: string;
  text?: string;
  subtype?: string;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  channels?: Array<{ id?: string; name?: string }>;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
const slackPollIntervalMs = Number(process.env.E2E_SLACK_POLL_INTERVAL_MS ?? "2500");
const slackPostVerifyTimeoutMs = Number(process.env.E2E_SLACK_POST_VERIFY_TIMEOUT_MS ?? "30000");
const expectedUserEmail = "baptiste@heybap.com";
const sourceChannelName = "bap-experiments";
const targetChannelName = "e2e-slack-testing";
const echoPrefix = "test message: the previous message is:";

function normalizeChannelName(value: string): string {
  return value.replace(/^#/, "").trim().toLowerCase();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseSlackTs(value: string): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, string | number | boolean>,
): Promise<SlackApiResponse> {
  const isGet = method === "conversations.list" || method === "conversations.history";
  const query = new URLSearchParams(
    Object.entries(body).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = isGet
    ? `https://slack.com/api/${method}?${query}`
    : `https://slack.com/api/${method}`;

  const response = await fetch(url, {
    method: isGet ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isGet ? {} : { "Content-Type": "application/json" }),
    },
    ...(isGet ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(`Slack API ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack API ${method} error: ${String(payload.error ?? "unknown")} payload=${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

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

async function approvePendingToolRequests(page: Page): Promise<number> {
  const approveButtons = page.getByRole("button", { name: /^Approve$/ });
  const buttonCount = await approveButtons.count();
  const clicks = await Promise.all(
    Array.from({ length: buttonCount }, async (_, index) => {
      const button = approveButtons.nth(index);
      const isVisible = await button.isVisible().catch(() => false);
      if (!isVisible) {
        return false;
      }
      const isEnabled = await button.isEnabled().catch(() => false);
      if (!isEnabled) {
        return false;
      }
      await button.click();
      return true;
    }),
  );

  return clicks.filter(Boolean).length;
}

async function resolveChannelId(token: string, channelName: string): Promise<string> {
  const target = normalizeChannelName(channelName);
  const findWithCursor = async (cursor?: string): Promise<string | null> => {
    const payload = await slackApi(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const channel = (payload.channels ?? []).find((candidate) => {
      const name = candidate.name;
      if (!name) {
        return false;
      }
      return normalizeChannelName(name) === target;
    });

    if (channel?.id) {
      return channel.id;
    }

    const nextCursor = payload.response_metadata?.next_cursor?.trim() ?? "";
    if (!nextCursor) {
      return null;
    }
    return findWithCursor(nextCursor);
  };

  const channelId = await findWithCursor();
  if (channelId) {
    return channelId;
  }

  throw new Error(`Slack channel not found: #${target}`);
}

async function readLatestMessage(token: string, channelId: string): Promise<SlackMessage> {
  const payload = await slackApi(token, "conversations.history", {
    channel: channelId,
    limit: 30,
  });
  const message = (payload.messages ?? []).find((candidate) => {
    if (!candidate.ts || !candidate.text) {
      return false;
    }
    if (candidate.subtype && candidate.subtype !== "thread_broadcast") {
      return false;
    }
    return normalizeWhitespace(candidate.text).length > 0;
  });

  if (!message || !message.ts || !message.text) {
    throw new Error("Could not find a readable latest message in Slack channel history.");
  }

  return message;
}

async function findEchoMessageAfterTs(
  token: string,
  channelId: string,
  afterTs: number,
  marker: string,
): Promise<string | null> {
  const payload = await slackApi(token, "conversations.history", {
    channel: channelId,
    limit: 100,
  });

  const match = (payload.messages ?? []).find((candidate) => {
    const text = normalizeWhitespace(candidate.text ?? "");
    const ts = parseSlackTs(candidate.ts ?? "0");
    if (!text || ts <= afterTs) {
      return false;
    }
    return text.includes(marker) && text.includes(echoPrefix);
  });

  return match?.text ? normalizeWhitespace(match.text) : null;
}

function buildPrompt(marker: string): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    `Use Slack tools to read the latest message in #${sourceChannelName}.`,
    `Then send a new message in #${targetChannelName} with exactly this format:`,
    `[${marker}] ${echoPrefix} <previous message>`,
    "Do not post in any other channel.",
    "Return only the final posted message text.",
  ].join("\n");
}

async function getSlackAccessTokenForExpectedUser(): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, expectedUserEmail),
  });

  if (!dbUser) {
    throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
  }

  const tokens = await getValidTokensForUser(dbUser.id);
  const slackToken = tokens.get("slack");

  if (!slackToken) {
    throw new Error(
      `Slack is not connected for ${expectedUserEmail}. Connect Slack in the app integrations page before running this test.`,
    );
  }

  return slackToken;
}

type AssistantTerminalState = "assistant_final" | "assistant_error" | "auth_required" | "timeout";

async function waitForAssistantTerminalState({
  page,
  assistantMessages,
  initialAssistantCount,
  responseTimeoutMs,
  finalAssistantRef,
  allowApprovalClicks,
  failOnApprovalCard,
}: {
  page: Page;
  assistantMessages: ReturnType<Page["getByTestId"]>;
  initialAssistantCount: number;
  responseTimeoutMs: number;
  finalAssistantRef: { text: string };
  allowApprovalClicks: boolean;
  failOnApprovalCard: boolean;
}): Promise<AssistantTerminalState | "approval_required"> {
  const deadline = Date.now() + responseTimeoutMs;

  const poll = async (): Promise<AssistantTerminalState | "approval_required"> => {
    const approveButtons = page.getByRole("button", { name: /^Approve$/ });
    const approveButtonCount = await approveButtons.count();
    if (approveButtonCount > 0) {
      if (failOnApprovalCard) {
        return "approval_required";
      }
      if (allowApprovalClicks) {
        const approvedCount = await approvePendingToolRequests(page);
        if (approvedCount > 0) {
          await page.waitForTimeout(500);
          return poll();
        }
      }
    }

    const currentCount = await assistantMessages.count();
    if (currentCount > initialAssistantCount) {
      const text = normalizeWhitespace(
        (await page.getByTestId("chat-bubble-assistant").last().textContent()) ?? "",
      );
      if (!text) {
        if (Date.now() >= deadline) {
          return "timeout";
        }
        await page.waitForTimeout(slackPollIntervalMs);
        return poll();
      }
      finalAssistantRef.text = text;
      if (text.startsWith("Error:")) {
        return "assistant_error";
      }
      return "assistant_final";
    }

    const requiresAuth = await page
      .getByText("Connection Required")
      .first()
      .isVisible()
      .catch(() => false);
    if (requiresAuth) {
      return "auth_required";
    }

    if (Date.now() >= deadline) {
      return "timeout";
    }

    await page.waitForTimeout(slackPollIntervalMs);
    return poll();
  };

  return poll();
}

test.describe("@live chat slack", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test.afterAll(async () => {
    await closePool();
  });

  async function runSlackEchoScenario({
    page,
    liveChatModel,
    allowApprovalClicks,
    failOnApprovalCard,
  }: {
    page: Page;
    liveChatModel: string;
    allowApprovalClicks: boolean;
    failOnApprovalCard: boolean;
  }) {
    test.setTimeout(Math.max(responseTimeoutMs + 90_000, 300_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at "${storageStatePath}". Generate it first before running @live e2e tests.`,
      );
    }

    const slackAccessToken = await getSlackAccessTokenForExpectedUser();
    const sourceChannelId = await resolveChannelId(slackAccessToken, sourceChannelName);
    const targetChannelId = await resolveChannelId(slackAccessToken, targetChannelName);
    const latestSourceMessage = await readLatestMessage(slackAccessToken, sourceChannelId);
    const latestSourceMessageText = normalizeWhitespace(latestSourceMessage.text ?? "");
    const latestTargetBeforePrompt = await readLatestMessage(slackAccessToken, targetChannelId);
    const latestTargetBeforePromptTs = parseSlackTs(latestTargetBeforePrompt.ts ?? "0");
    const marker = `slack-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat(?:\/[^/?#]+)?(?:\?.*)?$/);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    await selectModel(page, liveChatModel);
    await ensureAutoApproveEnabled(page);

    const assistantMessages = page.getByTestId("chat-message-assistant");
    const initialAssistantCount = await assistantMessages.count();
    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill(buildPrompt(marker));
    await page.getByTestId("chat-send").click();

    const finalAssistantRef = { text: "" };
    const terminalState = await waitForAssistantTerminalState({
      page,
      assistantMessages,
      initialAssistantCount,
      responseTimeoutMs,
      finalAssistantRef,
      allowApprovalClicks,
      failOnApprovalCard,
    });
    const finalAssistantText = finalAssistantRef.text;

    if (terminalState === "approval_required") {
      throw new Error(
        "Approval card appeared, but this test expects no manual approval for this scenario.",
      );
    }
    if (terminalState === "auth_required") {
      throw new Error(
        "Slack auth was requested during test. The connected user is missing Slack auth.",
      );
    }
    if (terminalState === "assistant_error") {
      throw new Error(`Assistant returned an error response: ${finalAssistantText}`);
    }
    if (terminalState === "timeout") {
      throw new Error("Assistant did not produce a final message within timeout.");
    }
    if (terminalState !== "assistant_final") {
      throw new Error(`Unexpected terminal assistant state: ${terminalState}`);
    }

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

    let postedText = "";
    await expect
      .poll(
        async () => {
          const foundText = await findEchoMessageAfterTs(
            slackAccessToken,
            targetChannelId,
            latestTargetBeforePromptTs,
            marker,
          );
          if (foundText) {
            postedText = foundText;
            return foundText;
          }
          return "";
        },
        {
          timeout: Math.min(responseTimeoutMs, slackPostVerifyTimeoutMs),
          intervals: [slackPollIntervalMs],
          message: `No Slack message containing marker "${marker}" with expected echo format found in #${targetChannelName}. Assistant final: "${finalAssistantText}"`,
        },
      )
      .not.toBe("");

    expect(postedText.includes(echoPrefix)).toBeTruthy();
    expect(postedText.includes(marker)).toBeTruthy();
    expect(
      postedText.includes(latestSourceMessageText),
      `Posted Slack message did not include the source previous message text. source="${latestSourceMessageText}" posted="${postedText}"`,
    ).toBeTruthy();
  }

  test("reads latest source message and echoes to target Slack channel", async ({
    page,
    liveChatModel,
  }) => {
    await runSlackEchoScenario({
      page,
      liveChatModel,
      allowApprovalClicks: true,
      failOnApprovalCard: false,
    });
  });

  test("with auto-approve enabled, posts to Slack without any approval card", async ({
    page,
    liveChatModel,
  }) => {
    await runSlackEchoScenario({
      page,
      liveChatModel,
      allowApprovalClicks: false,
      failOnApprovalCard: true,
    });
  });
});

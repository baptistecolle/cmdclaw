import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "./live-fixtures";
import { closePool, db } from "../../src/server/db/client";
import { conversation, slackConversation, slackUserLink, user } from "../../src/server/db/schema";

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  messages?: Array<{ ts?: string; text?: string }>;
  ts?: string;
  user_id?: string;
  team_id?: string;
  [key: string]: unknown;
};

const liveEnabled = process.env.E2E_LIVE === "1";
const slackLiveEnabled = process.env.E2E_SLACK_LIVE === "1";
const responseTimeoutMs = Number(process.env.E2E_SLACK_RESPONSE_TIMEOUT_MS ?? "120000");
const pollIntervalMs = Number(process.env.E2E_SLACK_POLL_INTERVAL_MS ?? "2500");

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Slack live e2e test`);
  }
  return value;
}

function readSlackString(payload: SlackApiResponse, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Slack API response missing string field: ${key}`);
  }
  return value;
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const isReplies = method === "conversations.replies";
  const url = isReplies
    ? `https://slack.com/api/${method}?${new URLSearchParams(
        Object.entries(body).map(([key, value]) => [key, String(value)]),
      ).toString()}`
    : `https://slack.com/api/${method}`;

  const response = await fetch(url, {
    method: isReplies ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isReplies ? {} : { "Content-Type": "application/json" }),
    },
    ...(isReplies ? {} : { body: JSON.stringify(body) }),
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

async function ensureLiveUserId(): Promise<string> {
  const email = process.env.E2E_TEST_EMAIL ?? "e2e-playwright@heybap.local";
  const name = process.env.E2E_TEST_NAME ?? "Playwright E2E";
  const now = new Date();

  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (existing) {
    await db
      .update(user)
      .set({
        name,
        emailVerified: true,
        onboardedAt: existing.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id));

    return existing.id;
  }

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email,
    name,
    emailVerified: true,
    onboardedAt: now,
    role: "user",
    createdAt: now,
    updatedAt: now,
  });

  return userId;
}

function createSlackSignature(body: string, timestamp: string, signingSecret: string): string {
  const digest = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  return `v0=${digest}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("@live slack bridge", () => {
  test.skip(
    !liveEnabled || !slackLiveEnabled,
    "Set E2E_LIVE=1 and E2E_SLACK_LIVE=1 to run Slack live e2e tests",
  );

  test.afterAll(async () => {
    await closePool();
  });

  test("posts an AI reply in Slack thread for app_mention callback", async ({
    request,
    liveChatModel,
  }) => {
    const botToken = requireEnv("SLACK_BOT_TOKEN");
    const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
    const channelId = requireEnv("E2E_SLACK_CHANNEL_ID");
    const userId = await ensureLiveUserId();

    test.setTimeout(Math.max(responseTimeoutMs + 60_000, 180_000));

    const authTest = await slackApi(botToken, "auth.test", {});
    const teamId = readSlackString(authTest, "team_id");
    const botUserId = readSlackString(authTest, "user_id");

    await db
      .insert(slackUserLink)
      .values({
        slackTeamId: teamId,
        slackUserId: botUserId,
        userId,
      })
      .onConflictDoUpdate({
        target: [slackUserLink.slackTeamId, slackUserLink.slackUserId],
        set: { userId },
      });

    const marker = `slack-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const prompt = `repeat ${marker}`;
    const mentionText = `<@${botUserId}> ${prompt}`;

    const rootPost = await slackApi(botToken, "chat.postMessage", {
      channel: channelId,
      text: mentionText,
    });
    const rootTs = readSlackString(rootPost, "ts");

    const model = process.env.E2E_SLACK_CHAT_MODEL?.trim() || liveChatModel;
    const [seedConversation] = await db
      .insert(conversation)
      .values({
        userId,
        type: "chat",
        title: `Slack live e2e ${marker}`,
        model,
        autoApprove: true,
      })
      .returning();

    if (!seedConversation) {
      throw new Error("Failed to seed conversation for Slack live e2e");
    }

    await db
      .insert(slackConversation)
      .values({
        teamId,
        channelId,
        threadTs: rootTs,
        conversationId: seedConversation.id,
        userId,
      })
      .onConflictDoUpdate({
        target: [slackConversation.teamId, slackConversation.channelId, slackConversation.threadTs],
        set: {
          conversationId: seedConversation.id,
          userId,
        },
      });

    const eventPayload = {
      type: "event_callback",
      event_id: `Ev${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      team_id: teamId,
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: "app_mention",
        user: botUserId,
        text: mentionText,
        channel: channelId,
        ts: rootTs,
      },
    };

    const body = JSON.stringify(eventPayload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createSlackSignature(body, timestamp, signingSecret);

    const callbackResponse = await request.post("/api/slack/events", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
    });

    expect(callbackResponse.status()).toBe(200);
    await expect(callbackResponse.json()).resolves.toEqual({ ok: true });

    let replyText = "";
    let observedReplies: string[] = [];
    const deadline = Date.now() + responseTimeoutMs;

    while (Date.now() < deadline) {
      const repliesPayload = await slackApi(botToken, "conversations.replies", {
        channel: channelId,
        ts: rootTs,
        limit: 30,
      });

      const replies = (repliesPayload.messages ?? [])
        .filter((message) => message.ts && message.ts !== rootTs)
        .map((message) => (message.text ?? "").trim())
        .filter(Boolean);

      observedReplies = replies;
      const candidate = replies.find(
        (text) =>
          !text.includes("connect your account first") &&
          !text.includes("There was an issue processing your message"),
      );

      if (candidate) {
        replyText = candidate;
        break;
      }

      await sleep(pollIntervalMs);
    }

    expect(
      replyText,
      `No valid AI reply found in Slack thread within ${responseTimeoutMs}ms. Observed replies: ${JSON.stringify(observedReplies)}`,
    ).not.toBe("");
    expect(replyText).toContain(marker);
  });
});

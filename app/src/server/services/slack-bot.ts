import { eq, and, lt } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/server/db/client";
import {
  slackUserLink,
  slackConversation,
  conversation,
  slackProcessedEvent,
} from "@/server/db/schema";
import { generationManager } from "@/server/services/generation-manager";

// ─── Event deduplication (DB-backed across instances) ────────

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

async function reserveEvent(eventId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_TTL_MS);
  await db.delete(slackProcessedEvent).where(lt(slackProcessedEvent.receivedAt, cutoff));

  const inserted = await db
    .insert(slackProcessedEvent)
    .values({ eventId })
    .onConflictDoNothing()
    .returning({ eventId: slackProcessedEvent.eventId });

  return inserted.length > 0;
}

// ─── Slack API helpers ───────────────────────────────────────

async function slackApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; [key: string]: unknown }>;
}

async function addReaction(channel: string, timestamp: string, name: string) {
  await slackApi("reactions.add", { channel, timestamp, name });
}

async function removeReaction(channel: string, timestamp: string, name: string) {
  await slackApi("reactions.remove", { channel, timestamp, name }).catch(() => {});
}

async function postMessage(channel: string, text: string, threadTs?: string) {
  await slackApi("chat.postMessage", {
    channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text,
  });
}

function formatSlackErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.stack || err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  const compact = raw.replace(/\s+/g, " ").trim();
  const clipped = compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;

  return [
    "There was an issue processing your message. Please contact CmdClaw with this error so we can solve it.",
    "",
    "```",
    clipped || "Unknown error",
    "```",
  ].join("\n");
}

async function getSlackUserInfo(
  userId: string,
  fallbackName?: string | null,
): Promise<{ displayName: string }> {
  const res = await slackApi("users.info", { user: userId });
  const user = res.user as
    | { name?: string; profile?: { display_name?: string; real_name?: string } }
    | undefined;

  if (res.ok) {
    const displayName = user?.profile?.display_name || user?.profile?.real_name || user?.name;
    if (displayName) {
      return { displayName };
    }
  }

  if (!res.ok) {
    console.warn(
      `[slack-bot] users.info failed for ${userId}: ${String(res.error ?? "unknown error")}`,
    );
  }

  return {
    displayName: fallbackName || `Slack user <@${userId}>`,
  };
}

// ─── Markdown conversion ────────────────────────────────────

export function convertMarkdownToSlack(text: string): string {
  // Bold: **text** → *text*
  let result = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Italic: _text_ stays the same in Slack
  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");
  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  // Headers: # text → *text*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  return result;
}

// ─── Core event handler ─────────────────────────────────────

interface SlackEvent {
  type: string;
  event_id: string;
  team_id: string;
  event: {
    type: string;
    user: string;
    text: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
  };
}

export async function handleSlackEvent(payload: SlackEvent) {
  const { event, event_id, team_id } = payload;

  // Skip bot messages
  if (event.bot_id) {
    return;
  }

  // Deduplicate
  if (!(await reserveEvent(event_id))) {
    return;
  }

  // Only handle app_mention and message (DM)
  if (event.type !== "app_mention" && event.type !== "message") {
    return;
  }

  const slackUserId = event.user;
  const channel = event.channel;
  const isDirectMessage = channel.startsWith("D");
  const threadTs = event.thread_ts ?? event.ts;
  const messageText = event.text
    // Strip bot mention from text
    .replace(/<@[A-Z0-9]+>/g, "")
    .trim();

  if (!messageText) {
    return;
  }

  try {
    // Look up linked CmdClaw user
    const link = await resolveUser(team_id, slackUserId);

    if (!link) {
      const appUrl = env.NEXT_PUBLIC_APP_URL ?? "https://cmdclaw.com";
      const linkUrl = `${appUrl}/api/slack/link?slackUserId=${slackUserId}&slackTeamId=${team_id}`;
      await postMessage(
        channel,
        `To use @cmdclaw, connect your account first: ${linkUrl}`,
        isDirectMessage ? undefined : threadTs,
      );
      return;
    }

    // Add typing indicator
    await addReaction(channel, event.ts, "hourglass_flowing_sand");

    // Get or create CmdClaw conversation for this Slack thread
    const convId = await getOrCreateConversation(team_id, channel, threadTs, link.userId);

    // Get Slack user display name for context
    const { displayName } = await getSlackUserInfo(slackUserId, link.user?.name);

    // Start generation via generation manager
    const { generationId } = await generationManager.startGeneration({
      conversationId: convId,
      content: [
        `[Slack message from ${displayName}]`,
        `channel_id: ${channel}`,
        `thread_ts: ${threadTs}`,
        `message_ts: ${event.ts}`,
        `context: You are already replying in this exact Slack thread via the bot bridge. For simple text requests (for example "repeat <text>"), answer directly in plain text without using tools. If you do use Slack tools, use channel_id and thread_ts from this prompt and do not ask the user for them.`,
        "",
        messageText,
      ].join("\n"),
      userId: link.userId,
      autoApprove: true,
    });

    // Wait for generation to complete and collect response
    const responseText = await collectGenerationResponse(generationId, link.userId);

    // Send response to Slack
    if (responseText) {
      const slackText = convertMarkdownToSlack(responseText);
      // Split long messages (Slack limit ~4000 chars)
      const chunks = splitMessage(slackText, 3900);
      await chunks.reduce<Promise<void>>(async (prev, chunk) => {
        await prev;
        await postMessage(channel, chunk, isDirectMessage ? undefined : threadTs);
      }, Promise.resolve());
    }
  } catch (err) {
    console.error("[slack-bot] Error handling event:", err);
    await postMessage(
      channel,
      formatSlackErrorMessage(err),
      isDirectMessage ? undefined : threadTs,
    );
  } finally {
    // Remove typing indicator
    await removeReaction(channel, event.ts, "hourglass_flowing_sand");
  }
}

// ─── User resolution ────────────────────────────────────────

async function resolveUser(slackTeamId: string, slackUserId: string) {
  return db.query.slackUserLink.findFirst({
    where: and(
      eq(slackUserLink.slackTeamId, slackTeamId),
      eq(slackUserLink.slackUserId, slackUserId),
    ),
    with: {
      user: true,
    },
  });
}

// ─── Conversation mapping ───────────────────────────────────

async function getOrCreateConversation(
  teamId: string,
  channelId: string,
  threadTs: string,
  userId: string,
): Promise<string> {
  // Look up existing mapping
  const existing = await db.query.slackConversation.findFirst({
    where: and(
      eq(slackConversation.teamId, teamId),
      eq(slackConversation.channelId, channelId),
      eq(slackConversation.threadTs, threadTs),
    ),
  });

  if (existing) {
    return existing.conversationId;
  }

  // Create a new CmdClaw conversation
  const [newConv] = await db
    .insert(conversation)
    .values({
      userId,
      type: "chat",
      title: "Slack conversation",
      model: "anthropic/claude-sonnet-4-6",
    })
    .returning();

  // Map Slack thread to CmdClaw conversation
  await db.insert(slackConversation).values({
    teamId,
    channelId,
    threadTs,
    conversationId: newConv!.id,
    userId,
  });

  return newConv!.id;
}

// ─── Generation response collection ─────────────────────────

async function collectGenerationResponse(generationId: string, userId: string): Promise<string> {
  const parts: string[] = [];

  for await (const event of generationManager.subscribeToGeneration(generationId, userId)) {
    if (event.type === "text") {
      parts.push(event.content);
    } else if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
      break;
    }
  }

  return parts.join("");
}

// ─── Message splitting ──────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen / 2) {
      // Try space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen / 2) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

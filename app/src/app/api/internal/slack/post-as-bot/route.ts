import { env } from "@/env";
import { generationManager } from "@/server/services/generation-manager";

export const runtime = "nodejs";

type RelayPayload = {
  channel?: string;
  text?: string;
  threadTs?: string;
  conversationId?: string;
};

function getRelaySecret(): string | undefined {
  return env.SLACK_BOT_RELAY_SECRET ?? env.BAP_SERVER_SECRET;
}

function isAuthorized(request: Request): boolean {
  const secret = getRelaySecret();
  if (!secret) {
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

function getAllowedChannels(): Set<string> {
  const raw = env.SLACK_BOT_RELAY_ALLOWED_CHANNELS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

async function postMessage(channel: string, text: string, threadTs?: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });

  return response.json() as Promise<{
    ok: boolean;
    error?: string;
    channel?: string;
    ts?: string;
  }>;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!env.SLACK_BOT_TOKEN) {
    return Response.json(
      { ok: false, error: "Slack bot token not configured" },
      { status: 500 }
    );
  }

  let payload: RelayPayload;
  try {
    payload = (await request.json()) as RelayPayload;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const channel = payload.channel?.trim();
  const text = payload.text?.trim();
  const threadTs = payload.threadTs?.trim();
  const conversationId = payload.conversationId?.trim();

  if (!channel || !text) {
    return Response.json(
      { ok: false, error: "channel and text are required" },
      { status: 400 }
    );
  }

  const allowedChannels = getAllowedChannels();
  if (allowedChannels.size > 0 && !allowedChannels.has(channel)) {
    return Response.json(
      { ok: false, error: `Channel ${channel} is not allowed for relay` },
      { status: 403 }
    );
  }

  if (conversationId) {
    const genId = generationManager.getGenerationForConversation(conversationId);
    if (!genId) {
      return Response.json(
        { ok: false, error: "No active generation for conversation" },
        { status: 403 }
      );
    }

    const allowedIntegrations =
      generationManager.getAllowedIntegrationsForConversation(conversationId);
    if (allowedIntegrations && !allowedIntegrations.includes("slack")) {
      return Response.json(
        { ok: false, error: "Slack integration is not allowed for this conversation" },
        { status: 403 }
      );
    }
  }

  const slackResult = await postMessage(channel, text, threadTs);
  if (!slackResult.ok) {
    return Response.json(
      { ok: false, error: slackResult.error ?? "Slack API error" },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true,
    channel: slackResult.channel,
    ts: slackResult.ts,
  });
}

#!/usr/bin/env bun
import { parseArgs } from "util";

const TOKEN = process.env.SLACK_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: SLACK_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST", headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    channel: { type: "string", short: "c" },
    limit: { type: "string", short: "l", default: "20" },
    text: { type: "string", short: "t" },
    thread: { type: "string" },
    query: { type: "string", short: "q" },
    user: { type: "string", short: "u" },
    emoji: { type: "string", short: "e" },
    ts: { type: "string" },
    oldest: { type: "string" },
    latest: { type: "string" },
    cursor: { type: "string" },
    inclusive: { type: "boolean", default: false },
  },
});

const [command, ...args] = positionals;

async function listChannels() {
  const data = await api("conversations.list", {
    types: "public_channel,private_channel",
    limit: parseInt(values.limit || "20"),
    exclude_archived: true,
  });

  const channels = data.channels.map((ch: any) => ({
    id: ch.id, name: ch.name, private: ch.is_private,
    topic: ch.topic?.value, members: ch.num_members,
  }));

  console.log(JSON.stringify(channels, null, 2));
}

async function getHistory() {
  if (!values.channel) { console.error("Required: --channel <channelId>"); process.exit(1); }

  const data = await api("conversations.history", {
    channel: values.channel,
    limit: parseInt(values.limit || "20"),
  });

  const messages = data.messages.map((m: any) => ({
    ts: m.ts, user: m.user, text: m.text,
    thread: m.thread_ts, replies: m.reply_count,
  }));

  console.log(JSON.stringify(messages, null, 2));
}

async function sendMessage() {
  if (!values.channel || !values.text) {
    console.error("Required: --channel <channelId> --text <message> [--thread <ts>]");
    process.exit(1);
  }

  const body: Record<string, unknown> = { channel: values.channel, text: values.text };
  if (values.thread) body.thread_ts = values.thread;

  const data = await api("chat.postMessage", body);
  console.log(`Message sent to ${data.channel} at ${data.ts}`);
}

async function searchMessages() {
  if (!values.query) { console.error("Required: --query <search>"); process.exit(1); }

  const data = await api("search.messages", {
    query: values.query,
    count: parseInt(values.limit || "10"),
    sort: "timestamp",
    sort_dir: "desc",
  });

  const messages = data.messages.matches.map((m: any) => ({
    text: m.text, user: m.user, channel: m.channel?.name,
    permalink: m.permalink, ts: m.ts,
  }));

  console.log(JSON.stringify({ total: data.messages.total, messages }, null, 2));
}

async function getRecentMessages() {
  const limit = parseInt(values.limit || "20");

  // Use search with time filter to get recent messages across all channels
  // "after:today" gets today's messages, or we can use "*" with sort
  const query = values.query || "*";

  const data = await api("search.messages", {
    query,
    count: limit,
    sort: "timestamp",
    sort_dir: "desc",
  });

  const messages = data.messages.matches.map((m: any) => ({
    ts: m.ts,
    user: m.user,
    username: m.username,
    channel: m.channel?.name,
    channelId: m.channel?.id,
    text: m.text,
    permalink: m.permalink,
  }));

  console.log(JSON.stringify({ total: data.messages.total, returned: messages.length, messages }, null, 2));
}

async function listUsers() {
  const data = await api("users.list", { limit: parseInt(values.limit || "50") });

  const users = data.members
    .filter((u: any) => !u.deleted && !u.is_bot)
    .map((u: any) => ({
      id: u.id, name: u.name, realName: u.real_name,
      email: u.profile?.email, title: u.profile?.title,
    }));

  console.log(JSON.stringify(users, null, 2));
}

async function getUserInfo() {
  if (!values.user) { console.error("Required: --user <userId>"); process.exit(1); }

  const data = await api("users.info", { user: values.user });

  console.log(JSON.stringify({
    id: data.user.id, name: data.user.name, realName: data.user.real_name,
    email: data.user.profile?.email, title: data.user.profile?.title,
    status: data.user.profile?.status_text, timezone: data.user.tz,
  }, null, 2));
}

async function getThread() {
  if (!values.channel || !values.thread) {
    console.error("Required: --channel <channelId> --thread <ts>"); process.exit(1);
  }

  const data = await api("conversations.replies", {
    channel: values.channel, ts: values.thread,
  });

  const messages = data.messages.map((m: any) => ({
    ts: m.ts, user: m.user, text: m.text,
  }));

  console.log(JSON.stringify(messages, null, 2));
}

async function addReaction() {
  if (!values.channel || !values.ts || !values.emoji) {
    console.error("Required: --channel <channelId> --ts <messageTs> --emoji <name>");
    process.exit(1);
  }

  await api("reactions.add", {
    channel: values.channel, timestamp: values.ts, name: values.emoji,
  });

  console.log(`Reaction :${values.emoji}: added!`);
}

async function main() {
  try {
    switch (command) {
      case "channels": await listChannels(); break;
      case "history": await getHistory(); break;
      case "send": await sendMessage(); break;
      case "search": await searchMessages(); break;
      case "recent": await getRecentMessages(); break;
      case "users": await listUsers(); break;
      case "user": await getUserInfo(); break;
      case "thread": await getThread(); break;
      case "react": await addReaction(); break;
      default:
        console.log(`Slack CLI - Commands:
  channels [-l limit]                                   List channels
  history -c <channelId> [-l limit]                     Get channel messages
  recent [-l limit] [-q filter]                         Get latest messages across all channels
  send -c <channelId> -t <text> [--thread <ts>]         Send message
  search -q <query> [-l limit]                          Search messages
  users [-l limit]                                      List users
  user -u <userId>                                      Get user info
  thread -c <channelId> --thread <ts>                   Get thread replies
  react -c <channelId> --ts <messageTs> -e <emoji>      Add reaction`);
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();

import { constants } from "fs";
import { readFile, access } from "fs/promises";
import { parseArgs } from "util";

type JsonValue = ReturnType<typeof JSON.parse>;

const RELAY_URL =
  process.env.SLACK_BOT_RELAY_URL ||
  (process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/internal/slack/post-as-bot`
    : undefined);
const RELAY_SECRET = process.env.SLACK_BOT_RELAY_SECRET;

function getUserToken(): string {
  const token = process.env.SLACK_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SLACK_ACCESS_TOKEN environment variable required for this command");
  }
  return token;
}

async function api<T = JsonValue>(method: string, body?: Record<string, JsonValue>): Promise<T> {
  const token = getUserToken();
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as Record<string, JsonValue>;
  if (!data.ok) {
    throw new Error(`Slack API Error: ${data.error} - ${JSON.stringify(data)}`);
  }
  return data as T;
}

async function getTokenIdentity(): Promise<{
  userId?: string;
  botId?: string;
  team?: string;
  isBotToken: boolean;
}> {
  const token = getUserToken();
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as Record<string, JsonValue>;
  if (!data.ok) {
    throw new Error(`Slack API Error: ${data.error} - ${JSON.stringify(data)}`);
  }
  return {
    userId: typeof data.user_id === "string" ? data.user_id : undefined,
    botId: typeof data.bot_id === "string" ? data.bot_id : undefined,
    team: typeof data.team === "string" ? data.team : undefined,
    isBotToken: typeof data.bot_id === "string",
  };
}

async function apiFormData<T = JsonValue>(method: string, formData: FormData): Promise<T> {
  const token = getUserToken();
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = (await res.json()) as Record<string, JsonValue>;
  if (!data.ok) {
    throw new Error(`Slack API Error: ${data.error} - ${JSON.stringify(data)}`);
  }
  return data as T;
}

async function postAsBot(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<{ channel?: string; ts?: string }> {
  if (!RELAY_URL) {
    throw new Error("SLACK_BOT_RELAY_URL or APP_URL is required for --as bot");
  }
  if (!RELAY_SECRET) {
    throw new Error("SLACK_BOT_RELAY_SECRET is required for --as bot");
  }

  const res = await fetch(RELAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RELAY_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      threadTs,
      conversationId: process.env.CONVERSATION_ID,
    }),
  });

  const data = await res.json().catch(() => ({}) as Record<string, JsonValue>);
  if (!res.ok || !data.ok) {
    throw new Error(`Slack relay error: ${String(data.error ?? `HTTP ${res.status}`)}`);
  }

  return {
    channel: typeof data.channel === "string" ? data.channel : undefined,
    ts: typeof data.ts === "string" ? data.ts : undefined,
  };
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
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
    file: { type: "string", short: "f" },
    filename: { type: "string" },
    title: { type: "string" },
    as: { type: "string" },
  },
});

const [command] = positionals;

async function listChannels() {
  const data = await api("conversations.list", {
    types: "public_channel,private_channel",
    limit: parseInt(values.limit || "20"),
    exclude_archived: true,
  });

  const channels = data.channels.map((ch: Record<string, JsonValue>) => ({
    id: ch.id,
    name: ch.name,
    private: ch.is_private,
    topic: ch.topic?.value,
    members: ch.num_members,
  }));

  console.log(JSON.stringify(channels, null, 2));
}

async function getHistory() {
  if (!values.channel) {
    console.error("Required: --channel <channelId>");
    process.exit(1);
  }

  const data = await api("conversations.history", {
    channel: values.channel,
    limit: parseInt(values.limit || "20"),
  });

  const messages = data.messages.map((m: Record<string, JsonValue>) => ({
    ts: m.ts,
    user: m.user,
    text: m.text,
    thread: m.thread_ts,
    replies: m.reply_count,
  }));

  console.log(JSON.stringify(messages, null, 2));
}

async function sendMessage() {
  const actor = values.as;
  if (!values.channel || !values.text || !actor) {
    console.error(
      "Required: --channel <channelId> --text <message> --as <user|bot> [--thread <ts>]",
    );
    process.exit(1);
  }

  if (actor !== "user" && actor !== "bot") {
    console.error("Invalid --as value. Use --as user or --as bot");
    process.exit(1);
  }

  const body: Record<string, JsonValue> = {
    channel: values.channel,
    text: values.text,
  };
  if (values.thread) {
    body.thread_ts = values.thread;
  }

  if (actor === "bot") {
    try {
      const data = await postAsBot(values.channel, values.text, values.thread);
      console.log(
        `Bot message sent to ${data.channel || values.channel} at ${data.ts || "unknown ts"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not_in_channel")) {
        throw new Error(
          "Bot is not in that channel. Invite the Slack app to the channel, or send with --as user.",
          { cause: error },
        );
      }
      throw error;
    }
    return;
  }

  try {
    const data = await api("chat.postMessage", body);
    console.log(`User message sent to ${data.channel} at ${data.ts}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not_in_channel")) {
      const identity = await getTokenIdentity().catch(() => null);
      if (identity?.isBotToken) {
        throw new Error(
          `--as user was selected, but SLACK_ACCESS_TOKEN is a bot token (bot_id=${identity.botId ?? "unknown"}). Reconnect Slack integration to refresh a user token, or use --as bot.`,
          { cause: error },
        );
      }
      throw new Error(
        "Slack returned not_in_channel for your user token. Join the target channel with that Slack user and retry.",
        { cause: error },
      );
    }
    throw error;
  }
}

async function searchMessages() {
  if (!values.query) {
    console.error("Required: --query <search>");
    process.exit(1);
  }

  const data = await api("search.messages", {
    query: values.query,
    count: parseInt(values.limit || "10"),
    sort: "timestamp",
    sort_dir: "desc",
  });

  const messages = data.messages.matches.map((m: Record<string, JsonValue>) => ({
    text: m.text,
    user: m.user,
    channel: m.channel?.name,
    permalink: m.permalink,
    ts: m.ts,
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

  const messages = data.messages.matches.map((m: Record<string, JsonValue>) => ({
    ts: m.ts,
    user: m.user,
    username: m.username,
    channel: m.channel?.name,
    channelId: m.channel?.id,
    text: m.text,
    permalink: m.permalink,
  }));

  console.log(
    JSON.stringify({ total: data.messages.total, returned: messages.length, messages }, null, 2),
  );
}

async function listUsers() {
  const data = await api("users.list", {
    limit: parseInt(values.limit || "50"),
  });

  const users = data.members
    .filter((u: Record<string, JsonValue>) => !u.deleted && !u.is_bot)
    .map((u: Record<string, JsonValue>) => ({
      id: u.id,
      name: u.name,
      realName: u.real_name,
      email: u.profile?.email,
      title: u.profile?.title,
    }));

  console.log(JSON.stringify(users, null, 2));
}

async function getUserInfo() {
  if (!values.user) {
    console.error("Required: --user <userId>");
    process.exit(1);
  }

  const data = await api("users.info", { user: values.user });

  console.log(
    JSON.stringify(
      {
        id: data.user.id,
        name: data.user.name,
        realName: data.user.real_name,
        email: data.user.profile?.email,
        title: data.user.profile?.title,
        status: data.user.profile?.status_text,
        timezone: data.user.tz,
      },
      null,
      2,
    ),
  );
}

async function getThread() {
  if (!values.channel || !values.thread) {
    console.error("Required: --channel <channelId> --thread <ts>");
    process.exit(1);
  }

  const data = await api("conversations.replies", {
    channel: values.channel,
    ts: values.thread,
  });

  const messages = data.messages.map((m: Record<string, JsonValue>) => ({
    ts: m.ts,
    user: m.user,
    text: m.text,
  }));

  console.log(JSON.stringify(messages, null, 2));
}

async function addReaction() {
  if (!values.channel || !values.ts || !values.emoji) {
    console.error("Required: --channel <channelId> --ts <messageTs> --emoji <name>");
    process.exit(1);
  }

  await api("reactions.add", {
    channel: values.channel,
    timestamp: values.ts,
    name: values.emoji,
  });

  console.log(`Reaction :${values.emoji}: added!`);
}

async function uploadFile() {
  if (!values.channel || !values.file) {
    console.error(
      "Required: --channel <channelId> --file <path> [--filename <name>] [--title <title>] [--text <comment>]",
    );
    process.exit(1);
  }

  const filePath = values.file;

  // Check if file exists
  try {
    await access(filePath, constants.F_OK);
  } catch {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const fileContent = await readFile(filePath);
  const fileName = values.filename || filePath.split("/").pop() || "file";

  // Step 1: Get upload URL using the new API (requires form data, not JSON)
  const formData = new FormData();
  formData.append("filename", fileName);
  formData.append("length", fileContent.length.toString());
  const uploadUrlData = await apiFormData("files.getUploadURLExternal", formData);

  // Step 2: Upload file to the returned URL
  const uploadRes = await fetch(uploadUrlData.upload_url, {
    method: "POST",
    body: fileContent,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload file: ${uploadRes.statusText}`);
  }

  // Step 3: Complete the upload and share to channel
  const completeData = await api("files.completeUploadExternal", {
    files: [{ id: uploadUrlData.file_id, title: values.title || fileName }],
    channel_id: values.channel,
    initial_comment: values.text,
    thread_ts: values.thread,
  });

  const file = completeData.files?.[0];
  console.log(
    JSON.stringify(
      {
        ok: true,
        file: {
          id: file?.id,
          name: file?.name,
          title: file?.title,
          mimetype: file?.mimetype,
          size: file?.size,
          url: file?.url_private,
          permalink: file?.permalink,
        },
      },
      null,
      2,
    ),
  );
}

function showHelp() {
  console.log(`Slack CLI - Commands:
  channels [-l limit]                                   List channels
  history -c <channelId> [-l limit]                     Get channel messages
  recent [-l limit] [-q filter]                         Get latest messages across all channels
  send -c <channelId> -t <text> --as <user|bot> [--thread <ts>]  Send message
  search -q <query> [-l limit]                          Search messages
  users [-l limit]                                      List users
  user -u <userId>                                      Get user info
  thread -c <channelId> --thread <ts>                   Get thread replies
  react -c <channelId> --ts <messageTs> -e <emoji>      Add reaction
  upload -c <channelId> -f <path> [--filename] [--title] [--text] [--thread]  Upload file

Options:
  --as <user|bot>                                      Required for send command
  -h, --help                                            Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "channels":
        await listChannels();
        break;
      case "history":
        await getHistory();
        break;
      case "send":
        await sendMessage();
        break;
      case "search":
        await searchMessages();
        break;
      case "recent":
        await getRecentMessages();
        break;
      case "users":
        await listUsers();
        break;
      case "user":
        await getUserInfo();
        break;
      case "thread":
        await getThread();
        break;
      case "react":
        await addReaction();
        break;
      case "upload":
        await uploadFile();
        break;
      default:
        showHelp();
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();

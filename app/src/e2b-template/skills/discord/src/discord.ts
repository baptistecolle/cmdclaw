import { parseArgs } from "util";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error("Error: DISCORD_BOT_TOKEN environment variable required");
  process.exit(1);
}

const API_BASE = "https://discord.com/api/v10";

const headers = {
  Authorization: `Bot ${TOKEN}`,
  "Content-Type": "application/json",
};

async function api(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {},
) {
  const { method = "GET", body, params } = options;
  let url = `${API_BASE}${endpoint}`;

  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const errorDetail = data.message || JSON.stringify(data);
    throw new Error(`Discord API Error (${res.status}): ${errorDetail}`);
  }

  return data;
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    text: { type: "string", short: "t" },
    limit: { type: "string", short: "l", default: "50" },
  },
});

const [command, ...args] = positionals;

async function getGuilds() {
  const data = await api("/users/@me/guilds");
  const guilds = data.map((g: any) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    owner: g.owner,
    permissions: g.permissions,
  }));
  console.log(JSON.stringify(guilds, null, 2));
}

async function getChannels(guildId: string) {
  const data = await api(`/guilds/${guildId}/channels`);
  const channels = data
    .filter((c: any) => c.type === 0 || c.type === 2 || c.type === 5)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      type: c.type === 0 ? "text" : c.type === 2 ? "voice" : "announcement",
      topic: c.topic,
      position: c.position,
      parentId: c.parent_id,
    }))
    .sort((a: any, b: any) => a.position - b.position);
  console.log(JSON.stringify(channels, null, 2));
}

async function getMessages(channelId: string) {
  const limit = values.limit || "50";
  const data = await api(`/channels/${channelId}/messages`, {
    params: { limit },
  });
  const messages = data.map((m: any) => ({
    id: m.id,
    author: {
      id: m.author.id,
      username: m.author.username,
      globalName: m.author.global_name,
      bot: m.author.bot || false,
    },
    content: m.content,
    timestamp: m.timestamp,
    attachments: m.attachments?.length || 0,
    embeds: m.embeds?.length || 0,
  }));
  console.log(JSON.stringify(messages, null, 2));
}

async function sendMessage(channelId: string) {
  if (!values.text) {
    console.error("Required: --text <message>");
    process.exit(1);
  }

  const data = await api(`/channels/${channelId}/messages`, {
    method: "POST",
    body: { content: values.text },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        message: {
          id: data.id,
          content: data.content,
          channelId: data.channel_id,
          timestamp: data.timestamp,
        },
      },
      null,
      2,
    ),
  );
}

function showHelp() {
  console.log(`Discord CLI (Bot Token) - Commands:

Reading:
  guilds                                List guilds the bot is in
  channels <guildId>                    List channels in a guild
  messages <channelId> [-l limit]       Get messages from a channel

Sending:
  send <channelId> --text <message>     Send a message to a channel

Options:
  -h, --help                            Show this help
  -t, --text <text>                     Message text content
  -l, --limit <n>                       Limit results (default: 50)`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "guilds":
        await getGuilds();
        break;
      case "channels":
        if (!args[0]) {
          console.error("Usage: discord channels <guildId>");
          process.exit(1);
        }
        await getChannels(args[0]);
        break;
      case "messages":
        if (!args[0]) {
          console.error("Usage: discord messages <channelId>");
          process.exit(1);
        }
        await getMessages(args[0]);
        break;
      case "send":
        if (!args[0]) {
          console.error("Usage: discord send <channelId> --text <message>");
          process.exit(1);
        }
        await sendMessage(args[0]);
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

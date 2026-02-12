import { parseArgs } from "util";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
const UNIPILE_DSN = process.env.UNIPILE_DSN;
const LINKEDIN_ACCOUNT_ID = process.env.LINKEDIN_ACCOUNT_ID;

if (!UNIPILE_API_KEY || !LINKEDIN_ACCOUNT_ID) {
  console.error("Error: UNIPILE_API_KEY and LINKEDIN_ACCOUNT_ID environment variables required");
  process.exit(1);
}

const BASE_URL = `https://${UNIPILE_DSN}/api/v1`;
const headers = {
  "X-API-KEY": UNIPILE_API_KEY,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function api(endpoint: string, options?: RequestInit) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Unipile API Error (${res.status}): ${error}`);
  }

  return res.json();
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    limit: { type: "string", short: "l", default: "20" },
    text: { type: "string", short: "t" },
    query: { type: "string", short: "q" },
    message: { type: "string", short: "m" },
    profile: { type: "string", short: "p" },
    type: { type: "string" },
    visibility: { type: "string", default: "PUBLIC" },
    cursor: { type: "string" },
  },
});

const [command, subcommand, ...args] = positionals;

// ========== MESSAGING ==========

async function listChats() {
  const limit = parseInt(values.limit || "20");
  const params = new URLSearchParams({
    account_id: LINKEDIN_ACCOUNT_ID!,
    limit: limit.toString(),
  });
  if (values.cursor) params.set("cursor", values.cursor);

  const data = await api(`/chats?${params}`);
  const chats =
    data.items?.map((c: Record<string, unknown>) => ({
      id: c.id,
      attendees: c.attendees?.map((a: Record<string, unknown>) => ({
        id: a.provider_id,
        name: a.display_name,
      })),
      lastMessage: c.last_message?.text?.substring(0, 100),
      unreadCount: c.unread_count,
      updatedAt: c.updated_at,
    })) || [];

  console.log(JSON.stringify({ items: chats, cursor: data.cursor }, null, 2));
}

async function getChat(chatId: string) {
  const data = await api(`/chats/${chatId}?account_id=${LINKEDIN_ACCOUNT_ID}`);
  console.log(
    JSON.stringify(
      {
        id: data.id,
        attendees: data.attendees?.map((a: Record<string, unknown>) => ({
          id: a.provider_id,
          name: a.display_name,
          headline: a.headline,
        })),
        unreadCount: data.unread_count,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
      null,
      2,
    ),
  );
}

async function listMessages(chatId: string) {
  const limit = parseInt(values.limit || "20");
  const params = new URLSearchParams({
    account_id: LINKEDIN_ACCOUNT_ID!,
    limit: limit.toString(),
  });
  if (values.cursor) params.set("cursor", values.cursor);

  const data = await api(`/chats/${chatId}/messages?${params}`);
  const messages =
    data.items?.map((m: Record<string, unknown>) => ({
      id: m.id,
      text: m.text,
      sender: m.sender?.display_name,
      senderId: m.sender?.provider_id,
      timestamp: m.timestamp,
      isFromMe: m.is_from_me,
    })) || [];

  console.log(JSON.stringify({ items: messages, cursor: data.cursor }, null, 2));
}

async function sendMessage(chatId: string, text: string) {
  const data = await api(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
    }),
  });
  console.log(JSON.stringify({ success: true, messageId: data.message_id }, null, 2));
}

async function startChat(attendeeId: string, message: string) {
  const data = await api("/chats", {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      attendees_ids: [attendeeId],
      text: message,
    }),
  });
  console.log(JSON.stringify({ success: true, chatId: data.chat_id }, null, 2));
}

// ========== PROFILES ==========

async function getMyProfile() {
  const data = await api(`/users/me?account_id=${LINKEDIN_ACCOUNT_ID}`);
  console.log(
    JSON.stringify(
      {
        id: data.provider_id,
        name: data.display_name,
        headline: data.headline,
        location: data.location,
        profileUrl: data.public_identifier,
        connectionsCount: data.connections_count,
      },
      null,
      2,
    ),
  );
}

async function getProfile(identifier: string) {
  const data = await api(
    `/users/${encodeURIComponent(identifier)}?account_id=${LINKEDIN_ACCOUNT_ID}`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.provider_id,
        name: data.display_name,
        headline: data.headline,
        location: data.location,
        profileUrl: data.public_identifier,
        connectionsCount: data.connections_count,
        company: data.current_company,
        summary: data.summary,
      },
      null,
      2,
    ),
  );
}

async function getCompanyProfile(identifier: string) {
  const data = await api(
    `/companies/${encodeURIComponent(identifier)}?account_id=${LINKEDIN_ACCOUNT_ID}`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.provider_id,
        name: data.name,
        description: data.description,
        industry: data.industry,
        employeeCount: data.employee_count,
        website: data.website,
        headquarters: data.headquarters,
      },
      null,
      2,
    ),
  );
}

async function searchUsers(query: string) {
  const limit = parseInt(values.limit || "20");
  const data = await api("/users/search", {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      query,
      limit,
    }),
  });

  const users =
    data.items?.map((u: Record<string, unknown>) => ({
      id: u.provider_id,
      name: u.display_name,
      headline: u.headline,
      profileUrl: u.public_identifier,
      location: u.location,
    })) || [];

  console.log(JSON.stringify({ items: users, cursor: data.cursor }, null, 2));
}

// ========== INVITATIONS & CONNECTIONS ==========

async function sendInvitation(profileId: string, message?: string) {
  const body: Record<string, unknown> = {
    account_id: LINKEDIN_ACCOUNT_ID,
    provider_id: profileId,
  };
  if (message) body.message = message;

  await api("/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(
    JSON.stringify({ success: true, message: `Invitation sent to ${profileId}` }, null, 2),
  );
}

async function listPendingInvitations() {
  const limit = parseInt(values.limit || "20");
  const data = await api(`/users/invitations?account_id=${LINKEDIN_ACCOUNT_ID}&limit=${limit}`);

  const invitations =
    data.items?.map((i: Record<string, unknown>) => ({
      id: i.provider_id,
      name: i.display_name,
      headline: i.headline,
      sentAt: i.sent_at,
      direction: i.direction,
    })) || [];

  console.log(JSON.stringify({ items: invitations, cursor: data.cursor }, null, 2));
}

async function listConnections() {
  const limit = parseInt(values.limit || "50");
  const params = new URLSearchParams({
    account_id: LINKEDIN_ACCOUNT_ID!,
    limit: limit.toString(),
  });
  if (values.cursor) params.set("cursor", values.cursor);

  const data = await api(`/users/relations?${params}`);

  const connections =
    data.items?.map((c: Record<string, unknown>) => ({
      id: c.provider_id,
      name: c.display_name,
      headline: c.headline,
      connectedAt: c.connected_at,
    })) || [];

  console.log(JSON.stringify({ items: connections, cursor: data.cursor }, null, 2));
}

async function removeConnection(profileId: string) {
  await api(`/users/relations/${profileId}?account_id=${LINKEDIN_ACCOUNT_ID}`, {
    method: "DELETE",
  });
  console.log(
    JSON.stringify({ success: true, message: `Connection removed: ${profileId}` }, null, 2),
  );
}

// ========== POSTS & CONTENT ==========

async function createPost(text: string, visibility = "PUBLIC") {
  const data = await api("/posts", {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
      visibility,
    }),
  });
  console.log(JSON.stringify({ success: true, postId: data.post_id }, null, 2));
}

async function getPost(postId: string) {
  const data = await api(`/posts/${postId}?account_id=${LINKEDIN_ACCOUNT_ID}`);
  console.log(
    JSON.stringify(
      {
        id: data.id,
        text: data.text,
        author: {
          id: data.author?.provider_id,
          name: data.author?.display_name,
        },
        likesCount: data.likes_count,
        commentsCount: data.comments_count,
        sharesCount: data.shares_count,
        createdAt: data.created_at,
      },
      null,
      2,
    ),
  );
}

async function listPosts(profileId?: string) {
  const limit = parseInt(values.limit || "20");
  const params = new URLSearchParams({
    account_id: LINKEDIN_ACCOUNT_ID!,
    limit: limit.toString(),
  });
  if (profileId) params.set("identifier", profileId);
  if (values.cursor) params.set("cursor", values.cursor);

  const data = await api(`/posts?${params}`);

  const posts =
    data.items?.map((p: Record<string, unknown>) => ({
      id: p.id,
      text: p.text?.substring(0, 200),
      author: p.author?.display_name,
      likesCount: p.likes_count,
      commentsCount: p.comments_count,
      createdAt: p.created_at,
    })) || [];

  console.log(JSON.stringify({ items: posts, cursor: data.cursor }, null, 2));
}

async function commentOnPost(postId: string, text: string) {
  const data = await api(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
    }),
  });
  console.log(JSON.stringify({ success: true, commentId: data.comment_id }, null, 2));
}

async function reactToPost(postId: string, reactionType: string) {
  await api(`/posts/${postId}/reactions`, {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      reaction_type: reactionType.toUpperCase(),
    }),
  });
  console.log(JSON.stringify({ success: true, message: `Reacted with ${reactionType}` }, null, 2));
}

// ========== COMPANY PAGES ==========

async function listCompanyPosts(companyId: string) {
  const limit = parseInt(values.limit || "20");
  const params = new URLSearchParams({
    account_id: LINKEDIN_ACCOUNT_ID!,
    limit: limit.toString(),
  });
  if (values.cursor) params.set("cursor", values.cursor);

  const data = await api(`/companies/${companyId}/posts?${params}`);

  const posts =
    data.items?.map((p: Record<string, unknown>) => ({
      id: p.id,
      text: p.text?.substring(0, 200),
      likesCount: p.likes_count,
      commentsCount: p.comments_count,
      createdAt: p.created_at,
    })) || [];

  console.log(JSON.stringify({ items: posts, cursor: data.cursor }, null, 2));
}

async function createCompanyPost(companyId: string, text: string) {
  const data = await api(`/companies/${companyId}/posts`, {
    method: "POST",
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
    }),
  });
  console.log(JSON.stringify({ success: true, postId: data.post_id }, null, 2));
}

// ========== HELP ==========

function showHelp() {
  console.log(`LinkedIn CLI (via Unipile) - Commands:

MESSAGING
  linkedin chats list [-l limit]                      List conversations
  linkedin chats get <chatId>                         Get conversation details
  linkedin messages list <chatId> [-l limit]          List messages in chat
  linkedin messages send <chatId> --text <message>    Send message
  linkedin messages start <profileId> --text <msg>    Start new conversation

PROFILES
  linkedin profile me                                 Get my profile
  linkedin profile get <identifier>                   Get user profile (URL or ID)
  linkedin profile company <identifier>               Get company profile
  linkedin search -q <query> [-l limit]               Search for people

INVITATIONS & CONNECTIONS
  linkedin invite send <profileId> [--message <m>]    Send connection request
  linkedin invite list                                List pending invitations
  linkedin connections list [-l limit]                List my connections
  linkedin connections remove <profileId>             Remove connection

POSTS & CONTENT
  linkedin posts list [--profile <id>] [-l limit]     List posts
  linkedin posts get <postId>                         Get post details
  linkedin posts create --text <content>              Create a post
  linkedin posts comment <postId> --text <comment>    Comment on post
  linkedin posts react <postId> --type <LIKE|...>     React to post
    Reaction types: LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY

COMPANY PAGES
  linkedin company posts <companyId> [-l limit]       List company posts
  linkedin company post <companyId> --text <text>     Post as company (if admin)

Options:
  -h, --help                                          Show this help message
  -l, --limit <n>                                     Limit results (default: 20)
  -t, --text <text>                                   Text content
  -q, --query <query>                                 Search query
  -m, --message <msg>                                 Message text
  --profile <id>                                      Profile identifier
  --type <type>                                       Reaction type
  --visibility <PUBLIC|CONNECTIONS>                   Post visibility`);
}

// ========== MAIN ==========

async function main() {
  if (values.help || !command) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "chats":
        switch (subcommand) {
          case "list":
            await listChats();
            break;
          case "get":
            if (!args[0]) {
              console.error("Error: Chat ID required");
              process.exit(1);
            }
            await getChat(args[0]);
            break;
          default:
            console.error(`Unknown chats subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "messages":
        switch (subcommand) {
          case "list":
            if (!args[0]) {
              console.error("Error: Chat ID required");
              process.exit(1);
            }
            await listMessages(args[0]);
            break;
          case "send":
            if (!args[0] || !values.text) {
              console.error("Error: Chat ID and --text required");
              process.exit(1);
            }
            await sendMessage(args[0], values.text);
            break;
          case "start":
            if (!args[0] || !values.text) {
              console.error("Error: Profile ID and --text required");
              process.exit(1);
            }
            await startChat(args[0], values.text);
            break;
          default:
            console.error(`Unknown messages subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "profile":
        switch (subcommand) {
          case "me":
            await getMyProfile();
            break;
          case "get":
            if (!args[0]) {
              console.error("Error: Profile identifier required");
              process.exit(1);
            }
            await getProfile(args[0]);
            break;
          case "company":
            if (!args[0]) {
              console.error("Error: Company identifier required");
              process.exit(1);
            }
            await getCompanyProfile(args[0]);
            break;
          default:
            console.error(`Unknown profile subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "search":
        if (!values.query) {
          console.error("Error: --query required");
          process.exit(1);
        }
        await searchUsers(values.query);
        break;

      case "invite":
        switch (subcommand) {
          case "send":
            if (!args[0]) {
              console.error("Error: Profile ID required");
              process.exit(1);
            }
            await sendInvitation(args[0], values.message);
            break;
          case "list":
            await listPendingInvitations();
            break;
          default:
            console.error(`Unknown invite subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "connections":
        switch (subcommand) {
          case "list":
            await listConnections();
            break;
          case "remove":
            if (!args[0]) {
              console.error("Error: Profile ID required");
              process.exit(1);
            }
            await removeConnection(args[0]);
            break;
          default:
            console.error(`Unknown connections subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "posts":
        switch (subcommand) {
          case "list":
            await listPosts(values.profile);
            break;
          case "get":
            if (!args[0]) {
              console.error("Error: Post ID required");
              process.exit(1);
            }
            await getPost(args[0]);
            break;
          case "create":
            if (!values.text) {
              console.error("Error: --text required");
              process.exit(1);
            }
            await createPost(values.text, values.visibility);
            break;
          case "comment":
            if (!args[0] || !values.text) {
              console.error("Error: Post ID and --text required");
              process.exit(1);
            }
            await commentOnPost(args[0], values.text);
            break;
          case "react":
            if (!args[0] || !values.type) {
              console.error("Error: Post ID and --type required");
              process.exit(1);
            }
            await reactToPost(args[0], values.type);
            break;
          default:
            console.error(`Unknown posts subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      case "company":
        switch (subcommand) {
          case "posts":
            if (!args[0]) {
              console.error("Error: Company ID required");
              process.exit(1);
            }
            await listCompanyPosts(args[0]);
            break;
          case "post":
            if (!args[0] || !values.text) {
              console.error("Error: Company ID and --text required");
              process.exit(1);
            }
            await createCompanyPost(args[0], values.text);
            break;
          default:
            console.error(`Unknown company subcommand: ${subcommand}`);
            showHelp();
        }
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          error: true,
          message: error instanceof Error ? error.message : "Unknown error",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

main();

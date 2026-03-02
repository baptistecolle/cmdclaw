import { parseArgs } from "util";

const CLI_ARGS = process.argv.slice(2);
const IS_HELP_REQUEST = CLI_ARGS.includes("--help") || CLI_ARGS.includes("-h");
const TOKEN = process.env.TWITTER_ACCESS_TOKEN;
if (!TOKEN && !IS_HELP_REQUEST) {
  console.error("Error: TWITTER_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const API_BASE = "https://api.twitter.com/2";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
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
    const errorDetail = data.detail || data.title || JSON.stringify(data.errors || data);
    throw new Error(`Twitter API Error (${res.status}): ${errorDetail}`);
  }

  return data;
}

const { positionals, values } = parseArgs({
  args: CLI_ARGS,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    text: { type: "string", short: "t" },
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "10" },
  },
});

const [command, ...args] = positionals;

// Get authenticated user's profile
async function getMe() {
  const data = await api("/users/me", {
    params: {
      "user.fields":
        "id,name,username,description,profile_image_url,public_metrics,created_at,verified",
    },
  });
  console.log(JSON.stringify(data.data, null, 2));
}

// Get user by username
async function getUser(username: string) {
  const data = await api(`/users/by/username/${username}`, {
    params: {
      "user.fields":
        "id,name,username,description,profile_image_url,public_metrics,created_at,verified",
    },
  });
  console.log(JSON.stringify(data.data, null, 2));
}

// Get user by ID
async function getUserById(userId: string) {
  const data = await api(`/users/${userId}`, {
    params: {
      "user.fields":
        "id,name,username,description,profile_image_url,public_metrics,created_at,verified",
    },
  });
  console.log(JSON.stringify(data.data, null, 2));
}

// Get home timeline (reverse chronological)
async function getTimeline() {
  // First get user ID
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/reverse_chronological_timeline`, {
    params: {
      max_results: values.limit || "10",
      "tweet.fields": "id,text,author_id,created_at,public_metrics,conversation_id",
      expansions: "author_id",
      "user.fields": "username,name",
    },
  });

  const users = new Map(data.includes?.users?.map((u: Record<string, unknown>) => [u.id, u]) || []);
  const tweets =
    data.data?.map((t: Record<string, unknown>) => ({
      id: t.id,
      text: t.text,
      author: users.get(t.author_id),
      created_at: t.created_at,
      metrics: t.public_metrics,
    })) || [];

  console.log(JSON.stringify(tweets, null, 2));
}

// Get mentions
async function getMentions() {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/mentions`, {
    params: {
      max_results: values.limit || "10",
      "tweet.fields": "id,text,author_id,created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "username,name",
    },
  });

  const users = new Map(data.includes?.users?.map((u: Record<string, unknown>) => [u.id, u]) || []);
  const tweets =
    data.data?.map((t: Record<string, unknown>) => ({
      id: t.id,
      text: t.text,
      author: users.get(t.author_id),
      created_at: t.created_at,
      metrics: t.public_metrics,
    })) || [];

  console.log(JSON.stringify(tweets, null, 2));
}

// Search tweets
async function searchTweets() {
  if (!values.query) {
    console.error("Required: --query <search>");
    process.exit(1);
  }

  const data = await api("/tweets/search/recent", {
    params: {
      query: values.query,
      max_results: values.limit || "10",
      "tweet.fields": "id,text,author_id,created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "username,name",
    },
  });

  const users = new Map(data.includes?.users?.map((u: Record<string, unknown>) => [u.id, u]) || []);
  const tweets =
    data.data?.map((t: Record<string, unknown>) => ({
      id: t.id,
      text: t.text,
      author: users.get(t.author_id),
      created_at: t.created_at,
      metrics: t.public_metrics,
    })) || [];

  console.log(JSON.stringify({ meta: data.meta, tweets }, null, 2));
}

// Get liked tweets
async function getLikes() {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/liked_tweets`, {
    params: {
      max_results: values.limit || "10",
      "tweet.fields": "id,text,author_id,created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "username,name",
    },
  });

  const users = new Map(data.includes?.users?.map((u: Record<string, unknown>) => [u.id, u]) || []);
  const tweets =
    data.data?.map((t: Record<string, unknown>) => ({
      id: t.id,
      text: t.text,
      author: users.get(t.author_id),
      created_at: t.created_at,
      metrics: t.public_metrics,
    })) || [];

  console.log(JSON.stringify(tweets, null, 2));
}

// Get followers
async function getFollowers() {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/followers`, {
    params: {
      max_results: values.limit || "10",
      "user.fields": "id,name,username,description,profile_image_url,public_metrics",
    },
  });

  console.log(JSON.stringify(data.data || [], null, 2));
}

// Get following
async function getFollowing() {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/following`, {
    params: {
      max_results: values.limit || "10",
      "user.fields": "id,name,username,description,profile_image_url,public_metrics",
    },
  });

  console.log(JSON.stringify(data.data || [], null, 2));
}

const DM_EVENT_FIELDS =
  "id,event_type,text,sender_id,participant_ids,dm_conversation_id,created_at";
const DM_EXPANSIONS = "sender_id,participant_ids,referenced_tweets.id,attachments.media_keys";

type DmUser = Record<string, unknown> & { id?: string };
type DmEvent = Record<string, unknown> & {
  id?: string;
  event_type?: string;
  created_at?: string;
  dm_conversation_id?: string;
  text?: string;
  sender_id?: string;
  participant_ids?: string[];
  referenced_tweets?: unknown[];
  attachments?: unknown;
};
type DmApiResponse = {
  data?: DmEvent[];
  includes?: {
    users?: DmUser[];
    media?: unknown[];
    tweets?: unknown[];
  };
  meta?: {
    result_count?: number;
    next_token?: string;
    previous_token?: string;
  };
};

function dmParams(limit: string, paginationToken?: string) {
  const params: Record<string, string> = {
    max_results: limit,
    "dm_event.fields": DM_EVENT_FIELDS,
    expansions: DM_EXPANSIONS,
    "user.fields": "id,name,username,profile_image_url,verified",
    "tweet.fields": "id,text,author_id,created_at",
    "media.fields": "media_key,type,url,preview_image_url",
  };
  if (paginationToken) {
    params.pagination_token = paginationToken;
  }
  return params;
}

function formatDmResponse(data: DmApiResponse) {
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));

  const mapParticipants = (participantIds: string[] | undefined) =>
    (participantIds || []).map(
      (participantId) => users.get(participantId) || { id: participantId },
    );

  const events = (data.data || []).map((event) => ({
    id: event.id,
    event_type: event.event_type,
    created_at: event.created_at,
    dm_conversation_id: event.dm_conversation_id,
    text: event.text,
    sender: event.sender_id ? users.get(event.sender_id) || { id: event.sender_id } : null,
    participants: mapParticipants(event.participant_ids),
    referenced_tweets: event.referenced_tweets || [],
    attachments: event.attachments || null,
  }));

  return {
    meta: data.meta || null,
    events,
    includes: {
      media: data.includes?.media || [],
      tweets: data.includes?.tweets || [],
    },
  };
}

async function getDmEvents() {
  const data = (await api("/dm_events", {
    params: dmParams(values.limit || "10"),
  })) as DmApiResponse;

  console.log(JSON.stringify(formatDmResponse(data), null, 2));
}

async function getDmEventsWithParticipant(participantId: string) {
  const data = (await api(`/dm_conversations/with/${participantId}/dm_events`, {
    params: dmParams(values.limit || "10"),
  })) as DmApiResponse;

  console.log(JSON.stringify(formatDmResponse(data), null, 2));
}

async function getDmConversationEvents(dmConversationId: string) {
  const data = (await api(`/dm_conversations/${dmConversationId}/dm_events`, {
    params: dmParams(values.limit || "10"),
  })) as DmApiResponse;

  console.log(JSON.stringify(formatDmResponse(data), null, 2));
}

async function getDmEvent(eventId: string) {
  const data = (await api(`/dm_events/${eventId}`, {
    params: {
      "dm_event.fields": DM_EVENT_FIELDS,
      expansions: DM_EXPANSIONS,
      "user.fields": "id,name,username,profile_image_url,verified",
      "tweet.fields": "id,text,author_id,created_at",
      "media.fields": "media_key,type,url,preview_image_url",
    },
  })) as { data: DmEvent; includes?: DmApiResponse["includes"] };

  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  const event = data.data;

  console.log(
    JSON.stringify(
      {
        event: {
          id: event.id,
          event_type: event.event_type,
          created_at: event.created_at,
          dm_conversation_id: event.dm_conversation_id,
          text: event.text,
          sender: event.sender_id ? users.get(event.sender_id) || { id: event.sender_id } : null,
          participants: (event.participant_ids || []).map(
            (participantId: string) => users.get(participantId) || { id: participantId },
          ),
          referenced_tweets: event.referenced_tweets || [],
          attachments: event.attachments || null,
        },
        includes: {
          media: data.includes?.media || [],
          tweets: data.includes?.tweets || [],
        },
      },
      null,
      2,
    ),
  );
}

function parseScanLimit(rawLimit: string | undefined, fallback = 200) {
  const parsed = Number.parseInt(rawLimit || "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 1000);
}

async function getLatestAnsweredDm() {
  const me = await api("/users/me", {
    params: { "user.fields": "id,username,name" },
  });
  const myUserId = me.data.id as string;

  const maxEventsToScan = parseScanLimit(values.limit, 200);
  const events: DmEvent[] = [];
  const usersById = new Map<string, DmUser>();
  let hasMorePages = false;

  async function collectPages(scannedEvents: number, paginationToken?: string): Promise<number> {
    if (scannedEvents >= maxEventsToScan) {
      if (paginationToken) {
        hasMorePages = true;
      }
      return scannedEvents;
    }

    const pageSize = String(Math.min(100, maxEventsToScan - scannedEvents));
    const page = (await api("/dm_events", {
      params: dmParams(pageSize, paginationToken),
    })) as DmApiResponse;

    for (const user of page.includes?.users || []) {
      if (user.id) {
        usersById.set(user.id, user);
      }
    }

    const pageEvents = page.data || [];
    events.push(...pageEvents);
    const updatedScannedEvents = scannedEvents + pageEvents.length;
    const nextToken = page.meta?.next_token;

    if (!nextToken || pageEvents.length === 0) {
      hasMorePages = false;
      return updatedScannedEvents;
    }

    return collectPages(updatedScannedEvents, nextToken);
  }

  const scannedEvents = await collectPages(0);

  const conversationEvents = new Map<string, DmEvent[]>();
  for (const event of events) {
    if (!event.dm_conversation_id || !event.created_at || event.event_type !== "MessageCreate") {
      continue;
    }
    const existing = conversationEvents.get(event.dm_conversation_id) || [];
    existing.push(event);
    conversationEvents.set(event.dm_conversation_id, existing);
  }

  for (const convo of conversationEvents.values()) {
    convo.sort((a, b) => (a.created_at! < b.created_at! ? 1 : -1));
  }

  const candidates: Array<{
    reply: DmEvent;
    yourLatestMessage: DmEvent;
  }> = [];

  for (const convo of conversationEvents.values()) {
    const yourLatestMessage = convo.find((event) => event.sender_id === myUserId);
    const latestReply = convo.find((event) => event.sender_id && event.sender_id !== myUserId);

    if (
      !yourLatestMessage ||
      !latestReply ||
      !yourLatestMessage.created_at ||
      !latestReply.created_at
    ) {
      continue;
    }

    if (latestReply.created_at > yourLatestMessage.created_at) {
      candidates.push({ reply: latestReply, yourLatestMessage });
    }
  }

  candidates.sort((a, b) => (a.reply.created_at! < b.reply.created_at! ? 1 : -1));
  const latest = candidates[0];

  if (!latest) {
    console.log(
      JSON.stringify(
        {
          found: false,
          scanned_events: scannedEvents,
          max_events_to_scan: maxEventsToScan,
          has_more: hasMorePages,
        },
        null,
        2,
      ),
    );
    return;
  }

  const replySenderId = latest.reply.sender_id as string;
  const replySender = usersById.get(replySenderId) || { id: replySenderId };
  console.log(
    JSON.stringify(
      {
        found: true,
        conversation_id: latest.reply.dm_conversation_id,
        answered_at: latest.reply.created_at,
        participant: replySender,
        your_latest_message: {
          id: latest.yourLatestMessage.id,
          created_at: latest.yourLatestMessage.created_at,
          text: latest.yourLatestMessage.text,
        },
        latest_reply: {
          id: latest.reply.id,
          created_at: latest.reply.created_at,
          text: latest.reply.text,
        },
        scanned_events: scannedEvents,
        max_events_to_scan: maxEventsToScan,
        has_more: hasMorePages,
      },
      null,
      2,
    ),
  );
}

// Post a tweet
async function postTweet() {
  if (!values.text) {
    console.error("Required: --text <content>");
    process.exit(1);
  }

  const data = await api("/tweets", {
    method: "POST",
    body: { text: values.text },
  });

  console.log(JSON.stringify({ success: true, tweet: data.data }, null, 2));
}

// Reply to a tweet
async function replyToTweet(tweetId: string) {
  if (!values.text) {
    console.error("Required: --text <content>");
    process.exit(1);
  }

  const data = await api("/tweets", {
    method: "POST",
    body: {
      text: values.text,
      reply: { in_reply_to_tweet_id: tweetId },
    },
  });

  console.log(JSON.stringify({ success: true, tweet: data.data }, null, 2));
}

// Quote tweet
async function quoteTweet(tweetId: string) {
  if (!values.text) {
    console.error("Required: --text <content>");
    process.exit(1);
  }

  const data = await api("/tweets", {
    method: "POST",
    body: {
      text: values.text,
      quote_tweet_id: tweetId,
    },
  });

  console.log(JSON.stringify({ success: true, tweet: data.data }, null, 2));
}

// Like a tweet
async function likeTweet(tweetId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/likes`, {
    method: "POST",
    body: { tweet_id: tweetId },
  });

  console.log(JSON.stringify({ success: true, liked: data.data.liked }, null, 2));
}

// Unlike a tweet
async function unlikeTweet(tweetId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const res = await fetch(`${API_BASE}/users/${userId}/likes/${tweetId}`, {
    method: "DELETE",
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twitter API Error: ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({ success: true, liked: data.data.liked }, null, 2));
}

// Retweet
async function retweet(tweetId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/retweets`, {
    method: "POST",
    body: { tweet_id: tweetId },
  });

  console.log(JSON.stringify({ success: true, retweeted: data.data.retweeted }, null, 2));
}

// Unretweet
async function unretweet(tweetId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const res = await fetch(`${API_BASE}/users/${userId}/retweets/${tweetId}`, {
    method: "DELETE",
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twitter API Error: ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({ success: true, retweeted: data.data.retweeted }, null, 2));
}

// Follow a user
async function followUser(targetUserId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const data = await api(`/users/${userId}/following`, {
    method: "POST",
    body: { target_user_id: targetUserId },
  });

  console.log(JSON.stringify({ success: true, following: data.data.following }, null, 2));
}

// Unfollow a user
async function unfollowUser(targetUserId: string) {
  const me = await api("/users/me");
  const userId = me.data.id;

  const res = await fetch(`${API_BASE}/users/${userId}/following/${targetUserId}`, {
    method: "DELETE",
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twitter API Error: ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({ success: true, following: data.data.following }, null, 2));
}

function showHelp() {
  console.log(`Twitter (X) CLI - Commands:

User Profile:
  me                                    Get your profile
  user <username>                       Get user by username
  user-id <id>                          Get user by ID

Reading:
  timeline [-l limit]                   Get home timeline
  mentions [-l limit]                   Get mentions
  search -q <query> [-l limit]          Search tweets
  likes [-l limit]                      Get liked tweets
  dms [-l limit]                        Get recent DM events
  dms-latest-answered [-l limit]        Get latest DM where your message got a reply
  dms-with <participantId> [-l limit]   Get DMs with a specific user
  dms-conversation <id> [-l limit]      Get DMs by conversation ID
  dm-event <eventId>                    Get a DM event by ID
  followers [-l limit]                  List followers
  following [-l limit]                  List following

Posting:
  post -t <text>                        Post a tweet
  reply <tweetId> -t <text>             Reply to tweet
  quote <tweetId> -t <text>             Quote tweet

Engagement:
  like <tweetId>                        Like a tweet
  unlike <tweetId>                      Unlike a tweet
  retweet <tweetId>                     Retweet
  unretweet <tweetId>                   Remove retweet

Following:
  follow <userId>                       Follow user
  unfollow <userId>                     Unfollow user

Options:
  -h, --help                            Show this help
  -t, --text <text>                     Tweet text content
  -q, --query <query>                   Search query
  -l, --limit <n>                       Limit results (default: 10)`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "me":
        await getMe();
        break;
      case "user":
        if (!args[0]) {
          console.error("Usage: twitter user <username>");
          process.exit(1);
        }
        await getUser(args[0]);
        break;
      case "user-id":
        if (!args[0]) {
          console.error("Usage: twitter user-id <id>");
          process.exit(1);
        }
        await getUserById(args[0]);
        break;
      case "timeline":
        await getTimeline();
        break;
      case "mentions":
        await getMentions();
        break;
      case "search":
        await searchTweets();
        break;
      case "likes":
        await getLikes();
        break;
      case "dms":
        await getDmEvents();
        break;
      case "dms-latest-answered":
        await getLatestAnsweredDm();
        break;
      case "dms-with":
        if (!args[0]) {
          console.error("Usage: twitter dms-with <participantId> [-l limit]");
          process.exit(1);
        }
        await getDmEventsWithParticipant(args[0]);
        break;
      case "dms-conversation":
        if (!args[0]) {
          console.error("Usage: twitter dms-conversation <id> [-l limit]");
          process.exit(1);
        }
        await getDmConversationEvents(args[0]);
        break;
      case "dm-event":
        if (!args[0]) {
          console.error("Usage: twitter dm-event <eventId>");
          process.exit(1);
        }
        await getDmEvent(args[0]);
        break;
      case "followers":
        await getFollowers();
        break;
      case "following":
        await getFollowing();
        break;
      case "post":
        await postTweet();
        break;
      case "reply":
        if (!args[0]) {
          console.error("Usage: twitter reply <tweetId> -t <text>");
          process.exit(1);
        }
        await replyToTweet(args[0]);
        break;
      case "quote":
        if (!args[0]) {
          console.error("Usage: twitter quote <tweetId> -t <text>");
          process.exit(1);
        }
        await quoteTweet(args[0]);
        break;
      case "like":
        if (!args[0]) {
          console.error("Usage: twitter like <tweetId>");
          process.exit(1);
        }
        await likeTweet(args[0]);
        break;
      case "unlike":
        if (!args[0]) {
          console.error("Usage: twitter unlike <tweetId>");
          process.exit(1);
        }
        await unlikeTweet(args[0]);
        break;
      case "retweet":
        if (!args[0]) {
          console.error("Usage: twitter retweet <tweetId>");
          process.exit(1);
        }
        await retweet(args[0]);
        break;
      case "unretweet":
        if (!args[0]) {
          console.error("Usage: twitter unretweet <tweetId>");
          process.exit(1);
        }
        await unretweet(args[0]);
        break;
      case "follow":
        if (!args[0]) {
          console.error("Usage: twitter follow <userId>");
          process.exit(1);
        }
        await followUser(args[0]);
        break;
      case "unfollow":
        if (!args[0]) {
          console.error("Usage: twitter unfollow <userId>");
          process.exit(1);
        }
        await unfollowUser(args[0]);
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

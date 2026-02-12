import { parseArgs } from "util";

const TOKEN = process.env.REDDIT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: REDDIT_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const USER_AGENT = "bap-app:v1.0.0 (by /u/bap-integration)";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "User-Agent": USER_AGENT,
};

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    limit: { type: "string", short: "l", default: "25" },
    sort: { type: "string", short: "s", default: "hot" },
    time: { type: "string", short: "t", default: "all" },
    query: { type: "string", short: "q" },
    direction: { type: "string", short: "d" },
    text: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    subject: { type: "string" },
  },
});

const [command, ...args] = positionals;

// Helper to format post data
function formatPost(post: Record<string, unknown>) {
  const data = post.data || post;
  return {
    id: data.name || `t3_${data.id}`,
    title: data.title,
    author: data.author,
    subreddit: data.subreddit,
    score: data.score,
    upvoteRatio: data.upvote_ratio,
    numComments: data.num_comments,
    url: data.url,
    selftext: data.selftext?.substring(0, 500) || undefined,
    permalink: `https://reddit.com${data.permalink}`,
    created: new Date(data.created_utc * 1000).toISOString(),
    isVideo: data.is_video,
    over18: data.over_18,
  };
}

// Helper to format comment data
function formatComment(comment: Record<string, unknown>): unknown {
  const data = comment.data || comment;
  if (data.kind === "more" || !data.body) return null;
  return {
    id: data.name || `t1_${data.id}`,
    author: data.author,
    body: data.body,
    score: data.score,
    created: data.created_utc
      ? new Date(data.created_utc * 1000).toISOString()
      : undefined,
    replies:
      data.replies?.data?.children
        ?.map(formatComment)
        .filter(Boolean)
        .slice(0, 3) || [],
  };
}

// ===== READING COMMANDS =====

async function getFeed() {
  const sort = values.sort || "hot";
  const limit = values.limit || "25";
  const params = new URLSearchParams({ limit });
  if (sort === "top") params.set("t", values.time || "day");

  const data = await api(`/${sort}?${params}`);
  const posts = data.data.children.map(formatPost);
  console.log(JSON.stringify(posts, null, 2));
}

async function getSubreddit(name: string) {
  const sort = values.sort || "hot";
  const limit = values.limit || "25";
  const params = new URLSearchParams({ limit });
  if (sort === "top") params.set("t", values.time || "day");

  const data = await api(`/r/${name}/${sort}?${params}`);
  const posts = data.data.children.map(formatPost);
  console.log(JSON.stringify(posts, null, 2));
}

async function getPost(id: string) {
  // Strip prefix if provided
  const postId = id.replace(/^t3_/, "");
  const limit = values.limit || "10";

  const data = await api(`/comments/${postId}?limit=${limit}`);
  const post = formatPost(data[0].data.children[0]);
  const comments = data[1].data.children.map(formatComment).filter(Boolean);

  console.log(JSON.stringify({ post, comments }, null, 2));
}

async function getUser(username: string) {
  const [about, posts, comments] = await Promise.all([
    api(`/user/${username}/about`),
    api(`/user/${username}/submitted?limit=5`),
    api(`/user/${username}/comments?limit=5`),
  ]);

  const userData = about.data;
  console.log(
    JSON.stringify(
      {
        username: userData.name,
        id: userData.id,
        karma: {
          total: userData.total_karma,
          post: userData.link_karma,
          comment: userData.comment_karma,
        },
        created: new Date(userData.created_utc * 1000).toISOString(),
        recentPosts: posts.data.children.map(formatPost),
        recentComments: comments.data.children.map((c: Record<string, unknown>) => ({
          id: c.data.name,
          body: c.data.body?.substring(0, 200),
          subreddit: c.data.subreddit,
          score: c.data.score,
        })),
      },
      null,
      2,
    ),
  );
}

async function search() {
  if (!values.query) {
    console.error("Required: --query <search>");
    process.exit(1);
  }

  const params = new URLSearchParams({
    q: values.query,
    limit: values.limit || "25",
    sort: values.sort || "relevance",
    t: values.time || "all",
  });

  const data = await api(`/search?${params}`);
  const posts = data.data.children.map(formatPost);
  console.log(JSON.stringify({ total: data.data.dist, posts }, null, 2));
}

async function getMultireddit(user: string, name: string) {
  const sort = values.sort || "hot";
  const limit = values.limit || "25";

  const data = await api(`/user/${user}/m/${name}/${sort}?limit=${limit}`);
  const posts = data.data.children.map(formatPost);
  console.log(JSON.stringify(posts, null, 2));
}

// ===== ENGAGEMENT COMMANDS =====

async function vote(thingId: string) {
  const directionMap: Record<string, number> = { up: 1, down: -1, none: 0 };
  const dir = directionMap[values.direction || "up"];
  if (dir === undefined) {
    console.error("Invalid direction. Use: up, down, or none");
    process.exit(1);
  }

  // Ensure proper prefix
  let id = thingId;
  if (!id.startsWith("t1_") && !id.startsWith("t3_")) {
    // Try to guess based on ID format
    id = `t3_${id}`;
  }

  await api("/api/vote", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id, dir: String(dir) }),
  });

  console.log(`Voted ${values.direction || "up"} on ${id}`);
}

async function comment(postId: string) {
  if (!values.text) {
    console.error("Required: --text <comment>");
    process.exit(1);
  }

  // Ensure proper prefix
  let id = postId;
  if (!id.startsWith("t3_")) {
    id = `t3_${id}`;
  }

  const result = await api("/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      thing_id: id,
      text: values.text,
    }),
  });

  const comment = result.json.data.things[0].data;
  console.log(
    JSON.stringify(
      {
        id: comment.name,
        body: comment.body,
        permalink: `https://reddit.com${comment.permalink}`,
      },
      null,
      2,
    ),
  );
}

async function reply(commentId: string) {
  if (!values.text) {
    console.error("Required: --text <reply>");
    process.exit(1);
  }

  // Ensure proper prefix
  let id = commentId;
  if (!id.startsWith("t1_")) {
    id = `t1_${id}`;
  }

  const result = await api("/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      thing_id: id,
      text: values.text,
    }),
  });

  const replyData = result.json.data.things[0].data;
  console.log(
    JSON.stringify(
      {
        id: replyData.name,
        body: replyData.body,
      },
      null,
      2,
    ),
  );
}

async function save(id: string) {
  await api("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id }),
  });
  console.log(`Saved ${id}`);
}

async function unsave(id: string) {
  await api("/api/unsave", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id }),
  });
  console.log(`Unsaved ${id}`);
}

// ===== CREATING CONTENT =====

async function submit(subreddit: string) {
  if (!values.title) {
    console.error("Required: --title <title>");
    process.exit(1);
  }

  const params: Record<string, string> = {
    sr: subreddit,
    title: values.title,
    kind: values.url ? "link" : "self",
  };

  if (values.url) {
    params.url = values.url;
  } else if (values.text) {
    params.text = values.text;
  }

  const result = await api("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        url: result.json.data.url,
        id: result.json.data.name,
      },
      null,
      2,
    ),
  );
}

async function deleteContent(id: string) {
  await api("/api/del", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id }),
  });
  console.log(`Deleted ${id}`);
}

async function edit(id: string) {
  if (!values.text) {
    console.error("Required: --text <newText>");
    process.exit(1);
  }

  const result = await api("/api/editusertext", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      thing_id: id,
      text: values.text,
    }),
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        id: result.json.data.things[0].data.name,
      },
      null,
      2,
    ),
  );
}

// ===== MESSAGING =====

async function inbox() {
  const limit = values.limit || "25";
  const data = await api(`/message/inbox?limit=${limit}`);

  const messages = data.data.children.map((m: Record<string, unknown>) => ({
    id: m.data.name,
    author: m.data.author,
    subject: m.data.subject,
    body: m.data.body?.substring(0, 500),
    subreddit: m.data.subreddit,
    isNew: m.data.new,
    created: new Date(m.data.created_utc * 1000).toISOString(),
  }));

  console.log(JSON.stringify(messages, null, 2));
}

async function sendMessage(username: string) {
  if (!values.subject || !values.text) {
    console.error("Required: -s <subject> --text <body>");
    process.exit(1);
  }

  await api("/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      to: username,
      subject: values.subject,
      text: values.text,
    }),
  });

  console.log(`Message sent to u/${username}`);
}

async function markRead(id: string) {
  await api("/api/read_message", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id }),
  });
  console.log(`Marked ${id} as read`);
}

// ===== SUBSCRIPTIONS =====

async function subscriptions() {
  const limit = values.limit || "100";
  const data = await api(`/subreddits/mine/subscriber?limit=${limit}`);

  const subs = data.data.children.map((s: Record<string, unknown>) => ({
    name: s.data.display_name,
    title: s.data.title,
    subscribers: s.data.subscribers,
    description: s.data.public_description?.substring(0, 200),
    url: s.data.url,
    over18: s.data.over18,
  }));

  console.log(JSON.stringify(subs, null, 2));
}

async function subscribe(subreddit: string) {
  // Get subreddit fullname
  const data = await api(`/r/${subreddit}/about`);
  const fullname = data.data.name;

  await api("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "sub",
      sr: fullname,
    }),
  });

  console.log(`Subscribed to r/${subreddit}`);
}

async function unsubscribe(subreddit: string) {
  // Get subreddit fullname
  const data = await api(`/r/${subreddit}/about`);
  const fullname = data.data.name;

  await api("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "unsub",
      sr: fullname,
    }),
  });

  console.log(`Unsubscribed from r/${subreddit}`);
}

function showHelp() {
  console.log(`Reddit CLI - Commands:

READING
  feed [-l limit] [-s hot|new|top|rising]              Get home feed
  subreddit <name> [-l limit] [-s hot|new|top|rising]  Get subreddit posts
  post <id> [-l limit]                                 Get post with comments
  user <username>                                      Get user profile
  search -q <query> [-l limit] [-t all|year|month|week|day|hour]
  multireddit <user> <name>                            Get multireddit posts

ENGAGEMENT
  vote <id> -d up|down|none                            Vote on post/comment
  comment <postId> --text <text>                       Add comment to post
  reply <commentId> --text <text>                      Reply to comment
  save <id>                                            Save post/comment
  unsave <id>                                          Unsave post/comment

CREATING CONTENT
  submit <subreddit> --title <title> [--text <body>] [--url <link>]
  delete <id>                                          Delete own content
  edit <id> --text <newText>                           Edit own content

MESSAGING
  inbox [-l limit]                                     List messages
  message <username> -s <subject> --text <body>        Send private message
  read <id>                                            Mark message as read

SUBSCRIPTIONS
  subscriptions [-l limit]                             List subscribed subreddits
  subscribe <subreddit>                                Subscribe to subreddit
  unsubscribe <subreddit>                              Unsubscribe from subreddit

Thing ID Prefixes:
  t1_ = comment, t3_ = post/link, t4_ = message, t5_ = subreddit

Options:
  -h, --help     Show this help message
  -l, --limit    Number of items to return (default: 25)
  -s, --sort     Sort order: hot, new, top, rising (default: hot)
  -t, --time     Time filter for top: all, year, month, week, day, hour
  -q, --query    Search query
  -d, --direction Vote direction: up, down, none
  --text         Text content for comments/messages/posts
  --title        Title for posts
  --url          URL for link posts
  --subject      Subject for messages`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      // Reading
      case "feed":
        await getFeed();
        break;
      case "subreddit":
        await getSubreddit(args[0]);
        break;
      case "post":
        await getPost(args[0]);
        break;
      case "user":
        await getUser(args[0]);
        break;
      case "search":
        await search();
        break;
      case "multireddit":
        await getMultireddit(args[0], args[1]);
        break;

      // Engagement
      case "vote":
        await vote(args[0]);
        break;
      case "comment":
        await comment(args[0]);
        break;
      case "reply":
        await reply(args[0]);
        break;
      case "save":
        await save(args[0]);
        break;
      case "unsave":
        await unsave(args[0]);
        break;

      // Creating
      case "submit":
        await submit(args[0]);
        break;
      case "delete":
        await deleteContent(args[0]);
        break;
      case "edit":
        await edit(args[0]);
        break;

      // Messaging
      case "inbox":
        await inbox();
        break;
      case "message":
        await sendMessage(args[0]);
        break;
      case "read":
        await markRead(args[0]);
        break;

      // Subscriptions
      case "subscriptions":
        await subscriptions();
        break;
      case "subscribe":
        await subscribe(args[0]);
        break;
      case "unsubscribe":
        await unsubscribe(args[0]);
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

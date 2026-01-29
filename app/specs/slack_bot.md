# Slack Bot: @bap in-workspace AI agent

## Overview

Add a Slack bot (@bap) that workspace members can DM or @mention in channels. Messages are routed through the existing generation manager (full AI agent with integrations, code execution, etc.). The bot receives events via Slack's Events API through a Next.js API route.

## Goals

- Any Slack workspace member can talk to @bap.
- Messages go through the full AI agent pipeline (generation manager) — the bot can use integrations, execute code, search, etc.
- Conversations are threaded: each Slack thread = one Bap conversation.
- The bot responds in-thread with the agent's output.
- **Per-user data access**: Each Slack user links their Bap account so the bot accesses *their* integrations (email, calendar, etc.) — personalized answers per user.
- Unlinked users are prompted to connect their Bap account before using the bot.

## Non-goals (V1)

- No approval flow for write actions (the bot auto-approves for now, or runs read-only).
- No rich Block Kit UI — plain text/markdown responses only.
- No file/image uploads from the bot (text only).
- No slash commands.

## Architecture

### Slack App Setup

- Create a Slack App at api.slack.com/apps.
- Enable **Event Subscriptions** with request URL: `https://heybap.com/api/slack/events`.
- Subscribe to bot events: `app_mention`, `message.im`.
- Bot Token Scopes: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `users:read`.
- Install to workspace → get **Bot User OAuth Token** (`xoxb-...`).

### Environment Variables

```
SLACK_BOT_TOKEN=xoxb-...           # Bot User OAuth Token
SLACK_SIGNING_SECRET=...           # To verify webhook requests
SLACK_BOT_OWNER_USER_ID=...        # Fallback Bap user ID (workspace owner)
```

### Webhook Endpoint

**`POST /api/slack/events`** — Next.js API route (app router: `src/app/api/slack/events/route.ts`)

Responsibilities:
1. **Verify** request signature using `SLACK_SIGNING_SECRET` (replay attack prevention via timestamp + HMAC-SHA256).
2. **Handle URL verification** challenge (`{ type: "url_verification" }` → return `{ challenge }`).
3. **Acknowledge** with `200 OK` immediately (Slack requires response within 3 seconds).
4. **Process** the event asynchronously (fire-and-forget after acknowledging).

### Event Processing Flow

```
Slack sends POST /api/slack/events
  ↓
Verify signature → 200 OK
  ↓
Extract event (app_mention or message.im)
  ↓
Deduplicate by event ID (use a simple in-memory or Redis set with TTL)
  ↓
Look up Slack user → Bap user via slackUserLink table
  ↓
If not linked → reply with account linking URL and stop
  ↓
Look up or create conversation by Slack thread_ts (or channel+ts if no thread)
  ↓
Send "typing" indicator (⏳ reaction via reactions.add)
  ↓
Call generation manager with message text + conversation context + linked user's ID
  ↓
Post agent response to Slack thread (chat.postMessage with thread_ts)
  ↓
Remove typing indicator reaction
```

### Data Model

New table: **`slackUserLink`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| slackTeamId | text | Slack workspace ID |
| slackUserId | text | Slack user ID |
| userId | uuid | FK → user (linked Bap account) |
| createdAt | timestamp | |

Index: `(slackTeamId, slackUserId)` unique.

Maps each Slack user to their Bap account. When a Slack user messages the bot, their linked Bap user's integrations are used.

New table: **`slackConversation`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| teamId | text | Slack workspace ID |
| channelId | text | Slack channel/DM ID |
| threadTs | text | Slack thread timestamp (unique identifier) |
| conversationId | uuid | FK → conversation table (existing Bap conversation) |
| userId | uuid | FK → user (the Bap user who owns this conversation) |
| createdAt | timestamp | |

Index: `(teamId, channelId, threadTs)` unique.

This maps each Slack thread to a Bap conversation so context is preserved across messages.

### User Linking Flow

1. Slack user messages @bap for the first time.
2. Bot checks `slackUserLink` for a linked Bap account.
3. **If not linked**: bot replies with a link to connect:
   > "To use @bap, connect your account: https://heybap.com/slack/link?slackUserId=U12345&slackTeamId=T12345"
4. User clicks link → logs in / signs up on Bap → connects their integrations → `slackUserLink` row is created.
5. Subsequent messages from that Slack user use their Bap account and integrations.

### Linking Endpoint

**`GET /api/slack/link`** — Next.js page or API route

- Query params: `slackUserId`, `slackTeamId`
- User must be authenticated (redirect to login if not)
- Creates `slackUserLink` row mapping Slack user to authenticated Bap user
- Shows success page / redirects back to Slack

### Conversation Ownership

- Each bot conversation runs under the **linked Bap user's account**.
- That user's connected integrations are available to the agent.
- The Slack user's display name is included in the prompt for context.

### Response Formatting

- Agent markdown output is sent as Slack mrkdwn (minor syntax differences to handle: `**bold**` → `*bold*`, etc.).
- Long responses (>4000 chars) are split into multiple messages.
- Code blocks are preserved as-is (Slack supports triple backtick).

## Implementation Plan

### 1. Slack App Configuration

- Create the Slack App in Slack's dashboard.
- Configure event subscriptions and scopes.
- Add `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` to env config (`src/env.js`).

### 2. Webhook Route

Create `src/app/api/slack/events/route.ts`:
- Signature verification utility.
- URL verification handler.
- Event dispatcher (async processing after 200 OK).

### 3. Slack Service

Create `src/server/services/slack-bot.ts`:
- `handleEvent(event)` — routes `app_mention` and `message.im` events.
- `resolveUser(slackTeamId, slackUserId)` — looks up linked Bap user from `slackUserLink`. Returns null if not linked.
- `getOrCreateConversation(teamId, channelId, threadTs, userId)` — maps Slack threads to Bap conversations.
- `postResponse(channel, threadTs, text)` — sends response back to Slack.
- `convertMarkdown(text)` — converts standard markdown to Slack mrkdwn.

### 4. Database

- Add `slackUserLink` and `slackConversation` tables to `src/server/db/schema.ts`.
- Run `bun db:push`.

### 5. Account Linking

Create `src/app/api/slack/link/route.ts`:
- Accepts `slackUserId` and `slackTeamId` query params.
- Requires authenticated Bap session.
- Creates `slackUserLink` row.
- Returns success response.

### 6. Generation Manager Integration

- Call existing generation manager with:
  - The user's message text.
  - The mapped conversation ID (for context continuity).
  - The **linked Bap user's ID** (for their personal integration access).
  - A system prompt addition: "You are @bap, a Slack bot. The user messaging you is {slack_display_name}."

### 6. Event Deduplication

- Slack can retry events. Use an in-memory `Set<string>` with 5-minute TTL keyed by `event_id` to skip duplicates.
- For production scale, move to Redis or database-backed dedup.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/api/slack/events/route.ts` | **Create** — webhook endpoint |
| `src/app/api/slack/link/route.ts` | **Create** — account linking endpoint |
| `src/server/services/slack-bot.ts` | **Create** — event handling + Slack API calls |
| `src/server/db/schema.ts` | **Modify** — add `slackUserLink` + `slackConversation` tables |
| `src/env.js` | **Modify** — add `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_OWNER_USER_ID` |
| `src/lib/slack-signature.ts` | **Create** — HMAC signature verification utility |

## Open Questions

2. **Read-only vs full access** — allow write actions (send emails, create tickets) but only after confirmation from the user using green tick reaction
3. **Long-running agents** — If the agent takes >30s, the bot should send a "on it..." message and edit it later

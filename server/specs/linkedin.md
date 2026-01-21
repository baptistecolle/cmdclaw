# LinkedIn Integration Specification

## Overview

Integrate LinkedIn functionality into Bap using **Unipile** as the API provider. Unipile provides a unified API for LinkedIn access without requiring LinkedIn's Partner Program approval.

### Key Decisions
- **Auth model**: Shared Unipile account (Bap-managed), users connect their LinkedIn accounts
- **Connection UX**: Unipile's hosted auth wizard (redirect-based, handles 2FA/OTP automatically)
- **Account limit**: One LinkedIn account per Bap user
- **Cost**: Absorbed by Bap (~$5.50/connected account/month)

---

## Architecture

### How Unipile Differs from Current Integrations

| Aspect | Current Integrations (OAuth) | LinkedIn via Unipile |
|--------|------------------------------|----------------------|
| Auth flow | Direct OAuth with provider | Redirect to Unipile wizard |
| Token storage | Access + refresh tokens | Unipile `account_id` only |
| API calls | Direct to provider (Gmail, HubSpot, etc.) | All through Unipile API |
| Credentials | Per-integration OAuth app | Single Unipile API key |

### Data Flow

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Bap UI    │────▶│  Unipile Wizard │────▶│  LinkedIn   │
│  (Connect)  │     │  (Hosted Auth)  │     │  (Login)    │
└─────────────┘     └────────┬────────┘     └─────────────┘
                             │
                             ▼ webhook callback
                    ┌─────────────────┐
                    │   Bap Backend   │
                    │ (store account) │
                    └────────┬────────┘
                             │
                             ▼ CLI uses account_id
                    ┌─────────────────┐     ┌─────────────┐
                    │  LinkedIn CLI   │────▶│ Unipile API │
                    │  (in sandbox)   │     │             │
                    └─────────────────┘     └─────────────┘
```

---

## Implementation Plan

### 1. Environment & Configuration

**New environment variables:**
```env
UNIPILE_API_KEY=xxx           # Unipile access token from dashboard
UNIPILE_DSN=api.unipile.com   # Unipile API base URL
UNIPILE_WEBHOOK_SECRET=xxx    # For verifying webhook signatures (optional)
```

**Files to modify:**
- `src/env.ts` - Add new env vars

### 2. Database Schema Changes

**File:** `src/server/db/schema.ts`

```typescript
// Add to integrationTypeEnum
integrationTypeEnum = pgEnum("integration_type", [
  // ... existing ...
  "linkedin",
]);

// The integration table already has:
// - providerAccountId (will store Unipile account_id)
// - metadata (will store { unipileAccountId, linkedinProfileUrl, etc. })
// - enabled flag

// NO changes to integrationToken table - we don't store OAuth tokens for LinkedIn
// The Unipile account_id IS the credential
```

### 3. OAuth Config (Adapter Pattern)

**File:** `src/server/oauth/config.ts`

LinkedIn won't use standard OAuth. Instead, create a special config:

```typescript
linkedin: () => ({
  clientId: "", // Not used
  clientSecret: "", // Not used
  authUrl: "", // Not used - we generate Unipile wizard URL instead
  tokenUrl: "", // Not used
  redirectUri: `${getAppUrl()}/api/integrations/linkedin/callback`,
  scopes: [], // Not applicable
  getUserInfo: async (accountId: string) => {
    // Fetch from Unipile API using account_id
    const profile = await unipileClient.getOwnProfile(accountId);
    return {
      id: accountId,
      displayName: profile.name,
      metadata: {
        unipileAccountId: accountId,
        linkedinProfileUrl: profile.public_identifier,
        linkedinId: profile.provider_id,
      },
    };
  },
}),
```

### 4. Custom Auth Flow for LinkedIn

**New file:** `src/server/integrations/unipile.ts`

```typescript
import { env } from "@/env";

const UNIPILE_BASE = `https://${env.UNIPILE_DSN}`;

export async function generateLinkedInAuthUrl(userId: string, redirectUrl: string): Promise<string> {
  // Call Unipile's hosted auth API
  const response = await fetch(`${UNIPILE_BASE}/api/v1/hosted/accounts/link`, {
    method: "POST",
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "LINKEDIN",
      api_url: env.UNIPILE_DSN,
      expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
      notify_url: `${getAppUrl()}/api/integrations/linkedin/webhook`,
      redirect_url: redirectUrl,
      name: userId, // Pass userId to identify in webhook
    }),
  });

  const data = await response.json();
  return data.url; // Redirect user to this URL
}

export async function getUnipileAccount(accountId: string) {
  const response = await fetch(`${UNIPILE_BASE}/api/v1/accounts/${accountId}`, {
    headers: { "X-API-KEY": env.UNIPILE_API_KEY },
  });
  return response.json();
}

// ... other Unipile API wrappers
```

### 5. Webhook Handler

**New file:** `src/app/api/integrations/linkedin/webhook/route.ts`

```typescript
export async function POST(request: Request) {
  const body = await request.json();

  // Unipile sends webhook when account is connected
  if (body.event === "account.created" || body.event === "account.connected") {
    const { account_id, name: userId } = body;

    // Fetch account details from Unipile
    const account = await getUnipileAccount(account_id);

    // Store in our integration table
    await db.insert(integration).values({
      userId,
      type: "linkedin",
      providerAccountId: account_id,
      displayName: account.name,
      enabled: true,
      metadata: {
        unipileAccountId: account_id,
        linkedinProfileUrl: account.identifier,
      },
    });
  }

  return Response.json({ ok: true });
}
```

### 6. Integration Router Updates

**File:** `src/server/orpc/routers/integration.ts`

Add special handling for LinkedIn in `getAuthUrl`:

```typescript
getAuthUrl: protectedProcedure
  .input(z.object({ type: z.string(), redirectUrl: z.string() }))
  .handler(async ({ input, context }) => {
    if (input.type === "linkedin") {
      // Use Unipile hosted auth instead of standard OAuth
      const url = await generateLinkedInAuthUrl(context.user.id, input.redirectUrl);
      return { url };
    }
    // ... existing OAuth flow for other integrations
  }),
```

### 7. CLI Tool

**New file:** `src/e2b-template/cli/linkedin.ts`

```typescript
import { parseArgs } from "util";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
const UNIPILE_DSN = process.env.UNIPILE_DSN;
const LINKEDIN_ACCOUNT_ID = process.env.LINKEDIN_ACCOUNT_ID;

if (!UNIPILE_API_KEY || !LINKEDIN_ACCOUNT_ID) {
  console.error("Error: UNIPILE_API_KEY and LINKEDIN_ACCOUNT_ID required");
  process.exit(1);
}

const BASE_URL = `https://${UNIPILE_DSN}/api/v1`;
const headers = {
  "X-API-KEY": UNIPILE_API_KEY,
  "Content-Type": "application/json",
};

// ========== MESSAGING ==========
async function listChats() { /* ... */ }
async function getChat(chatId: string) { /* ... */ }
async function sendMessage(chatId: string, text: string) { /* ... */ }
async function startChat(attendeeId: string, message: string) { /* ... */ }
async function listMessages(chatId: string) { /* ... */ }

// ========== PROFILES ==========
async function getProfile(identifier: string) { /* ... */ }
async function getMyProfile() { /* ... */ }
async function getCompanyProfile(identifier: string) { /* ... */ }
async function searchUsers(query: string) { /* ... */ }

// ========== INVITATIONS ==========
async function sendInvitation(profileId: string, message?: string) { /* ... */ }
async function listPendingInvitations() { /* ... */ }
async function listConnections() { /* ... */ }
async function removeConnection(profileId: string) { /* ... */ }

// ========== POSTS ==========
async function createPost(text: string, visibility?: string) { /* ... */ }
async function getPost(postId: string) { /* ... */ }
async function listPosts(profileId?: string) { /* ... */ }
async function commentOnPost(postId: string, text: string) { /* ... */ }
async function reactToPost(postId: string, reaction: string) { /* ... */ }

// ========== COMPANY ==========
async function listCompanyPosts(companyId: string) { /* ... */ }
async function createCompanyPost(companyId: string, text: string) { /* ... */ }

// Main command router...
```

### 8. CLI Environment Injection

**File:** `src/server/integrations/cli-env.ts`

```typescript
// Add to ENV_VAR_MAP (note: LinkedIn uses account_id, not token)
const ENV_VAR_MAP: Record<IntegrationType, string> = {
  // ... existing ...
  linkedin: "LINKEDIN_ACCOUNT_ID",
};

// Add special handling in getCliEnvForUser:
export async function getCliEnvForUser(userId: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // Existing token-based integrations...
  const tokens = await getValidTokensForUser(userId);
  for (const [type, accessToken] of tokens) {
    // ...
  }

  // LinkedIn special case - uses Unipile account_id
  const linkedinIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "linkedin"),
      eq(integration.enabled, true)
    ),
  });

  if (linkedinIntegration) {
    env.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
    env.UNIPILE_API_KEY = envVars.UNIPILE_API_KEY; // Shared API key
    env.UNIPILE_DSN = envVars.UNIPILE_DSN;
  }

  return env;
}
```

### 9. CLI Instructions

**File:** `src/server/integrations/cli-env.ts`

```typescript
if (enabledIntegrations.includes("linkedin")) {
  instructions.push(`
## LinkedIn CLI (via Unipile)
MESSAGING
- linkedin chats list [-l limit]                    List conversations
- linkedin chats get <chatId>                       Get conversation details
- linkedin messages list <chatId> [-l limit]        List messages in chat
- linkedin messages send <chatId> --text <message>  Send message
- linkedin messages start <profileId> --text <msg>  Start new conversation

PROFILES
- linkedin profile me                               Get my profile
- linkedin profile get <identifier>                 Get user profile (URL or ID)
- linkedin profile company <identifier>             Get company profile
- linkedin search -q <query> [-l limit]             Search for people

INVITATIONS & CONNECTIONS
- linkedin invite send <profileId> [--message <m>]  Send connection request
- linkedin invite list                              List pending invitations
- linkedin connections list [-l limit]              List my connections
- linkedin connections remove <profileId>           Remove connection

POSTS & CONTENT
- linkedin posts list [--profile <id>] [-l limit]   List posts
- linkedin posts get <postId>                       Get post details
- linkedin posts create --text <content>            Create a post
- linkedin posts comment <postId> --text <comment>  Comment on post
- linkedin posts react <postId> --type <LIKE|...>   React to post

COMPANY PAGES
- linkedin company posts <companyId> [-l limit]     List company posts
- linkedin company post <companyId> --text <text>   Post as company (if admin)`);
}
```

### 10. Agent Runner Permissions

**File:** `src/e2b-template/agent-runner.ts`

```typescript
const TOOL_PERMISSIONS = {
  // ... existing ...
  linkedin: {
    read: [
      "chats list", "chats get",
      "messages list",
      "profile me", "profile get", "profile company",
      "search",
      "invite list",
      "connections list",
      "posts list", "posts get",
      "company posts",
    ],
    write: [
      "messages send", "messages start",
      "invite send",
      "connections remove",
      "posts create", "posts comment", "posts react",
      "company post",
    ],
  },
};
```

---

## CLI Tool Detailed Implementation

### Messaging Operations

```typescript
// linkedin.ts

async function listChats(limit = 20) {
  const res = await fetch(
    `${BASE_URL}/chats?account_id=${LINKEDIN_ACCOUNT_ID}&limit=${limit}`,
    { headers }
  );
  const data = await res.json();
  console.log(JSON.stringify(data.items.map((c: any) => ({
    id: c.id,
    attendees: c.attendees?.map((a: any) => a.display_name),
    lastMessage: c.last_message?.text?.substring(0, 100),
    updatedAt: c.updated_at,
  })), null, 2));
}

async function sendMessage(chatId: string, text: string) {
  const res = await fetch(`${BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
    }),
  });
  const data = await res.json();
  console.log(`Message sent. ID: ${data.message_id}`);
}

async function startChat(attendeeId: string, message: string) {
  const res = await fetch(`${BASE_URL}/chats`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      attendees_ids: [attendeeId],
      text: message,
    }),
  });
  const data = await res.json();
  console.log(`Chat started. ID: ${data.chat_id}`);
}
```

### Profile Operations

```typescript
async function getProfile(identifier: string) {
  // identifier can be LinkedIn URL or provider_id
  const res = await fetch(
    `${BASE_URL}/users/${encodeURIComponent(identifier)}?account_id=${LINKEDIN_ACCOUNT_ID}`,
    { headers }
  );
  const data = await res.json();
  console.log(JSON.stringify({
    id: data.provider_id,
    name: data.display_name,
    headline: data.headline,
    location: data.location,
    profileUrl: data.public_identifier,
    connections: data.connections_count,
    company: data.current_company,
  }, null, 2));
}

async function searchUsers(query: string, limit = 20) {
  const res = await fetch(`${BASE_URL}/users/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      query,
      limit,
    }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data.items.map((u: any) => ({
    id: u.provider_id,
    name: u.display_name,
    headline: u.headline,
    profileUrl: u.public_identifier,
  })), null, 2));
}
```

### Invitation Operations

```typescript
async function sendInvitation(profileId: string, message?: string) {
  const res = await fetch(`${BASE_URL}/users/invite`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      provider_id: profileId,
      message,
    }),
  });
  if (res.ok) {
    console.log(`Invitation sent to ${profileId}`);
  } else {
    const error = await res.text();
    console.error(`Failed to send invitation: ${error}`);
  }
}

async function listConnections(limit = 50) {
  const res = await fetch(
    `${BASE_URL}/users/relations?account_id=${LINKEDIN_ACCOUNT_ID}&limit=${limit}`,
    { headers }
  );
  const data = await res.json();
  console.log(JSON.stringify(data.items.map((c: any) => ({
    id: c.provider_id,
    name: c.display_name,
    headline: c.headline,
    connectedAt: c.connected_at,
  })), null, 2));
}
```

### Post Operations

```typescript
async function createPost(text: string, visibility = "PUBLIC") {
  const res = await fetch(`${BASE_URL}/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
      visibility, // PUBLIC, CONNECTIONS
    }),
  });
  const data = await res.json();
  console.log(`Post created. ID: ${data.post_id}`);
}

async function commentOnPost(postId: string, text: string) {
  const res = await fetch(`${BASE_URL}/posts/${postId}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      text,
    }),
  });
  const data = await res.json();
  console.log(`Comment added. ID: ${data.comment_id}`);
}

async function reactToPost(postId: string, reactionType: string) {
  // reactionType: LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY
  const res = await fetch(`${BASE_URL}/posts/${postId}/reactions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_id: LINKEDIN_ACCOUNT_ID,
      reaction_type: reactionType,
    }),
  });
  if (res.ok) {
    console.log(`Reacted with ${reactionType}`);
  }
}
```

---

## UI Components

### Settings Page Integration Card

**File:** `src/app/settings/integrations/page.tsx`

LinkedIn should appear alongside other integrations with:
- LinkedIn logo/branding
- "Connect LinkedIn" button (redirects to Unipile wizard)
- Connected state showing profile name and avatar
- Disconnect button

### Preview Components

**New file:** `src/components/chat/linkedin-preview.tsx`

Rich previews for LinkedIn tool results:
- **Profile card**: Photo, name, headline, company, connection status
- **Message thread**: Conversation view with sender avatars
- **Post card**: Author, content, reactions, comments count
- **Invitation card**: Pending invitation with accept/ignore

---

## Webhook Events to Handle

| Event | Action |
|-------|--------|
| `account.created` | Store new integration record |
| `account.connected` | Update integration status |
| `account.disconnected` | Mark integration as disabled |
| `account.error` | Log error, notify user if needed |

---

## Error Handling

### Common Unipile Errors

| Error | Handling |
|-------|----------|
| `ACCOUNT_NOT_FOUND` | Prompt user to reconnect |
| `RATE_LIMITED` | Unipile handles automatically, surface to user if persistent |
| `CHECKPOINT_REQUIRED` | Rare with hosted auth, prompt reconnection |
| `ACCOUNT_SUSPENDED` | Notify user their LinkedIn account has issues |

### CLI Error Format

```typescript
try {
  // ... API call
} catch (e) {
  console.error(JSON.stringify({
    error: true,
    code: e.code || "UNKNOWN",
    message: e.message,
  }));
  process.exit(1);
}
```

---

## Testing Plan

### Unit Tests
- Unipile API wrapper functions
- Webhook payload parsing
- CLI argument parsing

### Integration Tests
- Auth flow: generate URL → webhook → integration stored
- CLI commands with mock Unipile responses
- Token/account injection into sandbox

### E2E Tests
- Full connection flow in UI
- Agent using LinkedIn commands in chat

---

## Migration / Rollout

1. **Phase 1**: Backend infrastructure
   - Add env vars
   - Schema migration
   - Unipile client wrapper
   - Webhook handler

2. **Phase 2**: CLI tool
   - Implement all commands
   - Add CLI instructions
   - Add permissions config

3. **Phase 3**: UI integration
   - Settings page card
   - Preview components
   - Connection status indicators

4. **Phase 4**: Testing & polish
   - Error handling
   - Rate limit messaging
   - Disconnect/reconnect flows

---

## Files to Create/Modify Summary

### New Files
- `src/server/integrations/unipile.ts` - Unipile API client
- `src/app/api/integrations/linkedin/webhook/route.ts` - Webhook handler
- `src/e2b-template/cli/linkedin.ts` - CLI tool
- `src/components/chat/linkedin-preview.tsx` - Rich previews

### Modified Files
- `src/env.ts` - Add UNIPILE_* env vars
- `src/server/db/schema.ts` - Add "linkedin" to integrationTypeEnum
- `src/server/oauth/config.ts` - Add linkedin config (adapter)
- `src/server/integrations/cli-env.ts` - Add LinkedIn env vars and instructions
- `src/server/orpc/routers/integration.ts` - Special handling for LinkedIn auth
- `src/e2b-template/agent-runner.ts` - Add LinkedIn permissions
- `src/app/settings/integrations/page.tsx` - Add LinkedIn card

---

## Security Considerations

1. **Shared API key**: The Unipile API key is shared across all users but scoped by `account_id` per request
2. **Account isolation**: Each user can only access their own linked LinkedIn account
3. **Webhook verification**: Validate webhook signatures if Unipile provides them
4. **Sensitive actions**: Connection requests, messages, and posts require user approval in the agent flow

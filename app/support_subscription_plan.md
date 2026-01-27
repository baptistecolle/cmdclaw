# Support ChatGPT & Gemini Subscription Auth

## Goal

Let users connect their existing **ChatGPT Plus/Pro/Max** or **Google Gemini Advanced** subscriptions to use OpenAI and Google models in Bap — no API keys needed. Lean on OpenCode's built-in provider auth as much as possible.

---

## Current Architecture

- OpenCode runs as a **server inside ephemeral E2B sandboxes**
- Sandbox gets `ANTHROPIC_API_KEY` as env var (`e2b.ts:73`)
- `providerID` is hardcoded to `"anthropic"` (`generation-manager.ts:650`)
- Model is per-conversation but always Anthropic

---

## How OpenCode Already Handles This

The `@opencode-ai/sdk` exposes everything needed:

| SDK Method | Purpose |
|---|---|
| `provider.auth()` | List auth methods per provider (returns `{ [providerID]: [{type: "oauth" \| "api", label}] }`) |
| `provider.oauth.authorize({path: {id}, body: {method}})` | Start OAuth flow — returns `{url, method: "auto" \| "code", instructions}` |
| `provider.oauth.callback({path: {id}, body: {code, method}})` | Complete OAuth with auth code — returns `boolean` |
| **`auth.set({path: {id}, body: OAuthTokens})`** | **Inject tokens directly** into a running OpenCode server |
| `config.providers()` | List all available providers + models |

The `auth.set()` body accepts:
```ts
{
  type: "oauth",
  access: string,    // access token
  refresh: string,   // refresh token
  expires: number,   // expiration timestamp (ms)
}
```

---

## Design

### Flow Overview

```
User clicks "Connect ChatGPT" in Settings
        │
        ▼
Bap ensures a sandbox is running (or spins one up)
        │
        ▼
Bap calls client.provider.oauth.authorize({ path: { id: "openai" }, body: { method: 0 } })
        │
        ▼
OpenCode returns { url, method, instructions }
        │
        ├── method: "auto"  → OpenCode expects browser redirect back to sandbox
        │                      (won't work in web app — fallback to "code")
        │
        └── method: "code"  → User visits URL, authenticates, gets a code
                               Bap calls client.provider.oauth.callback() with that code
        │
        ▼
OpenCode processes the OAuth internally, stores tokens in its runtime
        │
        ▼
Bap reads back the auth state and persists tokens in its own DB
(so they survive sandbox destruction)
        │
        ▼
On future sandbox creation, Bap calls client.auth.set() to inject stored tokens
```

### The Problem: "auto" vs "code"

OpenCode's OAuth was designed for CLI use:
- **"auto"** opens a browser and expects redirect to `localhost` or the OpenCode server — doesn't work when the server is inside an E2B sandbox with a dynamic URL
- **"code"** gives the user a URL and expects them to paste a code back — works but clunky UX

**Better approach for a web app:** Bap implements a thin OAuth redirect handler on its own domain, then injects the resulting tokens via `auth.set()`. This avoids asking users to copy-paste codes.

### Recommended Approach: Bap OAuth Redirect + OpenCode `auth.set()`

1. **Bap handles the browser OAuth redirect** (standard web OAuth flow)
2. **OpenCode handles everything else** — model routing, token refresh (via `auth.set()`), API calls

This means Bap only needs:
- An OAuth callback route (`/api/auth/provider/callback`)
- A DB table for tokens
- A call to `auth.set()` when sandboxes start

---

## Implementation

### 1. Database: `provider_auth` Table

Store encrypted OAuth tokens per user per provider.

```ts
// src/server/db/schema.ts
export const providerAuth = pgTable("provider_auth", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),       // "openai" | "google"
  accessToken: text("access_token").notNull(), // encrypted
  refreshToken: text("refresh_token").notNull(), // encrypted
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueUserProvider: unique().on(table.userId, table.provider),
}));
```

Run `bun db:push`.

### 2. OAuth Configuration

Only two providers to support:

```ts
// src/server/ai/subscription-providers.ts

export const SUBSCRIPTION_PROVIDERS = {
  openai: {
    name: "ChatGPT",
    description: "Use your ChatGPT Plus/Pro/Max subscription",
    // OpenAI Codex public client (PKCE, no secret needed)
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authUrl: "https://auth.openai.com/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    // Bap's callback — registered or using PKCE public client flow
    redirectUri: `${process.env.APP_URL}/api/auth/provider/openai/callback`,
    usePKCE: true,
    models: [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "o3", name: "o3" },
      { id: "o4-mini", name: "o4-mini" },
      { id: "codex-mini", name: "Codex Mini" },
    ],
  },
  google: {
    name: "Gemini",
    description: "Use your Google AI Pro/Ultra subscription",
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${process.env.APP_URL}/api/auth/provider/google/callback`,
    scopes: ["https://www.googleapis.com/auth/cloud-platform", "openid"],
    usePKCE: false,
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
} as const;
```

**Note on OpenAI:** The Codex OAuth uses PKCE (public client) — no client secret needed. The client ID `app_EMoamEEZ73f0CkXaXp7hrann` is the same one used by Codex CLI and OpenCode. This is a public PKCE client, so any app can use it.

**Note on Google:** Google OAuth requires a registered OAuth client (client ID + secret) from Google Cloud Console. The scope `cloud-platform` gives access to the Gemini API. The subscription tier (free vs Pro vs Ultra) is determined by the Google account, not the OAuth scope.

### 3. OAuth Flow Routes

```ts
// src/server/orpc/routers/provider-auth.ts

// GET /provider-auth/connect/:provider
// → Generate PKCE challenge (for OpenAI) or state param
// → Store verifier in session/cookie
// → Return the authorization URL for the frontend to open

// GET /api/auth/provider/:provider/callback
// → Exchange auth code for tokens (using PKCE verifier for OpenAI)
// → Encrypt and store tokens in provider_auth table
// → Redirect to settings page with success message

// GET /provider-auth/status
// → Return which providers the user has connected

// DELETE /provider-auth/disconnect/:provider
// → Remove stored tokens for this provider
```

### 4. Inject Tokens into Sandbox via `auth.set()`

Update `e2b.ts` — after the OpenCode server starts, inject any stored subscription tokens:

```ts
// In getOrCreateSandbox() or getOrCreateSession(), after client is created:

async function injectProviderAuth(client: OpencodeClient, userId: string) {
  const auths = await db.query.providerAuth.findMany({
    where: eq(providerAuth.userId, userId),
  });

  for (const auth of auths) {
    await client.auth.set({
      path: { id: auth.provider },
      body: {
        type: "oauth",
        access: decrypt(auth.accessToken),
        refresh: decrypt(auth.refreshToken),
        expires: auth.expiresAt.getTime(),
      },
    });
  }
}
```

This is the key integration point — it tells the OpenCode server inside the sandbox "this user is authenticated with OpenAI/Google via their subscription." OpenCode then uses those tokens when making API calls for the corresponding provider.

### 5. Update Generation Manager

Support multiple providers in `generation-manager.ts`:

```ts
// Replace hardcoded providerID
// Before:
const modelConfig = {
  providerID: "anthropic",
  modelID: ctx.model,
};

// After:
const modelConfig = {
  providerID: resolveProviderID(ctx.model),
  modelID: ctx.model,
};

function resolveProviderID(modelID: string): string {
  if (modelID.startsWith("claude")) return "anthropic";
  if (modelID.startsWith("gpt") || modelID.startsWith("o3") || modelID.startsWith("o4") || modelID.startsWith("codex")) return "openai";
  if (modelID.startsWith("gemini")) return "google";
  return "anthropic"; // default
}
```

Also update `SandboxConfig` to accept `userId` so `injectProviderAuth` can be called:

```ts
interface SandboxConfig {
  conversationId: string;
  userId: string;                    // NEW
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
}
```

### 6. Model Picker (Frontend)

Update the conversation model picker to show models from connected providers:

- Always show Anthropic models (platform-provided)
- Show OpenAI models only if user has connected ChatGPT subscription
- Show Gemini models only if user has connected Gemini subscription
- Group by provider with visual indicator of subscription source

Use the `/provider-auth/status` endpoint to know which providers are connected.

### 7. Settings UI: Connected Providers

Add a **Settings > Subscriptions** section:

- Show ChatGPT and Gemini as two cards
- Each shows: connected/disconnected status, account info if connected
- "Connect" button initiates the OAuth flow (opens popup → auth URL → callback)
- "Disconnect" button removes stored tokens

---

## Token Refresh

OAuth access tokens expire (typically 1 hour). Two strategies:

**Option A: Let OpenCode handle refresh internally**
- OpenCode already handles token refresh when it gets a 401
- As long as the refresh token is valid, this works transparently
- Bap doesn't need to do anything extra during a sandbox session

**Option B: Bap refreshes tokens periodically**
- Before creating a sandbox, check if the access token is expired
- If expired, call the provider's token endpoint with the refresh token
- Update the DB with new tokens
- Inject fresh tokens via `auth.set()`

**Recommended:** Combine both — Bap refreshes on sandbox creation, OpenCode handles mid-session refresh.

---

## Implementation Steps

1. **DB schema** — Add `providerAuth` table, run `bun db:push`
2. **Encryption** — Add `encrypt()`/`decrypt()` utility (AES-256-GCM) + `ENCRYPTION_KEY` env var
3. **Provider config** — `src/server/ai/subscription-providers.ts` with OpenAI + Google OAuth details
4. **OAuth routes** — Connect/callback/status/disconnect endpoints
5. **Token injection** — `injectProviderAuth()` in `e2b.ts`, called after sandbox OpenCode server starts
6. **Generation manager** — `resolveProviderID()` to map model IDs to provider IDs
7. **Settings UI** — Subscription connection cards
8. **Model picker** — Show available models based on connected providers

---

## Security

- **Encrypted at rest**: OAuth tokens encrypted with AES-256-GCM before DB storage
- **PKCE for OpenAI**: No client secret stored or transmitted — PKCE code verifier is ephemeral
- **Server-side only**: Tokens decrypted only inside `injectProviderAuth()`, never sent to the frontend
- **Scoped**: Each user can only access their own tokens
- **Revocable**: Users can disconnect at any time, tokens are deleted from DB

---

## Caveats

- **ChatGPT quota**: Using subscription through OpenCode consumes quota faster than native ChatGPT/Codex. Users should be warned about this in the UI.
- **Gemini subscription recognition**: There is a known bug where Google OAuth sometimes returns free-tier quota even for paid subscribers. Monitor and update as Google fixes this.
- **OpenAI client ID**: The Codex PKCE client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) is a public client used by Codex CLI and OpenCode. If OpenAI changes or restricts it, this flow breaks. Monitor OpenAI developer docs.
- **Google OAuth**: Requires registering an OAuth client in Google Cloud Console. The `cloud-platform` scope is broad — consider using a narrower scope if Google provides one for Gemini API specifically.

---

## Sources

- [OpenCode Providers docs](https://opencode.ai/docs/providers/)
- [OpenAI Codex Auth docs](https://developers.openai.com/codex/auth/)
- [opencode-openai-codex-auth plugin](https://github.com/numman-ali/opencode-openai-codex-auth)
- [Gemini CLI Authentication](https://geminicli.com/docs/get-started/authentication/)
- [Gemini CLI Source (auth)](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md)
- [OpenCode + ChatGPT guide](https://aiengineerguide.com/blog/chatgpt-subscription-with-opencode/)

# Custom Integrations: User-Defined Connectors + Community Repo

## Overview

Allow users to connect to **any** API service without manual per-integration coding. Users provide OAuth credentials or API keys, the LLM agent generates a CLI tool following the existing pattern, and the integration becomes immediately usable. Successful integrations are auto-submitted as PRs to a community GitHub repo, making them available to all users after review.

## Goals

- Any user can connect to any REST API by providing credentials (API key or OAuth app credentials).
- The AI agent can generate CLI tools on-the-fly following the existing `src/e2b-template/cli/*.ts` pattern.
- Custom integrations are usable immediately (private to the user) before community review.
- Popular integrations are auto-submitted as PRs to a separate `bap-community-integrations` GitHub repo.
- Support three auth methods: OAuth2, API key (header/query), and Bearer token.
- Custom integrations plug into the existing permission model, CLI env injection, and workflow `allowedIntegrations` system.

## Non-goals (V1)

- No browser/GUI agent for non-API websites.
- No OAuth1 support (only OAuth2).
- No automatic OAuth app registration on providers (users register their own apps).
- No marketplace/rating system for community integrations.
- No visual CLI tool editor in the UI (the LLM generates code).

## Architecture

### Auth Methods

Three auth types supported for custom integrations:

| Auth Type | How it works | User provides |
|-----------|-------------|---------------|
| `oauth2` | Standard OAuth2 flow via generic proxy | `authUrl`, `tokenUrl`, `clientId`, `clientSecret`, `scopes`, optional `pkce`, `authStyle` |
| `api_key` | Static key injected as env var | Key value + delivery method (`header`, `query`, `bearer`) |
| `bearer_token` | Static bearer token | Token value |

#### Generic OAuth2 Proxy

Instead of hardcoded per-provider OAuth configs, custom integrations store OAuth parameters as data in the `customIntegration` table. The existing callback handler (`/api/oauth/callback`) is extended to look up config from DB when the integration type starts with `custom_`.

OAuth2 config stored per custom integration:

```ts
type CustomOAuthConfig = {
  authUrl: string;          // e.g. "https://api.trello.com/1/authorize"
  tokenUrl: string;         // e.g. "https://api.trello.com/1/OAuthGetAccessToken"
  scopes: string[];         // e.g. ["read", "write"]
  pkce: boolean;            // whether to use PKCE (S256)
  authStyle: "header" | "body"; // where to send client creds on token exchange
  extraAuthParams?: Record<string, string>; // e.g. {"duration": "permanent"} for Reddit-style
};
```

The `clientId` and `clientSecret` are stored encrypted per-user in `customIntegrationCredential` (not shared with community).

#### API Key Delivery Methods

```ts
type ApiKeyConfig = {
  method: "header" | "query" | "bearer";
  // For "header": custom header name, e.g. "X-Api-Key", "Authorization"
  headerName?: string;
  // For "query": query param name, e.g. "api_key", "key"
  queryParam?: string;
};
```

### Data Model

#### New table: `customIntegration`

Stores the integration definition (shareable, not user-specific).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| slug | text | Unique identifier, e.g. `trello`, `asana` (lowercase, hyphens) |
| name | text | Display name, e.g. "Trello" |
| description | text | Short description |
| iconUrl | text | Optional icon URL |
| baseUrl | text | API base URL, e.g. `https://api.trello.com/1` |
| authType | text | `oauth2`, `api_key`, `bearer_token` |
| oauthConfig | jsonb | OAuth2 parameters (null for api_key/bearer) |
| apiKeyConfig | jsonb | API key delivery config (null for oauth2) |
| cliCode | text | Generated TypeScript CLI tool source code |
| cliInstructions | text | Markdown help text for the agent (commands + examples) |
| permissions | jsonb | `{ readOps: string[], writeOps: string[] }` |
| createdByUserId | text | FK -> user who created it |
| communityPrUrl | text | GitHub PR URL if submitted |
| communityStatus | text | `pending`, `approved`, `rejected`, null |
| isBuiltIn | boolean | false for user-created, true for promoted ones |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Index: `(slug)` unique.

#### New table: `customIntegrationCredential`

Stores per-user credentials for a custom integration (never shared).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| userId | text | FK -> user |
| customIntegrationId | text | FK -> customIntegration |
| clientId | text | OAuth client ID (encrypted) |
| clientSecret | text | OAuth client secret (encrypted) |
| apiKey | text | API key or bearer token (encrypted) |
| accessToken | text | Current OAuth access token |
| refreshToken | text | OAuth refresh token |
| expiresAt | timestamp | Token expiry |
| metadata | jsonb | Provider-specific data (e.g. instance URL) |
| enabled | boolean | default true |
| displayName | text | e.g. email or account name from provider |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Index: `(userId, customIntegrationId)` unique.

### How Custom Integrations Plug Into Existing System

#### CLI Env Injection (`cli-env.ts`)

Extend `getCliEnvForUser()` to also query `customIntegrationCredential` for the user:
- For each enabled custom integration, inject `{SLUG_UPPER}_ACCESS_TOKEN` (for oauth2) or `{SLUG_UPPER}_API_KEY` (for api_key/bearer).
- Also inject `{SLUG_UPPER}_BASE_URL` so the CLI tool knows the API root.
- For API key integrations with header/query delivery, inject `{SLUG_UPPER}_AUTH_METHOD`, `{SLUG_UPPER}_AUTH_HEADER_NAME`, `{SLUG_UPPER}_AUTH_QUERY_PARAM` as needed.

#### CLI Instructions (`cli-env.ts`)

Extend `getCliInstructions()` to append each custom integration's `cliInstructions` field from the DB.

#### Workflow `allowedIntegrations`

The `allowedIntegrations` column on `workflow` currently uses the `integrationTypeEnum`. For custom integrations, store them as `custom:{slug}` strings in a new `allowedCustomIntegrations` text array column on `workflow`, keeping the enum-based column for built-in ones.

#### Permission Plugin (`integration-permissions.ts`)

Extend the plugin to recognize custom CLI tool names and look up their `permissions` JSON for read/write classification.

#### E2B Sandbox

Custom integration CLI tools are written to `/app/cli/custom-{slug}.ts` in the sandbox at session start. The `cliCode` is pulled from the `customIntegration` table.

### Integration Creation Flow

```
User: "I want to connect to Trello"
  |
  v
Agent: web-fetches Trello API docs
  |
  v
Agent determines auth method:
  - Trello supports OAuth2? -> asks user for clientId/clientSecret
  - Or simple API key? -> asks user to paste key from trello.com/app-key
  |
  v
Agent generates:
  1. CLI tool code (TypeScript, following existing pattern)
  2. CLI instructions (markdown help text)
  3. Permission classification (read vs write ops)
  4. OAuth config (authUrl, tokenUrl, scopes) OR api key config
  |
  v
Server: saves to customIntegration + customIntegrationCredential tables
  |
  v
Integration is immediately available to the user
  |
  v
Auto-submit PR to bap-community-integrations repo (async, background)
```

### Community Repo Auto-PR Flow

```
On customIntegration creation:
  |
  v
Server-side job (not in sandbox, uses server's GitHub token):
  1. Clone/fetch bap-community-integrations repo
  2. Create branch: add-{slug}
  3. Write files:
     integrations/{slug}/
       cli.ts              # CLI tool source
       config.json          # { authType, oauthConfig, apiKeyConfig, baseUrl, permissions }
       instructions.md      # CLI help text
  4. gh pr create --title "Add {name} integration" --body "..."
  5. Update customIntegration.communityPrUrl with PR URL
  |
  v
Maintainers review:
  - CI: type-check, lint, sandboxed test
  - Security review (no suspicious network calls, no credential exfiltration)
  - Merge -> integration available to all users
```

#### Community Repo Structure

```
bap-community-integrations/
  integrations/
    trello/
      cli.ts              # TypeScript CLI tool
      config.json          # Auth config + permissions + base URL
      instructions.md      # Agent-facing help text
    asana/
      cli.ts
      config.json
      instructions.md
  scripts/
    validate.ts           # CI validation script
    build-registry.ts     # Generates registry.json from all integrations
  registry.json           # Auto-generated index of all integrations
  README.md
```

The E2B template pulls `registry.json` + all CLI tools at build time via `git clone` or npm package.

### Generic OAuth Callback Extension

The existing `handleCallback` procedure in `src/server/orpc/routers/integration.ts` is extended:

```
handleCallback receives (type, code, state):
  |
  v
Is type in integrationTypeEnum?
  -> Yes: use existing hardcoded config (current behavior)
  -> No: look up customIntegration by slug
         read oauthConfig from DB
         read clientId/clientSecret from customIntegrationCredential for this user
         exchange code for tokens using generic OAuth2 logic
         store tokens in customIntegrationCredential
```

### Token Refresh for Custom Integrations

Extend `getValidTokensForUser()` in `token-refresh.ts`:
- Also query `customIntegrationCredential` for enabled custom integrations with OAuth tokens.
- Refresh using the stored `oauthConfig.tokenUrl` + user's `clientId`/`clientSecret`.
- Auth style (header vs body) read from `oauthConfig.authStyle`.

## Implementation Plan

### 1. Database Schema

- Add `customIntegration` and `customIntegrationCredential` tables to `src/server/db/schema.ts`.
- Add `allowedCustomIntegrations` text array column to `workflow` table.
- Run `bun db:push`.

### 2. Generic OAuth Proxy

Modify `src/server/oauth/config.ts`:
- Add `getCustomOAuthConfig(slug: string, userId: string)` that reads from DB.
- Returns an `OAuthConfig` object compatible with the existing interface.

Modify `src/server/orpc/routers/integration.ts`:
- Extend `getAuthUrl` to handle custom integration slugs.
- Extend `handleCallback` to handle custom integration token exchange.
- Add new procedures: `createCustomIntegration`, `listCustomIntegrations`, `setCustomCredentials`, `disconnectCustomIntegration`.

### 3. CLI Env Injection

Modify `src/server/integrations/cli-env.ts`:
- `getCliEnvForUser()`: query `customIntegrationCredential` and inject env vars.
- `getCliInstructions()`: append custom integration instructions from DB.
- `getEnabledIntegrationTypes()`: also return custom integration slugs.

### 4. Token Refresh

Modify `src/server/integrations/token-refresh.ts`:
- Add `getValidCustomTokens(userId)` that refreshes custom OAuth tokens.
- Called from `getCliEnvForUser()`.

### 5. Permission Plugin

Modify `src/e2b-template/plugins/integration-permissions.ts`:
- Load custom integration permissions from env var `CUSTOM_INTEGRATION_PERMISSIONS` (JSON).
- Recognize `custom-{slug}` CLI names.
- Apply read/write classification from loaded permissions.

### 6. Sandbox Setup

Modify generation manager (`src/server/services/generation-manager.ts`):
- On session start, write each custom integration's `cliCode` to `/app/cli/custom-{slug}.ts` in the sandbox.
- Pass `CUSTOM_INTEGRATION_PERMISSIONS` env var with permissions JSON.
- Append custom integration CLI instructions to system prompt.

### 7. Community PR Submission

Create `src/server/services/community-integration.ts`:
- `submitToCommunityRepo(customIntegrationId: string)` — creates PR via GitHub API.
- Uses a server-level GitHub token (`COMMUNITY_REPO_GITHUB_TOKEN` env var).
- Called async after custom integration creation.

### 8. Frontend: Custom Integration UI

Modify `src/app/integrations/page.tsx`:
- Add "Custom Integrations" section below built-in integrations.
- "Add Custom Integration" button opens a flow:
  1. User enters service name (or describes what they want).
  2. Agent researches the API and proposes auth method.
  3. User provides credentials (API key paste or OAuth client ID/secret).
  4. Agent generates CLI tool + tests it.
  5. Integration appears in the list.
- Show community status badge (PR pending, approved, etc.).

### 9. Agent-Side Integration Generation

The agent (inside E2B or via direct backend) receives a system prompt addition:

```
When the user asks to connect to a new service:
1. Web-search for the service's API documentation.
2. Determine the best auth method (OAuth2 or API key).
3. Generate a CLI tool following the pattern in /app/cli/*.ts.
4. Call the createCustomIntegration API with the generated code and config.
5. Ask the user for their credentials.
6. Test the integration with a simple read operation.
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/server/db/schema.ts` | **Modify** — add `customIntegration`, `customIntegrationCredential` tables, `allowedCustomIntegrations` on `workflow` |
| `src/server/oauth/config.ts` | **Modify** — add `getCustomOAuthConfig()` |
| `src/server/orpc/routers/integration.ts` | **Modify** — add custom integration CRUD procedures, extend OAuth flow |
| `src/server/integrations/cli-env.ts` | **Modify** — inject custom integration env vars + instructions |
| `src/server/integrations/token-refresh.ts` | **Modify** — refresh custom OAuth tokens |
| `src/e2b-template/plugins/integration-permissions.ts` | **Modify** — recognize custom CLIs |
| `src/server/services/generation-manager.ts` | **Modify** — write custom CLI tools to sandbox |
| `src/server/services/community-integration.ts` | **Create** — GitHub PR submission service |
| `src/app/integrations/page.tsx` | **Modify** — add custom integration section |
| `src/env.js` | **Modify** — add `COMMUNITY_REPO_GITHUB_TOKEN`, `COMMUNITY_REPO_OWNER`, `COMMUNITY_REPO_NAME` |

## Open Questions

1. **Credential encryption** — Should we use app-level encryption (AES-256) for stored client secrets/API keys, or rely on DB-level encryption? App-level is more portable but adds complexity.
2. **CLI tool sandboxing** — User-generated CLI code runs inside E2B which is already sandboxed, but should we add additional restrictions (e.g., only allow network calls to the declared `baseUrl`)?
3. **Rate limiting** — Should community PR submissions be rate-limited per user to prevent spam?
4. **Community repo CI** — What level of automated testing should run on PRs? Type-check + lint is easy; actually calling the API requires test credentials.
5. **Deduplication** — If two users create integrations for the same service, how do we merge/deduplicate in the community repo?

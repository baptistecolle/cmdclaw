# Request Connection Feature Spec

## Overview

Allow the agent to request user authentication to a service mid-conversation when a required integration is not connected. The user can connect directly from the chat interface without leaving the conversation.

## User Flow

1. User asks agent to perform a task requiring an integration (e.g., "send a Slack message")
2. CLI tool attempts operation, detects missing/invalid token
3. CLI returns structured error with `AUTH_REQUIRED` code
4. Agent runner emits `auth_needed` event (can include multiple integrations)
5. Generation pauses (status: `awaiting_auth`)
6. Chat UI displays connection card(s) with:
   - Service icon and name
   - "Connect" button
   - "Cancel" button (cancels the generation)
7. User clicks "Connect":
   - Opens OAuth flow in same window
   - Redirect URL: `/chat/{conversationId}?auth_complete={integration}`
8. After OAuth completes:
   - Frontend detects `auth_complete` param
   - Notifies server via `submitAuthResult`
   - Generation resumes with new token injected
   - Agent retries the operation

## Design Decisions

- **Detection**: Reactive - CLI tools report missing auth when they encounter it
- **Multiple integrations**: Request all at once if detectable
- **Skip behavior**: Cancels the generation (user must explicitly connect or cancel)
- **Redirect**: Returns to conversation page with query param

## Technical Design

### 1. New Event Type

```typescript
// In generation-manager.ts events
type AuthNeededEvent = {
  type: "auth_needed";
  generationId: string;
  conversationId: string;
  integrations: IntegrationType[]; // ["slack", "gmail"] - can be multiple
  reason?: string; // Optional context for why auth is needed
};
```

### 2. Database Changes

```typescript
// In schema.ts - generation table
pendingAuth: jsonb<{
  integrations: IntegrationType[];  // All integrations needed
  connectedIntegrations: IntegrationType[];  // Already connected during this request
  requestedAt: string;
  reason?: string;
}>.$type<PendingAuth | null>(),
```

### 3. Generation Status

Add new status value:
```typescript
status: enum("running", "awaiting_approval", "awaiting_auth", "paused", "completed", "cancelled", "error")
```

### 4. Detection Logic (Reactive)

CLI tools detect missing/invalid tokens and return structured errors:

```typescript
// CLI tool (e.g., slack-cli) returns:
{
  error: {
    code: "AUTH_REQUIRED",
    integration: "slack",
    message: "Slack authentication required to send messages"
  }
}
```

Agent runner intercepts tool results and emits auth event:

```typescript
// In agent-runner.ts - PostToolUse hook or tool_result handler
if (result.error?.code === "AUTH_REQUIRED") {
  // Emit auth_needed event to server
  console.log(JSON.stringify({
    type: "auth_needed",
    integrations: [result.error.integration],
    reason: result.error.message
  }));

  // Wait for auth response file (similar to approval flow)
  const response = await waitForFile("/tmp/auth-response.json", AUTH_TIMEOUT_MS);

  if (response.success) {
    // Token was added - retry the tool call
    return { retry: true };
  } else {
    // User cancelled - stop generation
    return { cancel: true };
  }
}
```

### 5. Server Handling (generation-manager.ts)

```typescript
private async handleAuthNeeded(event: AuthNeededEvent) {
  this.context.status = "awaiting_auth";
  this.context.pendingAuth = {
    integrations: event.integrations,
    connectedIntegrations: [],
    requestedAt: new Date().toISOString(),
    reason: event.reason,
  };

  // Save to DB
  await this.saveGenerationState();

  // Broadcast to subscribers
  this.broadcast({
    type: "auth_needed",
    ...event
  });

  // Start timeout (10 min - longer than approval since OAuth takes time)
  this.startAuthTimeout();
}

async submitAuthResult(integration: IntegrationType, success: boolean) {
  if (!this.context.pendingAuth) return;

  if (!success) {
    // User cancelled - cancel the generation
    await this.cancelGeneration();
    return;
  }

  // Track connected integration
  this.context.pendingAuth.connectedIntegrations.push(integration);

  const allConnected = this.context.pendingAuth.integrations.every(
    i => this.context.pendingAuth!.connectedIntegrations.includes(i)
  );

  if (allConnected) {
    // All integrations connected - refresh tokens and resume
    const newTokens = await getValidTokensForUser(this.userId);

    // Inject new tokens into sandbox environment
    await this.injectTokensToSandbox(newTokens);

    // Write success response to sandbox
    await this.sandbox.files.write("/tmp/auth-response.json", JSON.stringify({
      success: true,
      integrations: this.context.pendingAuth.connectedIntegrations,
      timestamp: Date.now()
    }));

    // Clear pending auth and resume
    this.context.pendingAuth = null;
    this.context.status = "running";

    // Broadcast result
    this.broadcast({
      type: "auth_result",
      success: true,
      integrations: this.context.pendingAuth?.connectedIntegrations
    });
  } else {
    // Still waiting for more integrations - broadcast progress
    this.broadcast({
      type: "auth_progress",
      connected: integration,
      remaining: this.context.pendingAuth.integrations.filter(
        i => !this.context.pendingAuth!.connectedIntegrations.includes(i)
      )
    });
  }
}

private async injectTokensToSandbox(tokens: Map<IntegrationType, string>) {
  // Update sandbox environment with new tokens
  for (const [type, token] of tokens) {
    const envVar = getEnvVarName(type); // e.g., SLACK_ACCESS_TOKEN
    await this.sandbox.commands.run(`export ${envVar}="${token}"`);
  }
}
```

### 6. Frontend Components

**New: AuthRequestCard component**
```typescript
// components/chat/auth-request-card.tsx
interface AuthRequestCardProps {
  integrations: IntegrationType[];
  connectedIntegrations: IntegrationType[];
  reason?: string;
  onConnect: (integration: IntegrationType) => void;
  onCancel: () => void;
}

// Renders a card for each integration needed
// Shows checkmark for already connected ones
// Shows "Connect" button for pending ones
// Single "Cancel" button cancels the entire generation
```

**Integration with chat-area.tsx**
```typescript
// State for pending auth
const [pendingAuth, setPendingAuth] = useState<{
  generationId: string;
  integrations: IntegrationType[];
  connectedIntegrations: IntegrationType[];
  reason?: string;
} | null>(null);

// Handle auth_needed event in subscription
callbacks.onAuthNeeded = ({ generationId, integrations, reason }) => {
  setPendingAuth({
    generationId,
    integrations,
    connectedIntegrations: [],
    reason
  });
};

// Handle auth_progress event
callbacks.onAuthProgress = ({ connected, remaining }) => {
  setPendingAuth(prev => prev ? {
    ...prev,
    connectedIntegrations: [...prev.connectedIntegrations, connected]
  } : null);
};

// Connect button handler
const handleAuthConnect = async (integration: IntegrationType) => {
  const result = await getAuthUrl.mutateAsync({
    type: integration,
    redirectUrl: `${window.location.origin}/chat/${conversationId}?auth_complete=${integration}&generation_id=${pendingAuth?.generationId}`
  });
  window.location.href = result.authUrl;
};

// Cancel button handler
const handleAuthCancel = async () => {
  if (pendingAuth) {
    await client.generation.submitAuthResult({
      generationId: pendingAuth.generationId,
      integration: pendingAuth.integrations[0], // Any integration
      success: false
    });
    setPendingAuth(null);
  }
};
```

**Handle OAuth callback in conversation**
```typescript
// In chat page useEffect
const authComplete = searchParams.get("auth_complete");
const generationId = searchParams.get("generation_id");

if (authComplete && generationId) {
  // Notify server that auth is complete
  await client.generation.submitAuthResult({
    generationId,
    integration: authComplete as IntegrationType,
    success: true
  });
  // Clear URL params
  window.history.replaceState({}, "", `/chat/${conversationId}`);
}
```

### 7. ORPC Endpoints

```typescript
// routers/generation.ts
submitAuthResult: baseProcedure
  .input(z.object({
    generationId: z.string(),
    integration: z.enum([...integrationTypes]),
    success: z.boolean(),
  }))
  .mutation(async ({ input, ctx }) => {
    const manager = generationManager.get(input.generationId);
    await manager.submitAuthResult(input.integration, input.success);
    return { success: true };
  }),
```

## Implementation Order

1. **Schema changes** - Add `pendingAuth` field and `awaiting_auth` status
2. **Generation manager** - Handle `auth_needed` event, `submitAuthResult`, token injection
3. **ORPC endpoint** - Add `submitAuthResult` mutation
4. **Agent runner** - Detect `AUTH_REQUIRED` errors, emit event, wait for response
5. **Frontend hooks** - Add callbacks for auth events
6. **Auth request card** - New component for chat UI
7. **Chat area integration** - Handle events and OAuth callback
8. **CLI tools** - Update to return `AUTH_REQUIRED` errors (see below)

## Files to Modify

| File | Changes |
|------|---------|
| `src/server/db/schema.ts` | Add `pendingAuth` field, add `awaiting_auth` to status enum |
| `src/server/services/generation-manager.ts` | `handleAuthNeeded()`, `submitAuthResult()`, `injectTokensToSandbox()` |
| `src/server/orpc/routers/generation.ts` | Add `submitAuthResult` endpoint |
| `src/e2b-template/agent-runner.ts` | Detect AUTH_REQUIRED, emit event, wait for response file |
| `src/orpc/hooks.ts` | Add `onAuthNeeded`, `onAuthProgress` callbacks |
| `src/components/chat/auth-request-card.tsx` | **New file** - Auth request UI component |
| `src/components/chat/chat-area.tsx` | Handle auth events, OAuth callback, render AuthRequestCard |

## CLI Tool Updates Required

All CLI tools that use integrations need to be updated to return structured `AUTH_REQUIRED` errors when tokens are missing or invalid.

**Required error format:**
```typescript
{
  error: {
    code: "AUTH_REQUIRED",
    integration: IntegrationType,  // "slack", "gmail", etc.
    message: string  // Human-readable reason
  }
}
```

**CLI tools to update:**
- `slack` - Check `SLACK_ACCESS_TOKEN` env var
- `gmail` - Check `GMAIL_ACCESS_TOKEN` env var
- `google-calendar` - Check `GOOGLE_CALENDAR_ACCESS_TOKEN` env var
- `google-docs` - Check `GOOGLE_DOCS_ACCESS_TOKEN` env var
- `google-sheets` - Check `GOOGLE_SHEETS_ACCESS_TOKEN` env var
- `google-drive` - Check `GOOGLE_DRIVE_ACCESS_TOKEN` env var
- `notion` - Check `NOTION_ACCESS_TOKEN` env var
- `airtable` - Check `AIRTABLE_ACCESS_TOKEN` env var
- `hubspot` - Check `HUBSPOT_ACCESS_TOKEN` env var
- `linkedin` - Check `LINKEDIN_ACCOUNT_ID` env var

**Example implementation (in each CLI tool):**
```typescript
const token = process.env.SLACK_ACCESS_TOKEN;
if (!token) {
  console.log(JSON.stringify({
    error: {
      code: "AUTH_REQUIRED",
      integration: "slack",
      message: "Slack authentication required to send messages"
    }
  }));
  process.exit(1);
}
```

## Edge Cases

- **Timeout**: If user doesn't connect within 10 min, cancel generation
- **Token refresh**: Handled by existing `getValidTokensForUser()` - not an auth_needed case
- **Multiple tabs**: OAuth callback may land in different tab - use `generation_id` param to identify
- **Sandbox env injection**: Need to verify `export` persists or use alternative method
- **Invalid token (401)**: CLI tools should also return `AUTH_REQUIRED` if API returns 401 unauthorized

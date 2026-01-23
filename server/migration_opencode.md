# Migration Plan: Claude SDK → OpenCode (E2B Hosted)

## Executive Summary

This document outlines the migration from the current Claude Code + Claude Agent SDK architecture to **OpenCode Server running inside E2B sandboxes**.

**Current Stack:**
- `@anthropic-ai/sdk` - Direct API calls (title generation)
- `@anthropic-ai/claude-agent-sdk` - Agentic capabilities in E2B
- E2B sandboxes - Isolated execution environment
- Custom IPC - File-based approval/auth flow

**Target Stack:**
- `@opencode-ai/sdk` - Client on your server, connecting to sandbox
- OpenCode Server - Running **inside E2B sandbox** (headless mode)
- OpenCode Plugins - Custom tools & permission hooks (baked into E2B template)
- E2B Sandboxes - **Kept for isolation**
- Gemini API - Title generation (direct call)

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│  Your Next.js Server                                        │
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │  Generation Manager │───▶│  OpenCode SDK Client        │ │
│  │  (consolidated)     │    │  createOpencodeClient()     │ │
│  └─────────────────────┘    └──────────────┬──────────────┘ │
│                                            │                │
└────────────────────────────────────────────┼────────────────┘
                                             │ HTTP/SSE
                                             ▼
┌─────────────────────────────────────────────────────────────┐
│  E2B Sandbox (per conversation)                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  OpenCode Server (opencode serve --port 4096)           ││
│  │                                                         ││
│  │  ├── Agents (build, plan, custom)                       ││
│  │  ├── Tools (Read, Write, Edit, Bash, Glob, Grep, etc)   ││
│  │  ├── Plugins (integration permissions, auth bridge)     ││
│  │  └── Conversation Replay (for session recovery)         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  Integration CLIs: slack, gmail, gcalendar, notion, etc.    │
└─────────────────────────────────────────────────────────────┘
```

### Key Differences Summary

| Aspect | Current (Claude SDK) | New (OpenCode) |
|--------|---------------------|----------------|
| Agent execution | `query()` from `@anthropic-ai/claude-agent-sdk` | `opencode serve` HTTP server |
| Communication | JSON lines over stdout | HTTP API + SSE |
| Streaming | Parse stdout in real-time | `client.event.subscribe()` |
| Permission hooks | `PreToolUse` callback in agent-runner.ts | Plugin `tool.execute.before` hook |
| Approval IPC | File polling (`/tmp/approval-*.json`) | Plugin HTTP callback to server |
| Session resume | `resume` option in `query()` | Conversation replay on new sessions |
| Tools | Hardcoded allowedTools list | Configurable in `opencode.json` |
| Title generation | Anthropic SDK (Haiku) | Gemini API (Flash) |
| Chat implementation | Two parallel paths | Single consolidated GenerationManager |

### Benefits of Migration

1. **Standard HTTP API** - No more parsing stdout JSON lines
2. **Built-in session management** - OpenCode handles persistence within sandbox
3. **Plugin system** - Cleaner permission hooks
4. **OpenAPI spec** - Type-safe SDK generated from spec
5. **Better observability** - `/doc` endpoint, health checks
6. **Simplified codebase** - One consolidated chat flow

---

## Current Architecture Analysis

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Agent Runner | `src/e2b-template/agent-runner.ts` | Runs Claude Agent SDK with hooks |
| E2B Manager | `src/server/sandbox/e2b.ts` | Sandbox lifecycle management |
| Chat Router | `src/server/orpc/routers/chat.ts` | Simple streaming chat endpoint |
| Generation Manager | `src/server/services/generation-manager.ts` | Complex multi-user approval/auth flow |
| Title Generator | `src/server/utils/generate-title.ts` | Conversation title via Haiku |

### Key Patterns

1. **Sandboxed Execution**: Agent runs in E2B with 10-min timeout
2. **Event Streaming**: JSON-line protocol over stdout
3. **Permission Hooks**: `PreToolUse` hooks intercept Bash commands
4. **File-based IPC**: Approval/auth via `/tmp/*.json` files
5. **Integration CLIs**: 13 external tools (Slack, Gmail, etc.)
6. **Dual Chat Paths**: `chat.ts` (simple) and `GenerationManager` (complex) - **MUST CONSOLIDATE**

### Integration Permission Model

```
Read Operations (auto-approved):
  - slack: channels, history, search, recent, users
  - gmail: list, get, unread
  - github: repos, prs, issues, search
  - ... (all read ops for 13 integrations)

Write Operations (require approval):
  - slack: send, react, upload
  - gmail: send
  - github: create-issue
  - ... (all write ops for 13 integrations)
```

---

## OpenCode Architecture Mapping

### Component Mapping

| Current | OpenCode Equivalent |
|---------|---------------------|
| E2B Sandbox | **E2B Sandbox (kept!)** |
| Claude Agent SDK `query()` | `client.session.prompt()` via HTTP to sandbox |
| JSON-line streaming (stdout) | SSE via `event.subscribe()` over HTTP |
| PreToolUse hooks in agent-runner | Plugin `tool.execute.before` hook |
| Custom Skills (written to sandbox) | Custom agent instructions / AGENTS.md |
| Integration CLIs (in sandbox) | **Kept** |
| Session resume | **Conversation replay** (messages replayed to new session) |
| File-based IPC | **Plugin HTTP bridge** to your server |

### OpenCode SDK Core Methods

```typescript
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"

// Full instance (spawns server)
const { client } = await createOpencode({ port: 4096 })

// Client-only (connect to existing server)
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

// Core operations
await client.session.create({ body: { title: "..." } })
await client.session.prompt({
  path: { id: sessionId },
  body: {
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    parts: [{ type: "text", text: prompt }]
  }
})
await client.event.subscribe() // SSE stream
```

### OpenCode Plugin System (CORRECTED)

**Important**: OpenCode plugins use a hook object pattern, NOT an event emitter.

```typescript
// Plugin structure (CORRECT)
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // input.tool = tool name (e.g., "bash")
      // output.args = tool arguments
      // Throw to block execution
    },
    "tool.execute.after": async (input, output) => {
      // Post-execution hook
    }
  }
}
```

### OpenCode Event Types (from SSE)

```
Session events:
- session.created, session.deleted, session.error
- session.idle, session.status, session.updated

Message events:
- message.part.removed, message.part.updated
- message.removed, message.updated

Permission events:
- permission.replied, permission.updated

Other:
- server.connected (initial event)
- todo.updated
```

---

## Critical Design Decisions

### 1. Plugin-to-Server Communication (Approval Flow)

**Problem**: OpenCode plugins can't emit custom events to external listeners.

**Solution**: Plugin makes HTTP calls directly to your server.

```typescript
// In plugin: call your server's approval endpoint
export const IntegrationPermissionsPlugin = async ({ client }) => {
  const SERVER_URL = process.env.BAP_SERVER_URL // e.g., "https://your-server.com"
  const SERVER_SECRET = process.env.BAP_SERVER_SECRET

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args.command
      const parsed = parseBashCommand(command)
      if (!parsed) return // Not an integration command

      const { integration, operation } = parsed

      // Check if write operation
      if (isWriteOperation(integration, operation)) {
        // Call your server to request approval
        const response = await fetch(`${SERVER_URL}/api/internal/approval-request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVER_SECRET}`
          },
          body: JSON.stringify({
            sandboxId: process.env.SANDBOX_ID,
            conversationId: process.env.CONVERSATION_ID,
            integration,
            operation,
            command,
            toolInput: output.args
          })
        })

        const { decision } = await response.json()

        if (decision === "deny") {
          throw new Error("User denied this action")
        }
      }
    }
  }
}
```

**Server-side approval endpoint**:
```typescript
// New internal endpoint (not exposed to frontend)
app.post("/api/internal/approval-request", async (req, res) => {
  const { sandboxId, conversationId, integration, operation, command, toolInput } = req.body

  // Find the active generation for this conversation
  const ctx = generationManager.getContextByConversation(conversationId)
  if (!ctx) {
    return res.json({ decision: "deny" })
  }

  // Check auto-approve setting
  if (ctx.autoApprove) {
    return res.json({ decision: "allow" })
  }

  // Create a promise that resolves when user approves/denies
  const decision = await ctx.waitForApproval({
    toolInput,
    integration,
    operation,
    command
  })

  return res.json({ decision })
})
```

### 2. Mid-Session OAuth Flow (KEPT)

**Problem**: OpenCode's permission system is for tool permissions, not OAuth flows.

**Solution**: Plugin detects missing tokens and calls server, which handles OAuth and injects tokens.

```typescript
// In plugin: check for missing tokens and request auth
"tool.execute.before": async (input, output) => {
  if (input.tool !== "bash") return

  const command = output.args.command
  const parsed = parseBashCommand(command)
  if (!parsed) return

  const { integration } = parsed
  const tokenEnvVar = getTokenEnvVar(integration)
  const hasToken = !!process.env[tokenEnvVar]

  if (!hasToken) {
    // Call server to request auth
    const response = await fetch(`${SERVER_URL}/api/internal/auth-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVER_SECRET}`
      },
      body: JSON.stringify({
        conversationId: process.env.CONVERSATION_ID,
        integration,
        reason: `${getIntegrationDisplayName(integration)} authentication required`
      })
    })

    const { success, tokens } = await response.json()

    if (!success) {
      throw new Error("Authentication not completed")
    }

    // Inject tokens into environment
    for (const [key, value] of Object.entries(tokens)) {
      process.env[key] = value
    }
  }
}
```

**Server-side auth endpoint**:
```typescript
app.post("/api/internal/auth-request", async (req, res) => {
  const { conversationId, integration, reason } = req.body

  const ctx = generationManager.getContextByConversation(conversationId)
  if (!ctx) {
    return res.json({ success: false })
  }

  // Wait for OAuth to complete (up to 10 minutes)
  const result = await ctx.waitForAuth({ integration, reason })

  if (!result.success) {
    return res.json({ success: false })
  }

  // Fetch fresh tokens
  const tokens = await getTokensForIntegrations(ctx.userId, [integration])

  return res.json({ success: true, tokens })
})
```

### 3. Conversation Replay (Session Recovery)

**Problem**: OpenCode sessions live in the sandbox. If sandbox dies, session is lost.

**Solution**: Store conversation history in database, replay messages when creating new session.

```typescript
/**
 * Replay conversation history to a new OpenCode session
 */
async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string
): Promise<void> {
  // Fetch all messages for this conversation
  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, conversationId),
    orderBy: asc(message.createdAt)
  })

  if (messages.length === 0) return

  // Build conversation context for system prompt
  const historyContext = messages.map(m => {
    if (m.role === "user") {
      return `User: ${m.content}`
    } else if (m.role === "assistant") {
      // Include tool uses and results for context
      if (m.contentParts) {
        const parts = m.contentParts.map(p => {
          if (p.type === "text") return p.text
          if (p.type === "tool_use") return `[Used ${p.name}]`
          if (p.type === "tool_result") return `[Result received]`
          return ""
        }).filter(Boolean).join("\n")
        return `Assistant: ${parts}`
      }
      return `Assistant: ${m.content}`
    }
    return ""
  }).filter(Boolean).join("\n\n")

  // Inject history as context (noReply mode)
  await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [{
        type: "text",
        text: `<conversation_history>\n${historyContext}\n</conversation_history>\n\nContinue this conversation. The user's next message follows.`
      }],
      noReply: true // Don't generate response, just inject context
    }
  })
}
```

### 4. Consolidated Generation Manager

**Decision**: Merge `chat.ts` and `GenerationManager` into single implementation.

The consolidated `GenerationManager` will:
1. Handle all chat streaming
2. Manage approval flow with plugin HTTP callbacks
3. Manage auth flow with plugin HTTP callbacks
4. Support conversation replay for session recovery
5. Track subscribers for real-time updates
6. Persist generation state to database

**Files to consolidate**:
- DELETE: `src/server/orpc/routers/chat.ts` (move logic to GenerationManager)
- REFACTOR: `src/server/services/generation-manager.ts` (update for OpenCode)
- NEW: `src/server/orpc/routers/generation.ts` (thin router calling GenerationManager)

### 5. Title Generation with Gemini

**Decision**: Use direct Gemini API call instead of Anthropic SDK.

```typescript
// src/server/utils/generate-title.ts
import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function generateConversationTitle(
  userMessage: string,
  assistantResponse: string
): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

    const prompt = `Generate a short, descriptive title (max 50 chars) for this conversation.

User: ${userMessage.slice(0, 500)}
Assistant: ${assistantResponse.slice(0, 500)}

Title (no quotes):`

    const result = await model.generateContent(prompt)
    const title = result.response.text().trim().slice(0, 50)
    return title || null
  } catch (error) {
    console.error("[Gemini] Failed to generate title:", error)
    return null
  }
}
```

**Dependencies**:
```bash
bun add @google/generative-ai
```

**Environment variable**:
```env
GEMINI_API_KEY=...
```

---

## Migration Tasks

### Phase 0: Pre-Migration Consolidation

**Goal**: Simplify codebase before migrating.

#### 0.1 Consolidate Chat Implementations

- [ ] Audit `chat.ts` vs `GenerationManager` - identify differences
- [ ] Remove `chat.ts` router
- [ ] Update all frontend code to use GenerationManager endpoints
- [ ] Ensure all chat flows go through GenerationManager
- [ ] Test: basic chat, approval flow, auth flow all work

### Phase 1: E2B Template with OpenCode

#### 1.1 Update Dependencies

```bash
# On your server (client-side only)
bun remove @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk
bun add @opencode-ai/sdk @google/generative-ai

# Keep e2b! We still need it
# e2b is already installed
```

#### 1.2 Create OpenCode Plugin

**File**: `src/e2b-template/plugins/integration-permissions.ts`

```typescript
// Full plugin with approval + auth flow
// See "Critical Design Decisions" section above for implementation
```

#### 1.3 OpenCode Config for Sandbox

**File**: `src/e2b-template/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  },
  "tools": {
    "write": true,
    "bash": true,
    "edit": true,
    "glob": true,
    "grep": true,
    "webfetch": true,
    "websearch": true
  },
  "permission": {
    "edit": "allow",
    "write": "allow",
    "bash": "allow"
  },
  "plugin": [
    "./plugins/integration-permissions.ts"
  ]
}
```

#### 1.4 Update E2B Template Build

**File**: `src/e2b-template/template.ts` - Add OpenCode installation:

```bash
# Install OpenCode globally
npm install -g opencode

# Copy plugin and config
COPY opencode.json /app/opencode.json
COPY plugins/ /app/.opencode/plugins/
```

#### 1.5 Environment Variables

```env
# Keep these
ANTHROPIC_API_KEY=...      # Passed to sandbox for OpenCode
E2B_API_KEY=...            # E2B API access
E2B_TEMPLATE=bap-agent     # Same name, updated template

# Add these
GEMINI_API_KEY=...         # For title generation
BAP_SERVER_URL=...         # Plugin callback URL (your server)
BAP_SERVER_SECRET=...      # Plugin authentication secret

# Pass to sandbox
CONVERSATION_ID=...        # Set at sandbox creation
SANDBOX_ID=...             # Set at sandbox creation
```

---

### Phase 2: Core Chat Migration

#### 2.1 Update E2B Sandbox Manager

**File**: `src/server/sandbox/e2b.ts` (refactor for OpenCode)

```typescript
import { Sandbox } from "e2b"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Client } from "@opencode-ai/sdk"
import { env } from "@/env"

const TEMPLATE_NAME = env.E2B_TEMPLATE || "bap-agent-prod"
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const OPENCODE_PORT = 4096

// Cache: conversationId → { sandbox, client, sessionId }
interface SandboxState {
  sandbox: Sandbox
  client: Client
  sessionId: string | null
  serverUrl: string
}

const activeSandboxes = new Map<string, SandboxState>()

export interface SandboxConfig {
  conversationId: string
  anthropicApiKey: string
  integrationEnvs?: Record<string, string>
}

/**
 * Get or create a sandbox with OpenCode server running inside
 */
export async function getOrCreateSandbox(config: SandboxConfig): Promise<SandboxState> {
  let state = activeSandboxes.get(config.conversationId)

  if (state) {
    // Verify sandbox and OpenCode server are alive
    try {
      const res = await fetch(`${state.serverUrl}/health`)
      if (res.ok) return state
    } catch {
      await state.sandbox.kill().catch(() => {})
      activeSandboxes.delete(config.conversationId)
    }
  }

  console.log("[E2B] Creating sandbox with OpenCode:", TEMPLATE_NAME)

  const sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      BAP_SERVER_URL: env.BAP_SERVER_URL,
      BAP_SERVER_SECRET: env.BAP_SERVER_SECRET,
      CONVERSATION_ID: config.conversationId,
      SANDBOX_ID: sandbox.sandboxId,
      ...config.integrationEnvs,
    },
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })

  // Start OpenCode server in headless mode (background)
  console.log("[E2B] Starting OpenCode server...")
  sandbox.commands.run(
    `cd /app && opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0`,
    {
      background: true,
      onStderr: (data) => console.error("[OpenCode stderr]", data),
    }
  )

  // Get the public URL for the sandbox port
  const serverUrl = `https://${sandbox.getHost(OPENCODE_PORT)}`
  await waitForServer(serverUrl)

  // Create SDK client pointing to sandbox's OpenCode server
  const client = createOpencodeClient({
    baseUrl: serverUrl,
  })

  state = { sandbox, client, sessionId: null, serverUrl }
  activeSandboxes.set(config.conversationId, state)

  console.log("[E2B] OpenCode server ready at:", serverUrl)
  return state
}

async function waitForServer(url: string, maxWait = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${url}/doc`, { method: "GET" })
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error("OpenCode server in sandbox failed to start")
}

/**
 * Get or create an OpenCode session within a sandbox
 * Handles conversation replay for session recovery
 */
export async function getOrCreateSession(
  config: SandboxConfig,
  options?: { title?: string; replayHistory?: boolean }
): Promise<{ client: Client; sessionId: string; sandbox: Sandbox }> {
  const state = await getOrCreateSandbox(config)

  // Always create a new session (replay handles continuity)
  const session = await state.client.session.create({
    body: { title: options?.title || "Conversation" }
  })
  state.sessionId = session.id

  // Replay conversation history if needed
  if (options?.replayHistory) {
    await replayConversationHistory(state.client, session.id, config.conversationId)
  }

  return { client: state.client, sessionId: session.id, sandbox: state.sandbox }
}

// Keep existing: killSandbox, cleanupAllSandboxes, writeSkillsToSandbox, etc.
```

#### 2.2 Delete Agent Runner

**Action**: Delete `src/e2b-template/agent-runner.ts` entirely.

OpenCode handles agent execution internally. The plugin system replaces all the PreToolUse hook logic.

#### 2.3 Update Generation Manager for OpenCode

**File**: `src/server/services/generation-manager.ts`

Key changes:
1. Replace `runSDKAgentInSandbox()` with OpenCode SDK calls
2. Use SSE subscription instead of stdout parsing
3. Add `waitForApproval()` and `waitForAuth()` methods for plugin callbacks
4. Add `replayConversationHistory()` for session recovery
5. Update event transformation for OpenCode event types

#### 2.4 Add Internal API Endpoints

**File**: `src/server/orpc/routers/internal.ts` (NEW)

```typescript
// Endpoints called by plugin from sandbox
export const internalRouter = {
  approvalRequest,  // POST /api/internal/approval-request
  authRequest,      // POST /api/internal/auth-request
}
```

---

### Phase 3: Event Transformation

#### 3.1 Map OpenCode Events to GenerationEvents

```typescript
// OpenCode SSE event → GenerationEvent mapping
function transformEvent(event: OpenCodeEvent): GenerationEvent | null {
  switch (event.type) {
    case "message.part.updated":
      const part = event.properties.part
      if (part.type === "text") {
        return { type: "text", content: part.text }
      }
      if (part.type === "tool-invocation") {
        return {
          type: "tool_use",
          toolName: part.toolName,
          toolInput: part.input,
          toolUseId: part.toolInvocationId
        }
      }
      if (part.type === "tool-result") {
        return {
          type: "tool_result",
          toolName: part.toolName,
          result: part.result
        }
      }
      break

    case "session.idle":
      // Generation complete
      return null // Handle in completion logic

    case "session.error":
      return { type: "error", message: event.properties.error }
  }
  return null
}
```

#### 3.2 Log All Events During Development

Add comprehensive logging to understand OpenCode's actual event structure:

```typescript
for await (const event of client.event.subscribe()) {
  console.log("[OpenCode Event]", JSON.stringify(event, null, 2))
  // ... transform and process
}
```

---

### Phase 4: Skills Migration

#### 4.1 Skills Directory Structure

OpenCode uses AGENTS.md for custom agent instructions. Update skill writing:

**File**: `src/server/sandbox/e2b.ts`

```typescript
/**
 * Write user's skills to the sandbox as AGENTS.md
 */
export async function writeSkillsToSandbox(
  sandbox: Sandbox,
  userId: string
): Promise<string[]> {
  const skills = await db.query.skill.findMany({
    where: and(eq(skill.userId, userId), eq(skill.enabled, true)),
    with: { files: true, documents: true }
  })

  if (skills.length === 0) return []

  // Create .opencode directory
  await sandbox.commands.run("mkdir -p /app/.opencode")

  // Build AGENTS.md content
  let agentsContent = "# Custom Skills\n\n"

  for (const s of skills) {
    const skillDir = `/app/.opencode/skills/${s.name}`
    await sandbox.commands.run(`mkdir -p "${skillDir}"`)

    // Add skill to AGENTS.md
    agentsContent += `## ${s.displayName}\n\n`
    agentsContent += `${s.description}\n\n`
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`

    // Write skill files
    for (const file of s.files) {
      await sandbox.files.write(`${skillDir}/${file.path}`, file.content)
    }

    // Write skill documents (binary)
    for (const doc of s.documents) {
      const buffer = await downloadFromS3(doc.storageKey)
      await sandbox.files.write(`${skillDir}/${doc.filename}`, new Uint8Array(buffer).buffer)
    }
  }

  // Write AGENTS.md
  await sandbox.files.write("/app/.opencode/AGENTS.md", agentsContent)

  return skills.map(s => s.name)
}
```

---

### Phase 5: Database Migration

#### 5.1 Update Schema

```sql
-- Rename column
ALTER TABLE conversation RENAME COLUMN claude_session_id TO opencode_session_id;

-- Optional: rename message column too
ALTER TABLE message RENAME COLUMN claude_message_uuid TO opencode_message_id;
```

#### 5.2 Update Drizzle Schema

**File**: `src/server/db/schema.ts`

```typescript
export const conversation = pgTable("conversation", {
  // ... existing fields
  // claudeSessionId: text("claude_session_id"),  // REMOVE
  opencodeSessionId: text("opencode_session_id"), // ADD
})

export const message = pgTable("message", {
  // ... existing fields
  // claudeMessageUuid: text("claude_message_uuid"),  // REMOVE
  opencodeMessageId: text("opencode_message_id"),    // ADD (optional)
})
```

#### 5.3 Run Migration

```bash
bun db:push
```

---

### Phase 6: Cleanup

#### 6.1 Remove Old Dependencies

```bash
bun remove @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk
```

#### 6.2 Files to Delete

```
src/e2b-template/
  - agent-runner.ts         # DELETE - OpenCode handles this
```

#### 6.3 Files to Update

```
src/server/sandbox/e2b.ts          # MAJOR REFACTOR
src/server/services/generation-manager.ts  # MAJOR REFACTOR
src/server/utils/generate-title.ts # UPDATE for Gemini
src/server/db/schema.ts            # UPDATE column names
src/e2b-template/template.ts       # UPDATE for OpenCode
```

#### 6.4 Files to Create

```
src/e2b-template/opencode.json
src/e2b-template/plugins/integration-permissions.ts
src/server/orpc/routers/internal.ts
```

---

## Migration Checklist

### Phase 0: Pre-Migration
- [ ] Consolidate chat.ts into GenerationManager
- [ ] Test all existing functionality still works
- [ ] Document current event types and transformations

### Phase 1: E2B Template
- [ ] Install `@opencode-ai/sdk` on server
- [ ] Install `@google/generative-ai` on server
- [ ] Remove `@anthropic-ai/claude-agent-sdk` from server
- [ ] Create `src/e2b-template/opencode.json`
- [ ] Create `src/e2b-template/plugins/integration-permissions.ts`
- [ ] Update E2B template to install `opencode`
- [ ] Build and push updated E2B template
- [ ] Test sandbox creates and OpenCode server starts

### Phase 2: Core Chat
- [ ] Update `src/server/sandbox/e2b.ts` with OpenCode client
- [ ] Delete `src/e2b-template/agent-runner.ts`
- [ ] Update GenerationManager for OpenCode
- [ ] Add internal API endpoints for plugin callbacks
- [ ] Implement `waitForApproval()` and `waitForAuth()` methods
- [ ] Implement `replayConversationHistory()`
- [ ] Test basic chat works end-to-end

### Phase 3: Event Transformation
- [ ] Log all OpenCode SSE events to understand structure
- [ ] Implement event transformation
- [ ] Update frontend if event types changed
- [ ] Test streaming works correctly

### Phase 4: Permissions & Auth
- [ ] Test read operations auto-approve
- [ ] Test write operations pause for approval
- [ ] Test mid-session OAuth flow
- [ ] Test approval timeout behavior

### Phase 5: Skills
- [ ] Update skill writing to use AGENTS.md format
- [ ] Test skills load correctly in OpenCode
- [ ] Test skill documents (PDFs, images)

### Phase 6: Title Generation
- [ ] Implement Gemini-based title generation
- [ ] Add GEMINI_API_KEY to environment
- [ ] Test title generation works

### Phase 7: Database
- [ ] Create migration for column rename
- [ ] Update Drizzle schema
- [ ] Run migration: `bun db:push`
- [ ] Update all code references to new column names

### Phase 8: Cleanup
- [ ] Remove old dependencies
- [ ] Delete deprecated files
- [ ] Update deployment configs
- [ ] Final end-to-end testing

---

## Risk Mitigation

### Known Risks

1. **OpenCode Plugin API Stability**: Plugin system may change. Pin OpenCode version.

2. **SSE Event Format**: May differ from documentation. Log extensively during development.

3. **Conversation Replay Performance**: Long conversations may have slow replay. Consider:
   - Limiting history to last N messages
   - Summarizing older messages
   - Caching replay context

4. **Plugin HTTP Timeouts**: If server is slow to respond, plugin may timeout. Configure appropriate timeouts.

5. **Sandbox URL Accessibility**: E2B sandbox URLs must be accessible from your server for SSE. Verify network connectivity.

### Rollback Plan

If critical issues arise:
1. Revert E2B template to previous version
2. Restore old dependencies
3. Use old agent-runner.ts

Keep old template available: `bap-agent-legacy`

---

## Additional Documentation

### OpenCode Resources
- Plugins: https://opencode.ai/docs/plugins/
- Server: https://opencode.ai/docs/server/
- SDK: https://opencode.ai/docs/sdk/

### E2B Resources
- Documentation: https://e2b.dev/docs
- Sandbox API: https://e2b.dev/docs/sandbox/overview

### Gemini Resources
- Node.js SDK: https://ai.google.dev/gemini-api/docs/get-started/node
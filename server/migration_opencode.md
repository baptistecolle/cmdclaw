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

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│  Your Next.js Server                                        │
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────┐ │
│  │  Chat Router        │───▶│  OpenCode SDK Client        │ │
│  │  (orpc endpoint)    │    │  createOpencodeClient()     │ │
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
│  │  ├── Plugins (integration permissions, custom tools)    ││
│  │  ├── Skills (user-defined, written to .opencode/skills) ││
│  │  └── MCP Servers (Slack, Gmail, GitHub, etc)            ││
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
| Permission hooks | `PreToolUse` callback in agent-runner.ts | Plugin `Tool.preExecute` event |
| Approval IPC | File polling (`/tmp/approval-*.json`) | HTTP permission API |
| Session resume | `resume` option in `query()` | OpenCode session persistence |
| Tools | Hardcoded allowedTools list | Configurable in `opencode.json` |

### Benefits of Migration

1. **Standard HTTP API** - No more parsing stdout JSON lines
2. **Built-in session management** - OpenCode handles persistence
3. **Plugin system** - Cleaner permission hooks, no file IPC
4. **OpenAPI spec** - Type-safe SDK generated from spec
5. **MCP support** - Can expose integrations as MCP servers
6. **Better observability** - `/doc` endpoint, health checks

---

## Current Architecture Analysis

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Agent Runner | `src/e2b-template/agent-runner.ts` | Runs Claude Agent SDK with hooks |
| E2B Manager | `src/server/sandbox/e2b.ts` | Sandbox lifecycle management |
| Chat Router | `src/server/orpc/routers/chat.ts` | Streaming chat endpoint |
| Generation Manager | `src/server/services/generation-manager.ts` | Multi-user approval/auth flow |
| Title Generator | `src/server/utils/generate-title.ts` | Conversation title via Haiku |

### Key Patterns

1. **Sandboxed Execution**: Agent runs in E2B with 10-min timeout
2. **Event Streaming**: JSON-line protocol over stdout
3. **Permission Hooks**: `PreToolUse` hooks intercept Bash commands
4. **File-based IPC**: Approval/auth via `/tmp/*.json` files
5. **Integration CLIs**: 13 external tools (Slack, Gmail, etc.)

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
| PreToolUse hooks in agent-runner | Plugin `Tool.preExecute` events (in sandbox) |
| Custom Skills (written to sandbox) | `.opencode/skills/` directory (in sandbox) |
| Integration CLIs (in sandbox) | **Kept** + Optional MCP wrapper |
| Session resume | `session.get()` / OpenCode session persistence |
| File-based IPC | **Removed** - Use OpenCode permission API |

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

---

## Migration Tasks

### Phase 1: E2B Template with OpenCode

#### 1.1 Update Dependencies

```bash
# On your server (client-side only)
bun remove @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk
bun add @opencode-ai/sdk

# Keep e2b! We still need it
# e2b is already installed
```

#### 1.2 New E2B Template Definition

**File**: `src/e2b-template/template.ts` (update)

```typescript
import { Sandbox } from "e2b"

export const E2B_TEMPLATE_CONFIG = {
  // Ubuntu 24.04 base
  dockerfile: `
FROM ubuntu:24.04

# Install essentials
RUN apt-get update && apt-get install -y \\
    curl git build-essential

# Install Node.js 22.x
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
    && apt-get install -y nodejs

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install OpenCode globally
RUN bun install -g opencode

# Install integration CLIs (keep existing)
RUN bun install -g \\
    @anthropic-ai/slack-cli \\
    @anthropic-ai/gmail-cli \\
    @anthropic-ai/gcalendar-cli \\
    @anthropic-ai/gdocs-cli \\
    @anthropic-ai/gsheets-cli \\
    @anthropic-ai/gdrive-cli \\
    @anthropic-ai/notion-cli \\
    @anthropic-ai/linear-cli \\
    @anthropic-ai/github-cli \\
    @anthropic-ai/airtable-cli \\
    @anthropic-ai/hubspot-cli \\
    @anthropic-ai/linkedin-cli \\
    @anthropic-ai/salesforce-cli

# Create workspace
WORKDIR /app

# Copy OpenCode config template
COPY opencode.json /app/opencode.json
COPY .opencode/ /app/.opencode/
`,
}
```

#### 1.3 OpenCode Config for Sandbox

**File**: `src/e2b-template/opencode.json` (baked into E2B template)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-3-haiku-20240307",
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

#### 1.4 Environment Variables

```env
# Keep these
ANTHROPIC_API_KEY=...      # Passed to sandbox for OpenCode
E2B_API_KEY=...            # E2B API access
E2B_TEMPLATE=bap-opencode  # New template name

# Remove
# No changes needed - same env vars, different template
```

---

### Phase 2: Core Chat Migration

#### 2.1 Update E2B Sandbox Manager

**File**: `src/server/sandbox/e2b.ts` (refactor to include OpenCode server)

```typescript
import { Sandbox } from "e2b"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Client } from "@opencode-ai/sdk"
import { env } from "@/env"

const TEMPLATE_NAME = env.E2B_TEMPLATE || "bap-opencode"
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
      await state.client.global.health()
      return state
    } catch {
      await state.sandbox.kill().catch(() => {})
      activeSandboxes.delete(config.conversationId)
    }
  }

  console.log("[E2B] Creating sandbox with OpenCode:", TEMPLATE_NAME)

  const sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
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
      const res = await fetch(`${url}/health`, { method: "GET" })
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error("OpenCode server in sandbox failed to start")
}

/**
 * Get or create an OpenCode session within a sandbox
 */
export async function getOrCreateSession(
  config: SandboxConfig,
  title?: string
): Promise<{ client: Client; sessionId: string; sandbox: Sandbox }> {
  const state = await getOrCreateSandbox(config)

  if (state.sessionId) {
    try {
      await state.client.session.get({ path: { id: state.sessionId } })
      return { client: state.client, sessionId: state.sessionId, sandbox: state.sandbox }
    } catch {
      state.sessionId = null
    }
  }

  const session = await state.client.session.create({
    body: { title: title || "Conversation" }
  })
  state.sessionId = session.id

  return { client: state.client, sessionId: session.id, sandbox: state.sandbox }
}

// Keep existing: killSandbox, cleanupAllSandboxes, etc.
```

#### 2.2 Delete Agent Runner

**Current**: `src/e2b-template/agent-runner.ts`
**Action**: Delete entirely - OpenCode handles agent execution internally

#### 2.3 Update Chat Streaming

**File**: `src/server/sandbox/e2b.ts` (add streaming function)

```typescript
export interface OpenCodeStreamEvent {
  type: string
  session?: { id: string }
  message?: {
    id: string
    role: string
    parts: Array<{
      type: "text" | "tool_use" | "tool_result" | "thinking"
      text?: string
      thinking?: string
      toolUseId?: string
      toolName?: string
      toolInput?: unknown
    }>
  }
  permission?: {
    id: string
    tool: string
    input: unknown
  }
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

/**
 * Stream chat from OpenCode server in sandbox
 */
export async function* streamChatFromSandbox(
  config: SandboxConfig,
  prompt: string,
  options?: { model?: string; systemPrompt?: string }
): AsyncGenerator<OpenCodeStreamEvent> {
  const { client, sessionId } = await getOrCreateSession(config)

  // Start the prompt (non-blocking, returns immediately)
  const promptPromise = client.session.prompt({
    path: { id: sessionId },
    body: {
      model: options?.model ? {
        providerID: "anthropic",
        modelID: options.model
      } : undefined,
      parts: [{ type: "text", text: prompt }]
    }
  })

  // Subscribe to SSE events
  const eventStream = await client.event.subscribe()

  for await (const event of eventStream) {
    // Transform to our event format and yield
    yield event as OpenCodeStreamEvent

    // Check for completion
    if (
      event.type === "session.completed" ||
      event.type === "session.error" ||
      event.type === "session.aborted"
    ) {
      break
    }
  }

  // Ensure prompt completed
  await promptPromise
}
```

---

### Phase 3: Permission System Migration

#### 3.1 Create Integration Permission Plugin

**File**: `.opencode/plugins/integration-permissions.ts`

```typescript
import type { PluginContext } from "@opencode-ai/plugin"
import { z } from "zod"

// Integration CLI to type mapping
const CLI_TO_INTEGRATION: Record<string, string> = {
  "slack": "slack",
  "google-gmail": "gmail",
  "gcalendar": "google_calendar",
  // ... rest of mappings
}

// Permission definitions
const TOOL_PERMISSIONS: Record<string, { read: string[]; write: string[] }> = {
  slack: {
    read: ["channels", "history", "search", "recent", "users", "user", "thread"],
    write: ["send", "react", "upload"],
  },
  // ... rest of integrations
}

export default function integrationPermissions(ctx: PluginContext) {
  // Hook into tool execution
  ctx.on("Tool.preExecute", async (event) => {
    if (event.tool.name !== "bash") return

    const command = event.tool.input?.command as string
    const parsed = parseBashCommand(command)

    if (!parsed) return // Not an integration command

    const { integration, operation } = parsed
    const permissions = TOOL_PERMISSIONS[integration]

    if (!permissions) return

    // Check if write operation
    if (permissions.write.includes(operation)) {
      // Request approval
      return {
        action: "ask",
        reason: `Write operation: ${integration}.${operation}`
      }
    }

    // Read operations auto-approve
    return { action: "allow" }
  })
}

function parseBashCommand(command: string) {
  // ... same logic as current agent-runner.ts
}
```

#### 3.2 Migrate Approval Flow

**Current**: File-based IPC (`/tmp/approval-*.json`)
**New**: OpenCode permission API

```typescript
// In your API router
import { getOpenCodeClient } from "./opencode/client"

export async function handleApproval(
  sessionId: string,
  permissionId: string,
  decision: "allow" | "deny"
) {
  const client = await getOpenCodeClient()

  await client.session.permission({
    path: { id: sessionId, permissionId },
    body: { decision }
  })
}
```

---

### Phase 4: Integration Migration

#### Option A: MCP Servers (Recommended)

Create MCP server configurations for each integration:

```json
// opencode.json
{
  "mcp": {
    "slack": {
      "command": "bun",
      "args": ["run", "./mcp-servers/slack.ts"],
      "env": {
        "SLACK_ACCESS_TOKEN": "{env:SLACK_ACCESS_TOKEN}"
      }
    },
    "gmail": {
      "command": "bun",
      "args": ["run", "./mcp-servers/gmail.ts"]
    }
    // ... other integrations
  }
}
```

#### Option B: Plugin Custom Tools

```typescript
// .opencode/plugins/slack-tools.ts
import { z } from "zod"

export default function slackTools(ctx: PluginContext) {
  ctx.tool({
    name: "slack_send",
    description: "Send a message to a Slack channel",
    schema: z.object({
      channel: z.string(),
      message: z.string()
    }),
    execute: async ({ channel, message }) => {
      // Call Slack API
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ channel, text: message })
      })
      return await response.json()
    }
  })

  ctx.tool({
    name: "slack_channels",
    description: "List Slack channels",
    schema: z.object({}),
    execute: async () => {
      // ... implementation
    }
  })
}
```

---

### Phase 5: Skills Migration

#### 5.1 Skills Directory Structure

```
.opencode/
├── skills/
│   ├── skill-name/
│   │   ├── SKILL.md       # Instructions
│   │   ├── document.pdf   # Associated files
│   │   └── helper.py      # Support scripts
```

#### 5.2 Dynamic Skill Loading

Replace `writeSkillsToSandbox()` with OpenCode instructions:

```typescript
// Load user skills into opencode config dynamically
export async function loadUserSkills(userId: string) {
  const skills = await db.query.skill.findMany({
    where: and(eq(skill.userId, userId), eq(skill.enabled, true)),
    with: { files: true, documents: true }
  })

  // Write skills to .opencode/skills/ directory
  for (const s of skills) {
    const skillDir = `.opencode/skills/${s.name}`
    await fs.mkdir(skillDir, { recursive: true })

    for (const file of s.files) {
      await fs.writeFile(`${skillDir}/${file.path}`, file.content)
    }

    for (const doc of s.documents) {
      const buffer = await downloadFromS3(doc.storageKey)
      await fs.writeFile(`${skillDir}/${doc.filename}`, buffer)
    }
  }
}
```

---

### Phase 6: Title Generation Migration

**Current**: Direct Anthropic SDK call
**New**: OpenCode with small model

```typescript
// src/server/utils/generate-title.ts
import { getOpenCodeClient } from "../opencode/client"

export async function generateTitle(
  firstMessage: string
): Promise<string | null> {
  try {
    const client = await getOpenCodeClient()

    // Create ephemeral session for title generation
    const session = await client.session.create({
      body: { title: "Title Generation" }
    })

    const result = await client.session.prompt({
      path: { id: session.id },
      body: {
        model: {
          providerID: "anthropic",
          modelID: "claude-3-haiku-20240307"
        },
        parts: [{
          type: "text",
          text: `Generate a very short title (3-5 words max) for a conversation that starts with: "${firstMessage.slice(0, 500)}"`
        }]
      }
    })

    // Clean up
    await client.session.delete({ path: { id: session.id } })

    return extractTitle(result)
  } catch (error) {
    console.warn("Title generation failed:", error)
    return null
  }
}
```

---

## Files to Delete

After migration is complete:

```
src/e2b-template/
  - agent-runner.ts         # DELETE - OpenCode handles this
  - template.ts             # REFACTOR - Update for OpenCode

src/server/sandbox/
  - e2b.ts                  # REFACTOR - Keep but update for OpenCode client
```

---

## Files to Create/Update

### In E2B Template (baked into sandbox image)

```
/app/
├── opencode.json                    # OpenCode server config
└── .opencode/
    ├── plugins/
    │   └── integration-permissions.ts  # Permission hooks
    └── agents/
        └── bap.md                   # Custom agent (optional)
```

### In Your Server

```
src/e2b-template/
├── opencode.json            # Config to bake into E2B
├── plugins/
│   └── integration-permissions.ts
└── Dockerfile               # Updated E2B template

src/server/sandbox/
└── e2b.ts                   # Updated with OpenCode client
```

---

## Migration Checklist

### Phase 1: E2B Template
- [ ] Install `@opencode-ai/sdk` on server (client only)
- [ ] Remove `@anthropic-ai/claude-agent-sdk` from server
- [ ] Keep `e2b` package
- [ ] Create `src/e2b-template/opencode.json`
- [ ] Create `src/e2b-template/plugins/integration-permissions.ts`
- [ ] Update E2B template Dockerfile to install `opencode`
- [ ] Build and push new E2B template: `bap-opencode`
- [ ] Test sandbox creates and OpenCode server starts

### Phase 2: Core Chat
- [ ] Update `src/server/sandbox/e2b.ts` with OpenCode client
- [ ] Delete `src/e2b-template/agent-runner.ts`
- [ ] Update chat router to use `streamChatFromSandbox()`
- [ ] Implement SSE event transformation
- [ ] Test basic chat works end-to-end

### Phase 3: Permissions
- [ ] Implement permission plugin with read/write rules
- [ ] Map OpenCode permission events to your approval flow
- [ ] Update frontend approval UI if needed
- [ ] Test read operations auto-approve
- [ ] Test write operations pause for approval

### Phase 4: Integrations
- [ ] Verify integration CLIs work in new template
- [ ] Test Slack read/write
- [ ] Test Gmail read/write
- [ ] Test remaining 11 integrations

### Phase 5: Skills
- [ ] Update `writeSkillsToSandbox()` to write to `/app/.opencode/skills/`
- [ ] Verify OpenCode picks up skills as instructions
- [ ] Test skill with documents (PDFs, images)

### Phase 6: Cleanup
- [ ] Remove `@anthropic-ai/sdk` if not used elsewhere
- [ ] Update E2B_TEMPLATE env var to new template name
- [ ] Update deployment configs
- [ ] Monitor for issues

---

## Open Questions

1. **Integration Approach**: For the 13 CLI integrations, prefer:
   - **Keep as Bash commands** (simpler, current approach works)
   - **Wrap with MCP Servers** (more discoverable, better tool schema)
   - **Convert to Plugin Custom Tools** (tighter integration)

2. **Auth Flow**: OAuth token injection:
   - **Keep current approach** - Inject tokens as env vars when creating sandbox
   - Tokens passed to OpenCode via environment, same as now

3. **Session Persistence**: OpenCode has built-in session management:
   - Keep using `conversation.claudeSessionId` for resume?
   - Or use OpenCode's session IDs directly?

---

## Additional Documentation Needed

If you have access to more OpenCode docs, these would help:
- **Plugin Events** - Full list of hookable events (`Tool.preExecute`, etc.)
- **Permission API** - How to respond to permission requests programmatically
- **SSE Event Types** - Complete list of event types from `event.subscribe()`
- **MCP in OpenCode** - How MCP servers integrate with the agent
- **Multi-project** - Can one OpenCode server handle multiple projects/contexts?

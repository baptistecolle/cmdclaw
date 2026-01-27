# BYOC Daemon: Bring Your Own Compute

## Overview

Allow users to connect their own computer as a sandbox runtime and optional LLM provider for BAP. Users who provide their own compute get free access to heybap.com. The user's machine replaces E2B as the execution environment and can optionally replace cloud AI APIs by proxying requests to local LLMs (Ollama, LM Studio, etc.).

This is a two-phase initiative:
- **Phase 1 (BYOC):** User's computer acts as a remote sandbox and optional LLM gateway for heybap.com
- **Phase 2 (Full Offline):** Everything runs locally, no heybap.com dependency

This spec covers Phase 1. Phase 2 is outlined at the end.

## Goals

- One command to install, one click to authorize
- No Docker required on the user's machine
- Works on macOS, Linux, and Windows natively
- OAuth stays on heybap.com (no user-side OAuth configuration)
- Daemon is invisible after setup (runs in background, survives reboots)
- Existing Generation Manager changes are minimal (swap sandbox backend, keep everything else)
- Auto-detect local LLMs (Ollama, LM Studio) and expose them as model options
- Users with local LLMs can run agents at zero cost (no cloud AI API needed)

## User Flow

### First-Time Setup

```
heybap.com/settings/sandbox → "Connect your computer"
                            → Shows install command
                            → Page shows "Waiting for connection..."

User's terminal:
$ curl -fsSL https://heybap.com/i | sh
  ✓ Downloaded bap-daemon
  ✓ Installed to ~/.bap/
  Opening browser to authenticate...

Browser opens heybap.com/auth/device?code=XXXX
  → User clicks "Authorize this device"

Terminal:
  ✓ Authenticated as user@example.com
  ✓ Daemon running (PID 12345)

heybap.com/settings/sandbox → "● Connected"
                            → "user-macbook · macOS · 16GB RAM"
```

### Subsequent Usage

The daemon auto-starts on boot. The user never thinks about it. They use heybap.com normally — the only difference is agent tasks execute on their machine instead of E2B.

### Disconnected State

If the daemon is offline when a generation needs sandbox execution:

```
┌──────────────────────────────────────────┐
│  Your computer isn't connected.          │
│                                          │
│  Start your daemon:  bap start           │
│                                          │
│  Or use cloud sandbox:  Upgrade →        │
└──────────────────────────────────────────┘
```

## Architecture

```
heybap.com                                User's Machine
┌────────────────────────────┐            ┌─────────────────────────┐
│  Next.js App               │            │  bap-daemon             │
│  ├── UI / Auth / OAuth     │            │  ├── bun (bundled)      │
│  ├── Generation Manager    │◄──── WSS ──►│  ├── cli/*.ts           │
│  ├── PostgreSQL            │            │  ├── skills/ (synced)   │
│  ├── Redis / BullMQ        │            │  ├── sandboxes/         │
│  └── S3 / MinIO            │            │  │   └── {convId}/      │
│                            │            │  │       └── workspace   │
│  Sandbox Backend Interface │            │  └── LLM proxy          │
│  ├── E2BSandbox (paid)     │            │      ├── Ollama         │
│  ├── DaemonSandbox (BYOC) ─┘            │      ├── LM Studio     │
│  └── LocalSandbox (offline, phase 2)    │      └── Any OpenAI-   │
│                            │            │          compatible API  │
│  LLM Backend Interface     │            │                         │
│  ├── AnthropicLLM (cloud)  │            └─────────────────────────┘
│  ├── OpenAILLM (cloud)     │
│  ├── DaemonLLM (local) ────┘
│  └── GeminiLLM (titles)
└────────────────────────────┘
```

### What Stays on heybap.com

- UI (Next.js frontend)
- Authentication (Better Auth)
- OAuth flows (all callback URLs point to heybap.com)
- Database (conversations, messages, integrations, skills)
- AI API calls — routed to cloud APIs or proxied through daemon to local LLMs
- File storage (S3/MinIO for skill documents)
- Job orchestration (BullMQ)

### What Runs on the User's Machine

- CLI tool execution (slack, gmail, github, notion, etc.)
- Skill file execution (Python scripts, custom code)
- Bash commands from the agent
- File read/write within the sandbox workspace
- Local LLM inference (Ollama, LM Studio, etc.) — proxied through daemon

## The Daemon

### What It Is

A single self-contained binary (~30-50MB) that includes:

```
~/.bap/
├── bap-daemon              ← main binary (Bun single-file executable)
├── bun                     ← bundled Bun runtime
├── cli/                    ← integration CLI tools (synced from server)
│   ├── slack.ts
│   ├── gmail.ts
│   ├── github.ts
│   ├── google-calendar.ts
│   ├── google-docs.ts
│   ├── google-sheets.ts
│   ├── google-drive.ts
│   ├── notion.ts
│   ├── linear.ts
│   ├── airtable.ts
│   ├── hubspot.ts
│   ├── linkedin.ts
│   ├── salesforce.ts
│   └── setup.sh
├── config.json             ← auth token, device ID, server URL
└── sandboxes/              ← working directories per conversation
    └── {conversationId}/
        └── workspace/      ← agent file operations happen here
```

### What It Does

1. **Maintains WebSocket connection** to `wss://heybap.com/daemon/ws`
2. **Receives execution jobs** from the Generation Manager
3. **Runs commands** in isolated subprocess with controlled env vars
4. **Streams output** back to heybap.com in real-time
5. **Manages workspace directories** per conversation (create, cleanup)
6. **Syncs CLI tools** on startup and periodically (version check)
7. **Reports machine status** (OS, memory, disk, connectivity)
8. **Detects local LLMs** (Ollama, LM Studio) and reports available models
9. **Proxies LLM requests** from heybap.com to local model servers

### Daemon Commands

```bash
bap start           # Start daemon in background
bap stop            # Stop daemon
bap status          # Show connection status
bap auth            # Re-authenticate (opens browser)
bap logs            # Tail daemon logs
bap update          # Update daemon + CLI tools to latest version
bap uninstall       # Remove daemon, config, and sandboxes
```

## WebSocket Protocol

### Connection

```
WSS wss://heybap.com/daemon/ws
Headers:
  Authorization: Bearer {device_token}
  X-Device-ID: {device_id}
  X-Daemon-Version: 1.0.0
  X-OS: darwin|linux|win32
  X-Arch: x64|arm64
```

### Message Types (Server → Daemon)

#### `job.execute`

Execute a command in a conversation sandbox.

```json
{
  "type": "job.execute",
  "jobId": "job_abc123",
  "conversationId": "conv_xyz",
  "command": "slack send --channel C123 --text \"Hello\"",
  "env": {
    "SLACK_ACCESS_TOKEN": "xoxb-...",
    "GITHUB_ACCESS_TOKEN": "ghp_...",
    "APP_URL": "https://heybap.com",
    "CONVERSATION_ID": "conv_xyz"
  },
  "workingDir": "/workspace",
  "timeout": 30000
}
```

#### `job.cancel`

Cancel a running job.

```json
{
  "type": "job.cancel",
  "jobId": "job_abc123"
}
```

#### `sandbox.setup`

Prepare a conversation sandbox (write skills, set up workspace).

```json
{
  "type": "sandbox.setup",
  "conversationId": "conv_xyz",
  "skills": [
    {
      "name": "research",
      "files": [
        { "path": "SKILL.md", "content": "---\nname: research\n---\n..." },
        { "path": "helper.py", "content": "import requests\n..." }
      ]
    }
  ]
}
```

#### `sandbox.teardown`

Clean up a conversation sandbox.

```json
{
  "type": "sandbox.teardown",
  "conversationId": "conv_xyz"
}
```

#### `file.write`

Write a file to the sandbox workspace.

```json
{
  "type": "file.write",
  "conversationId": "conv_xyz",
  "path": "output.json",
  "content": "{...}"
}
```

#### `file.read`

Read a file from the sandbox workspace.

```json
{
  "type": "file.read",
  "conversationId": "conv_xyz",
  "path": "output.json"
}
```

#### `cli.sync`

Push updated CLI tools to the daemon.

```json
{
  "type": "cli.sync",
  "version": "1.2.0",
  "files": [
    { "name": "slack.ts", "content": "..." },
    { "name": "setup.sh", "content": "..." }
  ]
}
```

#### `llm.chat`

Proxy an LLM chat completion request to a local model.

```json
{
  "type": "llm.chat",
  "requestId": "req_abc123",
  "model": "llama3.1:70b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant..." },
    { "role": "user", "content": "Send a slack message to #general" }
  ],
  "tools": [...],
  "stream": true,
  "temperature": 0.7,
  "maxTokens": 4096
}
```

#### `llm.cancel`

Cancel an in-flight LLM request.

```json
{
  "type": "llm.cancel",
  "requestId": "req_abc123"
}
```

#### `llm.discover`

Ask the daemon to re-scan for available local LLM servers.

```json
{
  "type": "llm.discover"
}
```

### Message Types (Daemon → Server)

#### `job.output`

Streaming stdout/stderr from a running job.

```json
{
  "type": "job.output",
  "jobId": "job_abc123",
  "stream": "stdout",
  "data": "Message sent to #general"
}
```

#### `job.done`

Job completed.

```json
{
  "type": "job.done",
  "jobId": "job_abc123",
  "exitCode": 0,
  "stdout": "...",
  "stderr": ""
}
```

#### `job.error`

Job failed.

```json
{
  "type": "job.error",
  "jobId": "job_abc123",
  "error": "Command timed out after 30000ms",
  "exitCode": 1
}
```

#### `file.content`

Response to a file.read request.

```json
{
  "type": "file.content",
  "conversationId": "conv_xyz",
  "path": "output.json",
  "content": "{...}"
}
```

#### `llm.chunk`

Streaming token chunk from a local LLM response.

```json
{
  "type": "llm.chunk",
  "requestId": "req_abc123",
  "delta": {
    "role": "assistant",
    "content": "I'll send"
  }
}
```

#### `llm.tool_use`

Local LLM is requesting a tool call.

```json
{
  "type": "llm.tool_use",
  "requestId": "req_abc123",
  "toolCalls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "bash",
        "arguments": "{\"command\": \"slack send --channel C123 --text 'Hello'\"}"
      }
    }
  ]
}
```

#### `llm.done`

LLM request completed.

```json
{
  "type": "llm.done",
  "requestId": "req_abc123",
  "usage": {
    "promptTokens": 1200,
    "completionTokens": 350
  }
}
```

#### `llm.error`

LLM request failed.

```json
{
  "type": "llm.error",
  "requestId": "req_abc123",
  "error": "Model llama3.1:70b not found. Available: llama3.1:8b, mistral:7b"
}
```

#### `llm.models`

Report available local models (sent on connect, reconnect, and in response to `llm.discover`).

```json
{
  "type": "llm.models",
  "providers": [
    {
      "name": "ollama",
      "endpoint": "http://localhost:11434",
      "status": "running",
      "models": [
        {
          "id": "llama3.1:70b",
          "name": "Llama 3.1 70B",
          "parameterSize": "70B",
          "quantization": "Q4_K_M",
          "contextLength": 131072,
          "capabilities": ["chat", "tools"]
        },
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B",
          "parameterSize": "8B",
          "quantization": "Q4_K_M",
          "contextLength": 131072,
          "capabilities": ["chat", "tools"]
        },
        {
          "id": "qwen2.5-coder:32b",
          "name": "Qwen 2.5 Coder 32B",
          "parameterSize": "32B",
          "quantization": "Q4_K_M",
          "contextLength": 32768,
          "capabilities": ["chat", "tools"]
        }
      ]
    },
    {
      "name": "lmstudio",
      "endpoint": "http://localhost:1234",
      "status": "running",
      "models": [
        {
          "id": "deepseek-r1-distill-qwen-32b",
          "name": "DeepSeek R1 Distill Qwen 32B",
          "parameterSize": "32B",
          "contextLength": 32768,
          "capabilities": ["chat"]
        }
      ]
    }
  ]
}
```

#### `status`

Periodic heartbeat with machine info.

```json
{
  "type": "status",
  "deviceId": "dev_abc",
  "os": "darwin",
  "arch": "arm64",
  "hostname": "user-macbook",
  "memoryTotalMB": 16384,
  "memoryFreeMB": 8192,
  "diskFreeMB": 102400,
  "daemonVersion": "1.0.0",
  "cliVersion": "1.2.0",
  "uptime": 86400,
  "llm": {
    "available": true,
    "providerCount": 2,
    "modelCount": 4
  }
}
```

### Heartbeat & Reconnection

- Daemon sends `status` every 30 seconds
- Server sends WebSocket `ping` every 15 seconds
- If no `pong` received within 10 seconds, server marks daemon as disconnected
- Daemon reconnects with exponential backoff: 1s, 2s, 4s, 8s, max 60s
- On reconnect, daemon re-sends `status` immediately

## Device Authentication

### OAuth Device Flow

Uses a device authorization flow (similar to GitHub CLI, Tailscale):

1. **Daemon requests device code:**
   ```
   POST https://heybap.com/api/auth/device/code
   → { deviceCode: "XXXX-YYYY", verificationUrl: "https://heybap.com/auth/device", expiresIn: 900, pollInterval: 5 }
   ```

2. **Daemon opens browser** to `https://heybap.com/auth/device?code=XXXX-YYYY`

3. **User sees device authorization page:**
   ```
   ┌─────────────────────────────────────┐
   │  Authorize this device?             │
   │                                     │
   │  Code: XXXX-YYYY                    │
   │  Device: macOS arm64                │
   │                                     │
   │  [Authorize]  [Cancel]              │
   └─────────────────────────────────────┘
   ```

4. **Daemon polls for completion:**
   ```
   POST https://heybap.com/api/auth/device/token
   Body: { deviceCode: "XXXX-YYYY" }
   → { status: "pending" }             (keep polling)
   → { status: "authorized", token: "dtkn_...", deviceId: "dev_..." }
   ```

5. **Daemon stores token** in `~/.bap/config.json`:
   ```json
   {
     "token": "dtkn_...",
     "deviceId": "dev_...",
     "serverUrl": "wss://heybap.com",
     "userId": "user_...",
     "authenticatedAt": "2025-01-15T..."
   }
   ```

### Token Refresh

- Device tokens are long-lived (90 days)
- Server can revoke tokens (user disconnects device from settings)
- Daemon receives `auth.revoked` WebSocket message → stops, prompts re-auth

## Database Changes

### New Tables

```typescript
// Device table — tracks connected daemon instances
export const device = pgTable("device", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                    // "user-macbook"
  os: text("os").notNull(),                        // "darwin" | "linux" | "win32"
  arch: text("arch").notNull(),                    // "x64" | "arm64"
  daemonVersion: text("daemon_version"),
  status: text("status").notNull().default("offline"),  // "online" | "offline"
  lastSeenAt: timestamp("last_seen_at"),
  token: text("token").notNull(),                  // hashed device token
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Device code table — for device auth flow
export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  code: text("code").notNull().unique(),           // "XXXX-YYYY"
  deviceId: text("device_id"),
  userId: text("user_id"),
  status: text("status").notNull().default("pending"),  // "pending" | "authorized" | "expired"
  os: text("os"),
  arch: text("arch"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Existing Table Changes

```typescript
// generation table — add sandbox_type
sandboxType: text("sandbox_type").default("e2b"),  // "e2b" | "daemon" | "local"

// user table — add sandbox and LLM preferences
sandboxType: text("sandbox_type").default("e2b"),           // "e2b" | "daemon"
preferLocalLlm: boolean("prefer_local_llm").default(false), // route to local LLM when available
titleModel: text("title_model"),                             // null = auto (local if available, else gemini)
```

## Sandbox Backend Interface

Abstract the sandbox behind a common interface so E2B, daemon, and (later) local all work interchangeably.

```typescript
// src/server/sandbox/types.ts

interface SandboxBackend {
  /**
   * Create or reuse a sandbox for a conversation.
   * Sets up workspace, environment, and CLI tools.
   */
  setup(config: SandboxConfig): Promise<SandboxSession>;

  /**
   * Execute a command in the sandbox.
   * Returns stdout/stderr and exit code.
   * Streams output via the onOutput callback.
   */
  execute(session: SandboxSession, job: ExecuteJob): Promise<ExecuteResult>;

  /**
   * Write a file to the sandbox workspace.
   */
  writeFile(session: SandboxSession, path: string, content: string): Promise<void>;

  /**
   * Read a file from the sandbox workspace.
   */
  readFile(session: SandboxSession, path: string): Promise<string>;

  /**
   * Tear down the sandbox for a conversation.
   */
  teardown(conversationId: string): Promise<void>;

  /**
   * Check if the sandbox backend is available.
   * For daemon: is the WebSocket connected?
   * For E2B: is the API key valid?
   */
  isAvailable(userId: string): Promise<boolean>;
}

interface SandboxConfig {
  conversationId: string;
  userId: string;
  env: Record<string, string>;        // integration tokens, API keys
  skills: SkillDefinition[];
}

interface SandboxSession {
  conversationId: string;
  backend: "e2b" | "daemon" | "local";
}

interface ExecuteJob {
  command: string;
  env?: Record<string, string>;
  timeout?: number;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
}

interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

### Implementations

```
src/server/sandbox/
├── types.ts               ← SandboxBackend interface
├── e2b.ts                 ← E2BSandbox (existing, refactored to implement interface)
├── daemon.ts              ← DaemonSandbox (new — dispatches via WebSocket)
├── local.ts               ← LocalSandbox (phase 2 — direct subprocess)
└── index.ts               ← Factory: picks backend based on user preference + availability
```

### Backend Selection Logic

```typescript
// src/server/sandbox/index.ts

async function getSandboxBackend(userId: string): Promise<SandboxBackend> {
  const user = await getUser(userId);

  if (user.sandboxType === "daemon") {
    const daemon = new DaemonSandbox(userId);
    if (await daemon.isAvailable(userId)) {
      return daemon;
    }
    // Daemon offline — cannot fall back without user consent
    throw new DaemonOfflineError(userId);
  }

  // Default: E2B (paid tier)
  return new E2BSandbox();
}
```

## Replacing OpenCode

Currently, OpenCode runs inside the E2B sandbox as the orchestration layer between Claude and CLI tools. In the daemon model, OpenCode's responsibilities shift:

### What OpenCode Does Today (Inside E2B)

1. Receives prompts from the Generation Manager
2. Calls Claude API with tool definitions
3. Handles tool execution (bash, file ops)
4. Runs the integration-permissions plugin (approval + auth checks)
5. Streams SSE events back to the Generation Manager

### In BYOC Mode

OpenCode's responsibilities split between heybap.com and the daemon:

**Stays on heybap.com (Generation Manager):**
- Claude API calls and streaming
- Tool use parsing and routing
- Approval and auth flow orchestration
- Event streaming to frontend

**Moves to daemon:**
- Bash command execution
- File read/write operations
- CLI tool invocation

The Generation Manager already processes Claude's tool_use responses. Instead of forwarding them to OpenCode in E2B, it sends execution jobs directly to the daemon via WebSocket. The integration-permissions plugin logic (approval checks, auth checks) moves into the Generation Manager itself, since it already handles `waitForApproval()` and `waitForAuth()`.

### Execution Flow Comparison

**Current (E2B + OpenCode):**
```
User message
→ Generation Manager sends prompt to OpenCode (in E2B)
→ OpenCode calls Claude API
→ Claude returns tool_use
→ OpenCode plugin checks permissions → requests approval from server
→ OpenCode executes bash command in sandbox
→ OpenCode sends tool_result back to Claude
→ Loop until done
→ OpenCode streams events to Generation Manager
```

**BYOC (Daemon):**
```
User message
→ Generation Manager calls Claude API directly
→ Claude returns tool_use
→ Generation Manager checks permissions (approval/auth)
→ Generation Manager sends execute job to daemon via WebSocket
→ Daemon runs command, streams output back
→ Generation Manager sends tool_result back to Claude
→ Loop until done
→ Generation Manager streams events to frontend (same as today)
```

The BYOC flow is actually simpler — it removes the OpenCode intermediary and the sandbox-to-server HTTP callbacks for approval/auth.

## Installation

### macOS / Linux

```bash
curl -fsSL https://heybap.com/i | sh
```

The install script:

1. Detects OS and architecture (`uname -s`, `uname -m`)
2. Downloads the correct binary from `https://heybap.com/daemon/releases/{version}/{os}-{arch}`
3. Creates `~/.bap/` directory
4. Extracts binary + bundled Bun + CLI tools
5. Runs `bap auth` (opens browser for device authorization)
6. Installs background service:
   - **macOS:** LaunchAgent at `~/Library/LaunchAgents/com.heybap.daemon.plist`
   - **Linux:** systemd user service at `~/.config/systemd/user/bap-daemon.service`
7. Starts the daemon

### Windows

```powershell
irm https://heybap.com/i.ps1 | iex
```

The PowerShell script:

1. Downloads `.exe` binary
2. Creates `%APPDATA%\bap\` directory
3. Runs `bap.exe auth`
4. Registers startup task via Task Scheduler
5. Starts the daemon

### Alternative: Homebrew (macOS)

```bash
brew install heybap/tap/bap
bap auth
```

### Alternative: Download Page

For users who don't trust `curl | sh`:

```
heybap.com/download
├── macOS (Apple Silicon)    ← .dmg or .tar.gz
├── macOS (Intel)            ← .dmg or .tar.gz
├── Linux (x64)              ← .tar.gz or .deb
├── Linux (ARM64)            ← .tar.gz or .deb
└── Windows (x64)            ← .exe installer
```

## Auto-Update

- Daemon checks for updates on startup and every 24 hours
- Downloads update in background, applies on next restart
- CLI tools synced separately (lighter, more frequent updates)
- Update check: `GET https://heybap.com/api/daemon/version?current={version}&os={os}&arch={arch}`
- User can pin version: `bap update --pin` (disables auto-update)

## Process Isolation

Since the daemon runs on the user's own machine, the threat model is different from E2B:

- **E2B:** Protects BAP's infrastructure from user code → needs microVM isolation
- **BYOC:** User's code on user's machine → isolation is nice-to-have, not critical

### Default: Basic Process Isolation

Each job runs as a subprocess with:

- **Controlled environment variables** (only what the server sends, no host env leakage)
- **Working directory** scoped to `~/.bap/sandboxes/{conversationId}/workspace/`
- **Timeout** enforced by the daemon (kill after N seconds)
- **No network restrictions** (CLI tools need to reach external APIs)

```typescript
// Daemon execution (simplified)
const child = spawn("bun", ["run", cliPath, ...args], {
  cwd: workspaceDir,
  env: job.env,            // only server-provided env vars
  timeout: job.timeout,
});
```

### Optional: Docker Isolation

If the user has Docker installed, the daemon can optionally run jobs in containers:

```bash
bap config set isolation docker
```

This uses the `bap-sandbox` Docker image (built from the existing E2B template) and mounts the workspace directory. Not required, but available for users who want stronger isolation.

## Local LLM Support

### Overview

The daemon acts as a gateway between heybap.com and local LLM servers running on the user's machine. This allows users to run the full agent loop — including AI inference — without any cloud AI API costs. Supported local LLM servers:

| Server | Default Endpoint | API Format | Notes |
|--------|-----------------|------------|-------|
| Ollama | `http://localhost:11434` | OpenAI-compatible (`/v1/chat/completions`) + native (`/api/chat`) | Most popular, widest model support |
| LM Studio | `http://localhost:1234` | OpenAI-compatible (`/v1/chat/completions`) | GUI-based, easy model management |
| llama.cpp server | `http://localhost:8080` | OpenAI-compatible (`/v1/chat/completions`) | Lightweight, CLI-based |
| vLLM | `http://localhost:8000` | OpenAI-compatible (`/v1/chat/completions`) | High throughput, GPU-optimized |
| LocalAI | `http://localhost:8080` | OpenAI-compatible (`/v1/chat/completions`) | Multi-model, Docker-based |
| Any OpenAI-compatible | Configurable | OpenAI-compatible | Custom setups |

All of these expose an OpenAI-compatible `/v1/chat/completions` endpoint, which makes the proxy straightforward.

### How It Works

```
heybap.com                         Daemon                         Local LLM
┌──────────────┐                ┌──────────────┐              ┌──────────────┐
│  Generation   │  llm.chat     │              │  HTTP POST   │              │
│  Manager      │──────────────►│  LLM Proxy   │─────────────►│  Ollama      │
│               │               │              │              │  :11434      │
│               │  llm.chunk    │              │  SSE stream  │              │
│               │◄──────────────│              │◄─────────────│              │
│               │               │              │              │              │
│               │  llm.done     │              │              │              │
│               │◄──────────────│              │              │              │
└──────────────┘                └──────────────┘              └──────────────┘
        │
        │ (same streaming events to frontend as with cloud LLMs)
        ▼
   Frontend UI
```

1. Generation Manager decides to use a local model (based on user preference or conversation setting)
2. Instead of calling Anthropic/OpenAI API directly, it sends an `llm.chat` message through the WebSocket to the daemon
3. Daemon converts the request to OpenAI-compatible format and POSTs to the local LLM server
4. Daemon streams response chunks back as `llm.chunk` messages
5. Generation Manager processes chunks identically to cloud API responses
6. Tool use from local models follows the same flow: `llm.tool_use` → approval check → `job.execute` → `tool_result` → next `llm.chat`

### Model Discovery

The daemon auto-detects local LLM servers on startup and periodically (every 60 seconds):

```typescript
// Daemon discovery logic (simplified)

const KNOWN_ENDPOINTS = [
  { name: "ollama",    url: "http://localhost:11434" },
  { name: "lmstudio",  url: "http://localhost:1234"  },
  { name: "llamacpp",  url: "http://localhost:8080"  },
  { name: "vllm",      url: "http://localhost:8000"  },
  { name: "localai",   url: "http://localhost:8080"  },
];

async function discoverModels(): Promise<LLMProvider[]> {
  const providers: LLMProvider[] = [];

  for (const endpoint of KNOWN_ENDPOINTS) {
    try {
      // All OpenAI-compatible servers support GET /v1/models
      const res = await fetch(`${endpoint.url}/v1/models`);
      if (!res.ok) continue;

      const { data } = await res.json();
      providers.push({
        name: endpoint.name,
        endpoint: endpoint.url,
        status: "running",
        models: data.map(parseModelInfo),
      });
    } catch {
      // Server not running, skip
    }
  }

  // Also check Ollama-native endpoint for richer model info
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (res.ok) {
      const { models } = await res.json();
      // Merge with richer metadata (parameter size, quantization, etc.)
      mergeOllamaMetadata(providers, models);
    }
  } catch {}

  return providers;
}
```

Users can also configure custom endpoints:

```bash
bap config set llm.endpoints '[{"name":"custom","url":"http://192.168.1.100:8080"}]'
```

### Model Capability Detection

Not all local models support tool/function calling. The daemon probes each model's capabilities:

1. **Ollama**: Check model metadata via `/api/show` — newer models (Llama 3.1+, Qwen 2.5+, Mistral) support tools
2. **OpenAI-compatible**: Attempt a test request with `tools` parameter — if the server rejects it, mark as `chat` only
3. **Fallback**: Models without native tool support can still be used with a prompt-based tool calling strategy (the Generation Manager formats tool definitions as text in the system prompt and parses structured output)

```typescript
interface LocalModel {
  id: string;                        // "llama3.1:70b" (Ollama) or "meta-llama-3.1-70b" (LM Studio)
  name: string;                      // Human-readable: "Llama 3.1 70B"
  provider: string;                  // "ollama" | "lmstudio" | "llamacpp" | "vllm" | "custom"
  parameterSize?: string;            // "70B", "8B", "32B"
  quantization?: string;             // "Q4_K_M", "Q8_0", "F16"
  contextLength: number;             // 131072, 32768, etc.
  capabilities: ("chat" | "tools")[];
}
```

### LLM Backend Interface

Similar to the `SandboxBackend`, an `LLMBackend` interface abstracts model providers:

```typescript
// src/server/llm/types.ts

interface LLMBackend {
  /**
   * Send a chat completion request and stream the response.
   */
  chat(request: LLMChatRequest): AsyncGenerator<LLMChatEvent>;

  /**
   * List available models for this backend.
   */
  listModels(): Promise<LLMModel[]>;

  /**
   * Check if this backend is available.
   */
  isAvailable(): Promise<boolean>;
}

interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

type LLMChatEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "thinking"; content: string }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "error"; message: string };

interface LLMModel {
  id: string;
  name: string;
  provider: string;                  // "anthropic" | "openai" | "ollama" | "lmstudio" | etc.
  capabilities: ("chat" | "tools" | "thinking")[];
  isLocal: boolean;
  contextLength?: number;
  parameterSize?: string;
}
```

### Implementations

```
src/server/llm/
├── types.ts                ← LLMBackend interface
├── anthropic.ts            ← AnthropicLLM (existing Claude calls, refactored)
├── openai.ts               ← OpenAILLM (for cloud OpenAI models)
├── gemini.ts               ← GeminiLLM (currently just title generation)
├── daemon.ts               ← DaemonLLM (proxies through daemon WebSocket to local models)
└── index.ts                ← Factory: routes model IDs to backends
```

### Model Routing

The Generation Manager selects an LLM backend based on the model identifier:

```typescript
// src/server/llm/index.ts

function getLLMBackend(model: string, userId: string): LLMBackend {
  // Cloud models — route to their respective APIs
  if (model.startsWith("claude-"))      return new AnthropicLLM();
  if (model.startsWith("gpt-"))         return new OpenAILLM();
  if (model.startsWith("gemini-"))      return new GeminiLLM();

  // Local models — route through daemon
  // Model IDs from daemon look like: "ollama/llama3.1:70b" or "lmstudio/deepseek-r1"
  if (model.includes("/")) {
    const daemon = getDaemonConnection(userId);
    if (!daemon) throw new DaemonOfflineError(userId);
    return new DaemonLLM(daemon);
  }

  throw new UnknownModelError(model);
}
```

### Title Generation with Local Models

Currently title generation uses `gemini-2.0-flash` directly. With local LLM support, this becomes:

```typescript
// src/server/utils/generate-title.ts (updated)

async function generateConversationTitle(
  userMessage: string,
  assistantMessage: string,
  options: { userId: string; preferLocal: boolean }
): Promise<string | null> {
  const prompt = [
    "Generate a short title (3-6 words) for this conversation.",
    "Return ONLY the title, no quotes or punctuation.",
    "",
    "User: " + userMessage.slice(0, 500),
    "",
    "Assistant: " + assistantMessage.slice(0, 500),
  ].join("\n");

  // Prefer local model for titles (fast, no cost, low quality requirements)
  if (options.preferLocal) {
    const daemon = getDaemonConnection(options.userId);
    if (daemon) {
      const localModels = await daemon.listModels();
      // Pick the smallest/fastest local model for title generation
      const titleModel = pickFastestModel(localModels);
      if (titleModel) {
        const backend = new DaemonLLM(daemon);
        const result = await collectStream(backend.chat({
          model: titleModel.id,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 50,
        }));
        return result.trim() || null;
      }
    }
  }

  // Fallback: Gemini (cloud)
  if (!env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text()?.trim() || null;
}
```

Title generation is a low-stakes task (short output, no tool use, quality doesn't need to be perfect). Even a small 8B model handles it well. This makes it ideal for always routing to local LLMs when available.

### Agent Quality with Local Models

The main agent loop (conversation + tool use) is more demanding. Key considerations:

| Capability | Cloud (Claude) | Local 70B+ | Local 8B-32B | Local < 8B |
|------------|---------------|------------|--------------|------------|
| Multi-turn conversation | Excellent | Good | Decent | Poor |
| Tool use / function calling | Excellent | Good (Llama 3.1+, Qwen 2.5+) | Hit-or-miss | Unreliable |
| Following complex instructions | Excellent | Good | Limited | Very limited |
| Skills (custom prompts) | Excellent | Good | Basic | Unreliable |

The UI should communicate this. Model selection shows quality indicators:

```
┌──────────────────────────────────────────────────────────────┐
│  Model                                                        │
│                                                               │
│  Cloud Models                                                 │
│  ├── Claude Sonnet 4          Recommended for agents          │
│  ├── GPT-4o                   Good for agents                 │
│  └── Gemini 2.0 Flash         Fast, good for simple tasks     │
│                                                               │
│  Local Models (Your Computer)                                 │
│  ├── Llama 3.1 70B (Ollama)   Good for agents · Supports tools│
│  ├── Qwen 2.5 32B (Ollama)    Decent for agents · Supports tools│
│  └── Llama 3.1 8B (Ollama)    Basic chat only · No tool support│
└──────────────────────────────────────────────────────────────┘
```

### Prompt Format Translation

Cloud APIs (Anthropic, OpenAI) and local models use different prompt formats. The daemon handles translation:

**Anthropic → OpenAI-compatible (for local models):**

```typescript
// Daemon-side translation

function translateRequest(request: LLMChatMessage): OpenAIChatRequest {
  return {
    model: request.model,
    messages: request.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    // Translate Anthropic tool format to OpenAI function calling format
    tools: request.tools?.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    })),
    stream: true,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? 4096,
  };
}
```

The Generation Manager always sends requests in a normalized format. The `DaemonLLM` backend and the daemon itself handle the translation to whatever the local server expects.

### Tool Use with Local Models

Local models that support function calling (Llama 3.1+, Qwen 2.5+, Mistral) work with the same tool definitions used for Claude. The daemon translates between formats.

For models without native tool support, the Generation Manager can fall back to **prompt-based tool calling**:

1. Tool definitions are serialized as text in the system prompt
2. The model is instructed to output structured JSON when it wants to call a tool
3. The Generation Manager parses the output for tool call patterns
4. This is less reliable but works for simple tool use scenarios

The model capability metadata (`capabilities: ["chat", "tools"]`) from `llm.models` determines which strategy to use.

### User Configuration

Users configure their LLM preference on heybap.com:

```
Settings → Models
├── Agent Model: [dropdown with cloud + local models]
├── Title Model: [dropdown, default: "Auto (local if available)"]
└── Prefer local models: [toggle]
```

Per-conversation override via the model selector in the chat UI (existing feature, extended with local models).

Daemon-side configuration for custom endpoints:

```bash
# Add a custom LLM endpoint
bap config set llm.endpoints '[{"name":"my-server","url":"http://192.168.1.100:8080"}]'

# Disable LLM discovery (if user doesn't want to expose local models)
bap config set llm.enabled false

# Set custom Ollama host (if not on default port)
bap config set llm.ollama.url "http://localhost:12345"
```

## heybap.com UI Changes

### Settings → Sandbox Page

New page at `/settings/sandbox`:

```
┌─────────────────────────────────────────────────────────────┐
│  Sandbox                                                     │
│                                                              │
│  Choose where your agent runs code.                          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  ● Your Computer (Free)                                 │ │
│  │                                                          │ │
│  │  ● user-macbook · macOS · Connected                     │ │
│  │    Last seen: just now                                   │ │
│  │                                                          │ │
│  │  [Disconnect]                                            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  ○ Cloud Sandbox (Pro)                                  │ │
│  │                                                          │ │
│  │  Always available, no setup required.                    │ │
│  │                                                          │ │
│  │  [Upgrade to Pro]                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

When no device is connected:

```
┌─────────────────────────────────────────────────────────────┐
│  Sandbox                                                     │
│                                                              │
│  Connect your computer to run agent tasks for free.          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  macOS / Linux:                                          │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ curl -fsSL https://heybap.com/i | sh             │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │  Windows:                                                │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ irm https://heybap.com/i.ps1 | iex               │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │  ○ Waiting for connection...                             │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Chat Area — Disconnected State

When generation needs sandbox but daemon is offline, show inline in the chat:

```
┌──────────────────────────────────────────────┐
│  ⚠ Your computer is not connected            │
│                                              │
│  Run `bap start` in your terminal to         │
│  reconnect, or upgrade to use cloud          │
│  sandboxes.                                  │
│                                              │
│  [Open Settings]  [Retry]                    │
└──────────────────────────────────────────────┘
```

## Security Considerations

### Device Token Security

- Token stored in `~/.bap/config.json` with `0600` permissions (user-only read)
- Token is a signed JWT with `deviceId`, `userId`, `exp` claims
- Server validates token on every WebSocket connection
- User can revoke tokens from heybap.com settings (kills WebSocket immediately)

### Environment Variable Handling

- Integration tokens (OAuth access tokens) are sent per-job, not stored on disk
- Tokens are passed via the `env` field in `job.execute` messages
- Daemon never persists tokens — they exist only in subprocess memory during execution
- WebSocket connection is TLS-encrypted (WSS)

### Command Execution

- Daemon only executes commands received from authenticated WebSocket connection
- All commands come from the Generation Manager (which validates them via approval flow)
- Daemon does not accept commands from local network or other processes
- Each job has a timeout to prevent runaway processes

### Workspace Isolation

- Each conversation gets its own directory under `~/.bap/sandboxes/{conversationId}/`
- Workspaces are cleaned up when the server sends `sandbox.teardown`
- Daemon periodically garbage-collects stale workspaces (>24h with no activity)

## Implementation Order

### Phase 1a: Sandbox Backend Interface

1. Define `SandboxBackend` interface in `src/server/sandbox/types.ts`
2. Refactor existing E2B code (`src/server/sandbox/e2b.ts`) to implement the interface
3. Update Generation Manager to use the interface instead of E2B directly
4. Move approval/auth permission logic from the OpenCode plugin into the Generation Manager (for daemon mode, the server handles permissions directly instead of the sandbox plugin)

### Phase 1b: Server-Side Daemon Support

5. Add `device` and `deviceCode` tables to schema
6. Add device auth endpoints: `POST /api/auth/device/code`, `POST /api/auth/device/token`
7. Add WebSocket endpoint: `GET /api/daemon/ws` (upgrade to WebSocket)
8. Implement `DaemonSandbox` backend (`src/server/sandbox/daemon.ts`)
9. Add daemon connection manager (tracks online devices per user)
10. Add sandbox backend selection logic

### Phase 1c: Daemon Binary

11. Create daemon project (separate repo or `packages/daemon/`)
12. Implement WebSocket client with reconnection
13. Implement job executor (subprocess management)
14. Implement workspace manager (create, cleanup, file ops)
15. Implement device auth flow (browser open, polling)
16. Implement CLI commands (`start`, `stop`, `status`, `auth`, `logs`, `update`)
17. Bundle with Bun runtime and CLI tools
18. Build pipeline for macOS (x64, arm64), Linux (x64, arm64), Windows (x64)

### Phase 1d: LLM Backend

19. Define `LLMBackend` interface in `src/server/llm/types.ts`
20. Implement `AnthropicLLM` backend (refactor existing Claude calls out of OpenCode dependency)
21. Implement `GeminiLLM` backend (refactor existing title generation)
22. Implement `DaemonLLM` backend (proxies `llm.chat` through WebSocket, receives `llm.chunk`/`llm.done`)
23. Add LLM model routing logic (`src/server/llm/index.ts`)
24. Update Generation Manager to use `LLMBackend` interface instead of OpenCode for model calls
25. Update `generateConversationTitle()` to prefer local models when available

### Phase 1e: Daemon LLM Proxy

26. Implement local LLM discovery in daemon (scan known endpoints, fetch `/v1/models`)
27. Implement `llm.models` reporting (send on connect, on discovery change)
28. Implement `llm.chat` handler (translate request → OpenAI-compatible → POST to local server)
29. Implement response streaming (local server SSE → `llm.chunk` messages → server)
30. Implement tool call translation (OpenAI function calling format ↔ BAP tool format)
31. Add daemon config for custom LLM endpoints, enable/disable

### Phase 1f: UI + Polish

32. Settings page: `/settings/sandbox` with device status and install instructions
33. Settings page: `/settings/models` with local model list and preferences
34. Model selector in chat UI: show local models alongside cloud models
35. Chat area: disconnected state messaging
36. Install scripts: `curl | sh` for macOS/Linux, PowerShell for Windows
37. Auto-update mechanism
38. Background service installers (LaunchAgent, systemd, Task Scheduler)

## Files to Create

| File | Purpose |
|------|---------|
| **Sandbox** | |
| `src/server/sandbox/types.ts` | SandboxBackend interface |
| `src/server/sandbox/daemon.ts` | DaemonSandbox implementation |
| `src/server/sandbox/index.ts` | Backend factory / selection |
| **LLM** | |
| `src/server/llm/types.ts` | LLMBackend interface + shared types |
| `src/server/llm/anthropic.ts` | AnthropicLLM backend |
| `src/server/llm/openai.ts` | OpenAILLM backend (cloud) |
| `src/server/llm/gemini.ts` | GeminiLLM backend (title generation) |
| `src/server/llm/daemon.ts` | DaemonLLM backend (proxy through WebSocket to local models) |
| `src/server/llm/index.ts` | Model routing factory |
| **Server** | |
| `src/server/services/daemon-connection.ts` | WebSocket connection manager |
| `src/server/orpc/routers/device.ts` | Device auth + management endpoints |
| `src/app/api/daemon/ws/route.ts` | WebSocket upgrade endpoint |
| **UI** | |
| `src/app/settings/sandbox/page.tsx` | Sandbox settings UI |
| `src/app/settings/models/page.tsx` | Model preferences UI |
| **Daemon** | |
| `packages/daemon/` | Daemon binary project (separate package) |
| `packages/daemon/src/index.ts` | Daemon entry point |
| `packages/daemon/src/ws-client.ts` | WebSocket client |
| `packages/daemon/src/executor.ts` | Job execution |
| `packages/daemon/src/workspace.ts` | Workspace management |
| `packages/daemon/src/auth.ts` | Device auth flow |
| `packages/daemon/src/service.ts` | OS service installer |
| `packages/daemon/src/llm-proxy.ts` | Local LLM discovery + request proxy |
| `packages/daemon/src/llm-discovery.ts` | Scan for Ollama, LM Studio, etc. |
| **Scripts** | |
| `scripts/install.sh` | macOS/Linux install script |
| `scripts/install.ps1` | Windows install script |

## Files to Modify

| File | Changes |
|------|---------|
| `src/server/db/schema.ts` | Add `device`, `deviceCode` tables; add `sandboxType`, `preferLocalLlm`, `titleModel` to user; add `sandboxType` to generation |
| `src/server/sandbox/e2b.ts` | Refactor to implement `SandboxBackend` interface |
| `src/server/services/generation-manager.ts` | Use `SandboxBackend` + `LLMBackend` interfaces; add direct permission checking for daemon mode; route model calls through LLM backend |
| `src/server/utils/generate-title.ts` | Use `LLMBackend` interface; prefer local models when available |
| `src/server/orpc/routers/index.ts` | Add device router |
| `src/server/orpc/routers/generation.ts` | Include local models in model selection; expose available models list |
| `src/app/settings/layout.tsx` | Add sandbox and models nav items |
| `src/components/chat/model-selector.tsx` | Show local models alongside cloud models with capability badges |
| `src/env.js` | Add optional daemon-related env vars |

## Phase 2: Full Offline (Future Outline)

Everything runs on the user's machine. No heybap.com dependency.

### Additional Components

- **Local Next.js app** bundled in the daemon (or Docker Compose)
- **Local PostgreSQL** (or SQLite for single-user)
- **Local Redis** (or in-memory queue)
- **LocalSandbox backend** (daemon calls itself — just subprocess execution)
- **Local LLM** (already solved in Phase 1 — Ollama/LM Studio work without internet)
- **Cloud AI API keys optional** (user brings their own if they want Claude/GPT)

### OAuth in Offline Mode

Two options:
- **API tokens only:** Users paste personal API tokens for each integration (Slack bot token, GitHub PAT, Notion internal integration token, Linear API key). No OAuth needed.
- **Bring your own OAuth app:** Users create their own OAuth apps per integration and configure client ID/secret. Callback URL is `http://localhost:3000/api/oauth/...`.

### Distribution

```bash
# Option A: Single binary (includes embedded DB)
bap serve

# Option B: Docker Compose
docker compose up
```

### What Changes from Phase 1

- `LocalSandbox` backend added (direct subprocess, no WebSocket)
- `LLMBackend` already supports local models via daemon — in offline mode, calls go direct (no WebSocket hop)
- Next.js app runs locally instead of on heybap.com
- Auth simplified (single-user, optional password)
- Integration token storage moves to local DB
- Cloud AI API keys optional (local LLM is the default)
- No telemetry, no phoning home

### Fully Free Stack (Phase 2)

With Phase 1 local LLM support already built, Phase 2 enables a completely free, fully offline setup:

```
User's Machine
├── BAP app (Next.js on localhost:3000)
├── SQLite (no external DB needed)
├── Ollama (localhost:11434, user installs separately)
│   └── llama3.1:70b (or any model)
├── Sandbox (direct subprocess)
└── Integrations via API tokens (no OAuth needed)

Cost: $0. Dependencies: none.
```

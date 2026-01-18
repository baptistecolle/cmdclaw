# Spec: Persistent Background Generation

## Problem

When a user navigates away or refreshes during an AI generation, the response is lost. Currently:
- User message is saved immediately to DB
- Assistant message is saved **only after streaming completes** (in `onDone` handler)
- If client disconnects mid-stream → assistant response is never saved

## Goal

Make generation **backend-driven and persistent**. Once a message is sent, the backend completes the generation and saves it to the database regardless of client state (refresh, navigate away, close tab).

---

## Desired Behavior

### 1. Generation Lifecycle

| Event | Current Behavior | New Behavior |
|-------|------------------|--------------|
| User sends message | User msg saved, stream starts | User msg saved, **generation job starts in backend** |
| Client disconnects | Stream aborts, assistant msg lost | **Generation continues in background** |
| Client reconnects | Shows only user message | **Reconnects to live stream OR shows completed message** |
| Generation completes | Saves if client connected | **Always saves to DB** |
| Generation fails | Nothing saved | **Save partial content + error indicator** |

### 2. Reconnection

When user returns to a chat with an ongoing generation:
- Client should **reconnect to the live stream** and see real-time updates
- All content generated while away should be visible
- Streaming should continue from current position

### 3. Multiple Tabs

- All tabs share the same generation stream (Option A)
- All tabs see real-time updates simultaneously
- Any tab can cancel the generation (first cancel wins)
- No "leader" tab concept — simple shared state

### 4. Cancellation

- User can cancel generation from any connected client
- Cancellation stops the sandbox execution
- Partial content up to cancellation point is saved with `status: "cancelled"`

### 5. Tool Approvals

- If AI requests tool approval and user is away: **wait indefinitely**
- After configurable timeout (e.g., 5 minutes): **pause the E2B sandbox** to save resources
- When user returns: resume sandbox and show approval prompt
- Sandbox pause/resume via E2B API:
  ```typescript
  await sbx.betaPause()  // Save resources while waiting
  await Sandbox.resume(sandboxId)  // Resume when user returns
  ```

### 6. Error Handling

When generation fails (API error, sandbox crash, timeout):
- Save all content generated up to the error
- Mark message with `status: "error"` and `errorMessage`
- UI shows partial content with error indicator
- User can retry or continue from error point

---

## Technical Design

### Database Schema Changes

Add to `conversation` table:
```typescript
generationStatus: "idle" | "generating" | "awaiting_approval" | "paused" | "complete" | "error"
currentGenerationId: string | null  // UUID for the current/last generation
```

Add new `generation` table:
```typescript
generation: {
  id: string (UUID)
  conversationId: string (FK)
  messageId: string | null (FK - set when message is saved)
  status: "running" | "awaiting_approval" | "paused" | "completed" | "cancelled" | "error"

  // Partial content (updated periodically during generation)
  contentParts: jsonb  // Same structure as message.contentParts

  // Approval state
  pendingApproval: jsonb | null  // { toolUseId, toolName, toolInput, ... }

  // E2B state
  sandboxId: string | null
  isPaused: boolean

  // Metadata
  errorMessage: string | null
  inputTokens: number
  outputTokens: number
  startedAt: timestamp
  completedAt: timestamp | null
}
```

### Backend Changes

#### 1. Decouple generation from client connection

Current flow:
```
Client Request → Stream Response → Save on Complete
```

New flow:
```
Client Request → Start Generation Job → Return generationId
                         ↓
              Background: Run generation → Save periodically → Save on complete
                         ↓
Client Subscribe → Stream from generation job (can reconnect anytime)
```

#### 2. New RPC endpoints

```typescript
// Start a new generation (returns immediately)
startGeneration(input: { conversationId?: string, content: string, model?: string })
  → { generationId: string, conversationId: string }

// Subscribe to generation stream (can be called multiple times, from multiple clients)
subscribeGeneration(input: { generationId: string })
  → AsyncGenerator<ChatEvent>  // Streams from current position

// Cancel a generation
cancelGeneration(input: { generationId: string })
  → { success: boolean }

// Resume a paused generation (after approval timeout)
resumeGeneration(input: { generationId: string })
  → { success: boolean }

// Submit approval decision
submitApproval(input: { generationId: string, toolUseId: string, decision: "approve" | "deny" })
  → { success: boolean }

// Get generation status (for polling fallback)
getGenerationStatus(input: { generationId: string })
  → { status, contentParts, pendingApproval, ... }
```

#### 3. Generation Manager (new service)

```typescript
// Singleton service managing all active generations
class GenerationManager {
  private activeGenerations: Map<string, GenerationContext>

  async startGeneration(params): Promise<string>
  async subscribeToGeneration(generationId): AsyncGenerator<ChatEvent>
  async cancelGeneration(generationId): Promise<void>
  async submitApproval(generationId, toolUseId, decision): Promise<void>

  // Internal
  private async runGeneration(context: GenerationContext): Promise<void>
  private async saveProgress(generationId): Promise<void>  // Periodic saves
  private async handleApprovalTimeout(generationId): Promise<void>
}

interface GenerationContext {
  id: string
  conversationId: string
  sandboxId: string
  status: GenerationStatus
  contentParts: ContentPart[]
  subscribers: Set<Subscriber>  // Multiple clients can subscribe
  abortController: AbortController
}
```

#### 4. Periodic saves

During generation, save progress to `generation` table:
- After each tool_result (immediately)
- After text chunks (debounced every 2 seconds)
- Immediately on any status change

This ensures minimal data loss on crash.

#### 5. Approval timeout flow

```
Tool needs approval
        ↓
Set status = "awaiting_approval", save pendingApproval to DB
        ↓
Start timeout timer (5 minutes)
        ↓
If user approves/denies before timeout → continue generation
        ↓
If timeout reached:
    - Pause E2B sandbox (sbx.betaPause())
    - Set status = "paused", isPaused = true
    - Generation is now "frozen"
        ↓
When user returns and submits approval:
    - Resume sandbox (Sandbox.resume(sandboxId))
    - Continue generation
        ↓
If paused sandbox exceeds 24 hours:
    - Kill sandbox to save costs
    - Keep generation record with status = "paused"
    - On resume: create new sandbox, restore from last checkpoint
```

#### 6. Error handling & retry

- Auto-retry up to 2 times for transient errors (timeout, 5xx, rate limit)
- No retry for non-recoverable errors (content policy, 4xx)
- After retries exhausted: save partial content with `status: "error"`

#### 7. Generation timeout

- Max generation time: 30 minutes (if no subscriber connected)
- No timeout if user is actively watching (has subscriber)
- Auto-cancel abandoned generations after 30 minutes

#### 8. Cleanup

- Delete completed generation records after 7 days
- Keep error generation records for 30 days (debugging)
- Generation table is transient; final data lives in `message` table

### Frontend Changes

#### 1. New hook: `useGeneration`

```typescript
function useGeneration(conversationId: string) {
  // Check if there's an active/paused generation for this conversation
  // Subscribe to it if exists
  // Handle reconnection logic

  return {
    generation: GenerationState | null
    isGenerating: boolean
    isPaused: boolean
    pendingApproval: ApprovalRequest | null

    startGeneration: (content: string) => Promise<void>
    cancelGeneration: () => Promise<void>
    submitApproval: (decision: "approve" | "deny") => Promise<void>
    resumeGeneration: () => Promise<void>
  }
}
```

#### 2. ChatArea changes

```typescript
// On mount, check for active generation
useEffect(() => {
  if (conversation?.generationStatus === "generating" ||
      conversation?.generationStatus === "awaiting_approval") {
    // Reconnect to the stream
    subscribeToGeneration(conversation.currentGenerationId)
  }
}, [conversation])
```

#### 3. UI States

| Generation Status | UI Display |
|-------------------|------------|
| `generating` | Show streaming content with "Generating..." indicator |
| `awaiting_approval` | Show content + approval prompt |
| `paused` | Show content + "Generation paused" + approval prompt |
| `error` | Show partial content + error message + retry button |
| `cancelled` | Show partial content + "Cancelled" indicator |
| `completed` | Show full message (normal display) |

---

## Migration Path

### Phase 1: Backend persistence (MVP)
1. Add `generation` table
2. Add `generationStatus` to conversation
3. Implement GenerationManager with basic start/subscribe/cancel
4. Save progress periodically
5. Frontend: reconnect to active generation on mount

### Phase 2: Approval timeout + pause
1. Implement approval timeout logic
2. Integrate E2B pause/resume
3. UI for paused state

### Phase 3: Polish
1. Error recovery and retry
2. Multiple tab sync improvements
3. Generation history/debugging tools

---

## Files to Modify

### Backend
- `src/server/db/schema.ts` — Add generation table, update conversation
- `src/server/orpc/routers/chat.ts` — Refactor to use GenerationManager
- `src/server/services/generation-manager.ts` — New file
- `src/server/sandbox/e2b.ts` — Add pause/resume support

### Frontend
- `src/orpc/hooks.ts` — Add useGeneration hook
- `src/components/chat/chat-area.tsx` — Use useGeneration, handle reconnection
- `src/components/chat/message-item.tsx` — Handle new status states (paused, error, cancelled)

---

## Success Criteria

1. User can refresh mid-generation and see it continue
2. User can navigate away and back, generation completes
3. User can close browser, reopen, see completed generation
4. Multiple tabs show same generation state
5. Errors save partial content with clear error UI
6. Approvals wait for user, with sandbox pausing after timeout

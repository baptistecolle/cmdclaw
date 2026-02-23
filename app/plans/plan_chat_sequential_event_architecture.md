# Plan: Chat Sequential Event Architecture (Per-Conversation Queue)

## Goal
Move chat generation control from ad-hoc concurrent RPC handling to a per-conversation sequential event model so user actions (`send`, `cancel`, `resume`) are processed deterministically and race conditions are eliminated.

Non-goal:
- no user-facing UI/UX change; migration must be transparent to users

## Why this change
Current behavior allows this race:
- user sends a message
- user cancels
- user sends again before prior run reaches terminal status
- backend rejects with "generation already in progress"

A sequential queue removes this class of bug by enforcing ordered processing for each conversation.

## Target model
Every user action becomes an event persisted and processed in order under a per-conversation lock/queue.

Core action events:
- `send_message`
- `cancel_generation`
- `resume_generation`

Processing guarantees:
- FIFO ordering per `conversationId`
- idempotent handling by `eventId`
- exactly one active processor per conversation at a time
- state transitions are explicit (`running -> cancelling -> cancelled`, etc.)

## Scope
In scope:
- event schema + queue producer/consumer
- API contract updates for async processing
- generation state machine hardening
- observability + tests

Out of scope (first iteration):
- full event sourcing replay engine
- cross-conversation global ordering
- replacing all workflow queues
- user-visible UI changes (new buttons, statuses, text, flows)

## Architecture changes
### 1) Data model
Add `chat_event` table (or equivalent):
- `id` (UUID)
- `conversationId`
- `userId`
- `type` (`send_message` | `cancel_generation` | `resume_generation`)
- `payload` (JSON)
- `status` (`pending` | `processing` | `processed` | `failed`)
- `idempotencyKey` (unique)
- `createdAt`, `processingStartedAt`, `processedAt`, `failedAt`
- `error`

Add/adjust generation states:
- include `cancelling` transitional status

### 2) API layer
Replace direct imperative start/cancel/resume execution with event enqueue:
- `generation.startGeneration` => validate + persist user message + enqueue `send_message`
- `generation.cancelGeneration` => enqueue `cancel_generation`
- `generation.resumeGeneration` => enqueue `resume_generation`

API response shape:
- keep existing API response contract expected by current UI
- do not throw generic 500 for "already running" race; map to current-compatible success/state behavior
- include event metadata only in logs/internal tracing, not required by UI contract

### 3) Queue/worker
Use BullMQ with per-conversation serialization:
- queue job id includes `eventId`
- conversation lock key: `chat:conversation:{conversationId}`
- worker claims next pending event and processes in order
- retries with bounded backoff for transient failures

Processing rules:
- `send_message`: create/advance generation from persisted message
- `cancel_generation`: mark generation `cancelling`, signal abort, finalize `cancelled`
- `resume_generation`: resume paused/awaiting state safely

### 4) State machine invariants
Enforce DB/source-of-truth invariants:
- at most one non-terminal generation per conversation
- `cancelRequestedAt` implies `status in (cancelling, cancelled)` after processing starts
- terminal generations must set `finishedAt`
- conversation `currentGenerationId` must match active generation or null when idle

### 5) UI compatibility
Requirements:
- keep current chat UI behavior and copy unchanged
- no new loading states, labels, or interaction model
- preserve existing RPC payload/response shapes consumed by frontend
- backend sequencing must be internal and transparent to the user

## Migration strategy
### Phase 0: Preparation
- Add metrics/log fields for `eventId`, `conversationId`, `actionType`
- Add dashboards/alerts for stuck `pending`/`processing` events

### Phase 1: Schema + dual-write (safe)
- Introduce `chat_event` table and `cancelling` status
- Keep existing direct path active
- start dual-writing events for observability (shadow mode, no behavior change)

### Phase 2: Worker execution for cancel first
- Route only `cancel_generation` through event worker
- keep `send_message` direct initially
- verify race reduction and latency impact

### Phase 3: Route send/resume through queue
- make `send_message` and `resume_generation` event-driven
- direct execution path becomes fallback-only behind feature flag
- ensure no frontend code path change is required

### Phase 4: Remove legacy direct path
- delete old race-prone branches once stable
- keep emergency rollback flag for one release window
- keep API compatibility adapter if internal response shapes diverge

## Testing plan
### Unit tests
- event reducer/handler per action type
- idempotency behavior (duplicate `eventId`/`idempotencyKey`)
- generation state transitions including `cancelling`

### Integration tests
- conversation-level FIFO ordering
- send->cancel->send sequence yields no "already in progress" hard failure
- worker restart during `processing` recovers safely

### Live/E2E tests
- real chat flow with rapid send/cancel/send on same conversation
- verify user message persistence and eventual assistant response
- verify terminal state and UI consistency
- verify no UI snapshot/content change versus baseline behavior

## Rollout and observability
Key metrics:
- event enqueue latency
- event processing latency by type
- pending/processing event backlog
- generation cancellation completion time
- rate of "already in progress" errors (target near zero)

Alarms:
- events stuck `processing` beyond threshold
- high retry/failure rates
- queue lag per conversation shard

## Risks and mitigations
- Increased latency due to queue hop
  - mitigate with low-overhead enqueue path and fast worker autoscaling
- Duplicate events from retries
  - mitigate with strict idempotency key + unique constraints
- Partial migration complexity
  - mitigate with phased rollout + feature flags + clear rollback

## Implementation checklist
- [ ] Add `chat_event` schema and migration
- [ ] Add `cancelling` generation status and guards
- [ ] Implement event producer in generation RPC handlers
- [ ] Implement BullMQ consumer with per-conversation lock
- [ ] Add typed API responses for async event acceptance
- [ ] Update chat UI for queued/cancelling states
- [ ] Add unit/integration/e2e coverage
- [ ] Add metrics/logging/alerts
- [ ] Gradual rollout with feature flag
- [ ] Remove legacy direct path

## Success criteria
- no reproducible send/cancel/send race on same conversation
- no generic 500 for normal user stop/retry behavior
- deterministic state transitions visible in logs and UI
- stable or improved p95 UX despite queueing
- zero intentional user-visible UI/UX change

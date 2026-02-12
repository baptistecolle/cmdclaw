# High-Impact Test Coverage Plan

Last updated: 2026-02-12  
Coverage source: `coverage/lcov.info` from `bun run test:coverage`

## Baseline

- Line coverage: 21.0% (`1939/9249`)
- Function coverage: 12.3% (`251/2047`)
- Branch coverage: 18.5% (`1136/6149`)

## Prioritization Rules

1. Highest untested line count first.
2. Core runtime and backend flows before UI rendering.
3. Prefer integration-style tests over heavy mocking.
4. Keep tests close to source files using `*.test.ts` / `*.e2e.test.ts`.

## P0: Highest Impact (Do First)

Target: core execution paths that can quickly lift coverage and reduce production risk.

| File | Current coverage | Missed lines | Why this matters | Test file to add/update |
|---|---:|---:|---|---|
| `src/server/services/generation-manager.ts` | 47.7% | 634 | Central generation orchestration; regressions here affect all chat flows | `src/server/services/generation-manager.test.ts` (expand) |
| `src/server/sandbox/e2b.ts` | 0.0% | 249 | Sandbox lifecycle/session replay/env injection are critical for tool execution | `src/server/sandbox/e2b.test.ts` |
| `src/server/services/workflow-gmail-watcher.ts` | 0.0% | 102 | Workflow triggers from Gmail; token/error handling is high-risk | `src/server/services/workflow-gmail-watcher.test.ts` |
| `src/server/services/workflow-x-dm-watcher.ts` | 0.0% | 99 | Workflow triggers from X DMs; dedupe/order/scope checks are critical | `src/server/services/workflow-x-dm-watcher.test.ts` |
| `src/server/ws/server.ts` | 0.0% | 98 | Device auth, request/response routing, heartbeat timeout logic | `src/server/ws/server.test.ts` |
| `src/server/queues/index.ts` | 0.0% | 78 | Worker job routing and conflict handling for scheduled/inbound triggers | `src/server/queues/index.test.ts` |

P0 key scenarios:

- `generation-manager.ts`: active-run conflict handling, cancellation path, stream completion, error path cleanup.
- `e2b.ts`: cached sandbox reuse, stale sandbox replacement, OpenCode readiness timeout, env propagation.
- watchers (`gmail`/`x-dm`): auth failures disable integration, dedupe against previous runs, payload shape correctness.
- `ws/server.ts`: invalid token reject, authenticated connect updates status, pending request timeout and resolution.
- `queues/index.ts`: unknown job failure, workflowId validation, active run conflict swallowed for Gmail/X DM jobs.

Estimated impact if P0 reaches ~70% line coverage: about **+709 covered lines**.

## P1: High Value Backend/API

| File | Current coverage | Missed lines | Why this matters | Test file to add |
|---|---:|---:|---|---|
| `src/server/services/whatsapp-bot.ts` | 0.0% | 127 | Real user message ingestion and link-code/auth flows | `src/server/services/whatsapp-bot.test.ts` |
| `src/server/services/integration-skill-service.ts` | 0.0% | 103 | Slug/file validation, skill resolution, preference updates | `src/server/services/integration-skill-service.test.ts` |
| `src/server/integrations/cli-env.ts` | 0.0% | 89 | Runtime env injection for integrations (token and metadata handling) | `src/server/integrations/cli-env.test.ts` |
| `src/server/services/slack-bot.ts` | 0.0% | 89 | External event bridge; dedupe and response robustness | `src/server/services/slack-bot.test.ts` |
| `src/app/api/report/route.ts` | 0.0% | 66 | Bug reporting path to Slack; auth and payload validation | `src/app/api/report/route.test.ts` |
| `src/server/orpc/routers/conversation.ts` | 0.0% | 65 | Primary conversation CRUD/archive/delete logic | `src/server/orpc/routers/conversation.test.ts` |
| `src/server/orpc/routers/provider-auth.ts` | 0.0% | 62 | OAuth connect/disconnect/state handling for subscription providers | `src/server/orpc/routers/provider-auth.test.ts` |
| `src/app/api/auth/provider/[provider]/callback/route.ts` | 0.0% | 50 | OAuth callback/token exchange and redirect error handling | `src/app/api/auth/provider/[provider]/callback/route.test.ts` |
| `src/app/api/internal/memory/route.ts` | 0.0% | 39 | Internal memory read/search/write and auth secret validation | `src/app/api/internal/memory/route.test.ts` |

Estimated impact if P1 reaches ~70% line coverage: about **+483 covered lines**.

## P2: UI Coverage (After Backend)

| File | Current coverage | Missed lines | Why this matters | Test file to add |
|---|---:|---:|---|---|
| `src/components/chat/chat-area.tsx` | 0.0% | 475 | Most complex chat container; state/event regressions can break UX | `src/components/chat/chat-area.test.tsx` |

Estimated impact if P2 reaches ~70% line coverage: about **+332 covered lines**.

## Execution Plan

1. Complete P0 first, then run `bun run test:coverage` and save a checkpoint.
2. Complete P1 with emphasis on API/Router integration behavior.
3. Add P2 UI tests once backend stability and coverage targets are met.
4. After each phase, run:
   - `bun run test`
   - `bun run test:coverage`
   - `bun run typecheck`

## Coverage Goal for This Plan

- Near-term target: move line coverage from `21.0%` to `35%+` by finishing P0 + P1.
- Stretch target: `40%+` after initial P2 coverage on `chat-area.tsx`.

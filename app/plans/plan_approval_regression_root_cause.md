# Approval Regression Root Cause (Backend)

## Symptoms
- Approval UI occasionally disappears and write actions auto-run or never prompt.
- Seen across CLI and web in ways that look inconsistent.

## Root Cause
The regression source is a backend contract change in `generationManager.startGeneration`.

On 2026-02-13 (`e019aa80`), existing-conversation runs began mutating the persisted `conversation.autoApprove` value when `startGeneration` receives `autoApprove` in input.

Code path:
- `app/src/server/services/generation-manager.ts`
- Existing conversation branch updates DB when `existing.autoApprove !== input.autoApprove`.

Effect:
- A transient caller decision (`autoApprove` passed for one run) becomes persistent conversation state.
- Future runs for that conversation silently inherit auto-approve.
- Approval prompts then stop appearing, which is perceived as frontend/CLI regression even though event pipeline is intact.

## Why This Regresses Often
- `autoApprove` is both run-time input and durable conversation config.
- Multiple callers (web, CLI, reconnect paths) can send it.
- Any mismatch in caller-local toggle/state can permanently flip conversation behavior.

## Prevention Strategy
1. Single-writer config model
- Only a dedicated endpoint should mutate `conversation.autoApprove`.
- `startGeneration` should treat `autoApprove` as per-run policy only, not a config write.

2. Separate durable vs ephemeral policy
- Durable: `conversation.autoApprove` (user preference).
- Ephemeral: generation execution policy (per request).
- Never auto-promote ephemeral values into durable state implicitly.

3. Add contract tests
- `startGeneration` on existing conversation must not mutate `conversation.autoApprove`.
- Approval event must still emit when durable auto-approve is false.
- Explicit settings update endpoint is the only place allowed to flip durable value.

4. Add auditability
- Log and persist actor/source when durable auto-approve changes.
- Alert on unexpected flip frequency per conversation.

## Recommended Next Backend Change
- Revert `startGeneration` writeback behavior introduced in `e019aa80`.
- Keep existing dedicated update route as the sole mutator for conversation auto-approve.

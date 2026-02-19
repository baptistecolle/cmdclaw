# Plan: E2E CLI Test for google_docs

## Goal
Create a live end-to-end CLI test for the google_docs integration that validates the full path from `bun run chat` prompt execution to externally verifiable read results from the provider API.

## High-level scope
- Confirm CLI authentication is available before running the scenario.
- Run one representative read-only flow through chat with a unique marker or deterministic query.
- Assert CLI output has no `[error]` and no `[auth_needed]` for the connected account.
- Verify the expected provider-side read result using direct API fetch/polling.
- Do not add write-operation checks for google_docs.
- Do not add approval-workflow assertions for google_docs.

## Reference implementation
Use Slack as the reference pattern for structure, fixtures, and assertions:
- `/Users/baptiste/Git/bap/app/src/app/chat/chat.slack.cli.live.test.ts`

Reuse the same conventions as Slack:
- `describe.runIf(liveEnabled)` gating
- `beforeAll` with `ensureCliAuth()` and `resolveLiveModel()`
- `runChatMessage(...)` execution
- post-action provider verification helpers from live fixtures

## Required pre-coding step
- Before coding the E2E test, first run `bun run chat` manually against google_docs to understand real skill behavior and output shape.
- If google_docs is not connected for the test user, stop implementation and ask the user to connect it before proceeding.

## Notes
This is a live integration test and requires the test user to already be connected to google_docs.
Write-operation and approval-workflow testing are intentionally reserved for Slack.

# Plan: E2E CLI Test for slack

## Goal
Create a live end-to-end CLI test for the slack integration that validates the full path from `bun run chat` prompt execution to externally verifiable side effects in the provider API.

## High-level scope
- Confirm CLI authentication is available before running the scenario.
- Run one representative read+write flow through chat with a unique marker.
- Assert CLI output has no `[error]` and no `[auth_needed]` for the connected account.
- Verify the expected provider-side result using direct API polling or fetch.
- Include an `--auto-approve` check to ensure no `[approval_needed]` is emitted.

## Reference implementation
Use Slack as the reference pattern for structure, fixtures, and assertions:
- `/Users/baptiste/Git/cmdclaw/app/src/app/chat/chat.slack.cli.live.test.ts`

Reuse the same conventions as Slack:
- `describe.runIf(liveEnabled)` gating
- `beforeAll` with `ensureCliAuth()` and `resolveLiveModel()`
- `runChatMessage(...)` execution
- post-action provider verification helpers from live fixtures

## Required pre-coding step
- Before coding the E2E test, first run `bun run chat` manually against slack to understand real skill behavior, output shape, and approval flow.
- If slack is not connected for the test user, stop implementation and ask the user to connect it before proceeding.

## Notes
This is a live integration test and requires the test user to already be connected to slack.

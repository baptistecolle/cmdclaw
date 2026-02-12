# Test Coverage Backlog (2 Weeks)

## Priority Files
1. `/Users/baptiste/Git/bap/app/src/server/services/generation-manager.ts`
2. `/Users/baptiste/Git/bap/app/src/server/sandbox/e2b.ts`
3. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/workflow.ts`
4. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/generation.ts`
5. `/Users/baptiste/Git/bap/app/src/server/services/workflow-service.ts`
6. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/integration.ts`
7. `/Users/baptiste/Git/bap/app/src/server/integrations/token-refresh.ts`
8. `/Users/baptiste/Git/bap/app/src/server/services/memory-service.ts`
9. `/Users/baptiste/Git/bap/app/src/app/api/oauth/callback/route.ts`
10. `/Users/baptiste/Git/bap/app/src/lib/slack-signature.ts`

## Prioritization Heuristic
`score = (churn_120d + 1) * (1 - line_coverage) * log(lines + 10) * blast_radius_multiplier`

- Use multiplier `1.5` for auth/token/webhook/data-write paths.
- Use multiplier `1.2` for orchestration/workflow/queue paths.
- Use multiplier `1.0` for all other paths.

## Week 1 (High ROI, Lower Harness Cost)

1. `/Users/baptiste/Git/bap/app/src/lib/slack-signature.test.ts`
- Valid signature accepted.
- Missing secret rejected.
- Old timestamp rejected.
- Tampered body rejected.
- Malformed signature handling.

2. `/Users/baptiste/Git/bap/app/src/server/integrations/token-refresh.test.ts`
- No-refresh path returns current token.
- Refresh occurs at expiry buffer edge.
- Provider-specific headers for notion/airtable/reddit.
- Refresh failure falls back to existing token.
- `getValidTokensForUser` returns enabled integrations only.

3. `/Users/baptiste/Git/bap/app/src/app/api/oauth/callback/route.test.ts`
- Missing params redirects with error.
- Unauthorized session redirects to login.
- Invalid state redirects with `invalid_state`.
- User mismatch redirects with `user_mismatch`.
- Token exchange failure redirects with `token_exchange_failed`.
- Slack `authed_user.access_token` parsing.
- Salesforce `instance_url` merged into metadata.

4. `/Users/baptiste/Git/bap/app/src/server/services/workflow-service.test.ts`
- Workflow missing/off returns ORPC errors.
- Non-admin blocked when active run exists.
- Admin can trigger despite active run.
- Start-generation failure updates run + error event.
- Stale run reconciliation (orphan and terminal generation status mapping).

## Week 2 (Orchestration + Routers)

1. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/generation.test.ts`
- Access checks on generation/conversation.
- Status mapping for active generation.
- cancel/approval/auth passthrough behavior.

2. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/workflow.test.ts`
- create/update/delete happy paths.
- schedule sync failures return internal error.
- not-found cases.
- trigger forwards payload correctly.

3. `/Users/baptiste/Git/bap/app/src/server/orpc/routers/integration.test.ts`
- `getAuthUrl` provider params (Slack user scope, Reddit duration, PKCE).
- callback state validation + user mismatch.
- existing integration update vs insert.
- custom integration credential/connectivity flows.

4. `/Users/baptiste/Git/bap/app/src/server/services/memory-service.test.ts`
- `chunkMarkdown` chunk/overlap boundaries.
- file type/path resolution.
- transcript exclusion/filter behavior.
- search merge + limit behavior.

5. `/Users/baptiste/Git/bap/app/src/server/services/generation-manager.test.ts`
- Focus first on cancellation/approval/auth timeout transitions.
- Validate persisted status and emitted state transitions.

## Notes
- Prefer colocated tests as `*.test.ts` near source files.
- Prioritize backend risk paths over UI page coverage.
- Avoid broad schema-only coverage work in early passes.

# Plan: Add Email Forwarding Trigger (Workflow + User Inbox Modes)

## Goal
Let users trigger workflows by forwarding emails to CmdClaw, using:
1. A per-workflow forwarding address.
2. A per-user forwarding address.

## Product Decisions (Agreed)
1. Trigger naming
- Internal trigger key: `email.forwarded`.
- UI label: `Email forwarded to CmdClaw`.

2. Security
- Verify Resend webhook signatures with `RESEND_WEBHOOK_SECRET`.
- Reject invalid signatures.

3. Payload richness
- Include email body in phase 1 (retrieve full email via Resend Receiving API using `email_id`).

4. Routing model
- Support both address styles:
  - Workflow address: `bot+wf_<workflowId>@mail.cmdclaw.com`
  - User address: `bot+u_<userId>@mail.cmdclaw.com`

## Routing Behavior
1. Parse recipient local part from inbound `to` addresses.
2. If any `wf_` alias is present:
- Route directly to that workflow.
- Validate workflow exists and `triggerType === email.forwarded` and status is `on`.
3. Else if any `u_` alias is present:
- Resolve user.
- Route using user-level default logic (see below).
4. Else:
- Ignore event (no known alias).

## User-Level Default Logic (for `u_<userId>`)
1. Primary recommendation:
- User selects one default workflow for forwarded emails.
2. v1 fallback behavior if no default workflow set:
- If user has exactly one active workflow with `email.forwarded`, route to it.
- Otherwise mark ambiguous and do not trigger.

## Authorization Rules
1. Workflow alias route:
- Require sender (`from`) to be authorized for that workflow.
2. User alias route:
- Require sender (`from`) to be authorized for that user.
3. v1 authorization policy:
- Authorized sender default = workflow owner account email.
- Future extension: per-workflow sender allowlist.

## Technical Scope
1. Webhook endpoint
- Add `/api/integrations/resend/webhook`.
- Verify webhook signature.
- Accept only `email.received`.
- Quickly enqueue processing job.

2. Queue + worker
- Add dedicated job name for inbound email trigger.
- Worker resolves route, fetches full email content from Resend, builds trigger payload, calls `triggerWorkflowRun`.

3. Trigger payload shape (v1)
- `source: "email.forwarded"`
- `routingMode: "workflow_alias" | "user_alias"`
- `workflowId`
- `emailId`
- `messageId`
- `from`
- `to`
- `subject`
- `createdAt`
- `text`
- `html`
- `headers`
- `attachmentCount`
- `resendWebhookId`

4. Dedupe
- Queue-level dedupe by `workflowId + emailId` job id.
- Defensive DB-level dedupe check before triggering run.

5. UI/UX
- In workflow editor trigger dropdown: add `Email forwarded to CmdClaw`.
- In workflow editor details:
  - Show workflow forwarding address with copy button.
  - Explain that user-level alias can route via default workflow.
- In user settings/profile:
  - Show user forwarding alias with copy button.
  - Let user choose default forwarded-email workflow.

## Implementation Steps
1. Add trigger constant/value `email.forwarded` and wire it in workflow UI.
2. Add alias helpers for workflow/user forwarding addresses.
3. Add Resend webhook route + signature verification.
4. Add queue job + worker processor for inbound email events.
5. Implement routing resolver (`wf_` first, then `u_`).
6. Implement sender authorization checks.
7. Fetch full email content via Resend Receiving API.
8. Trigger workflow run with enriched payload.
9. Add tests:
- signature verification failure,
- wf alias success,
- u alias default-workflow success,
- ambiguous u alias no-trigger,
- unauthorized sender no-trigger,
- duplicate event deduped.
10. Run `bun run check` and relevant tests.

## Required Environment Variables
- `RESEND_API_KEY` (already present in app env).
- `RESEND_WEBHOOK_SECRET` (new; required for webhook verification).
- `RESEND_RECEIVING_DOMAIN` (new; used to generate display aliases and validate recipient domain).

## Acceptance Criteria
1. Email to workflow alias triggers only that workflow.
2. Email to user alias triggers the user default forwarded-email workflow (or single eligible workflow fallback).
3. Invalid signatures are rejected.
4. Unauthorized senders do not trigger workflows.
5. Full email body is available in workflow trigger payload.
6. Duplicate deliveries do not create duplicate runs.
7. Existing triggers remain unchanged.

## Open Question Before Build
- Should unauthorized/ambiguous emails be silently ignored in v1, or stored as "inbound rejected events" for later UI visibility?

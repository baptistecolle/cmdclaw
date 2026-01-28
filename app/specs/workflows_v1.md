# Workflows (V1): Trigger + Agent + Approvals

## Overview

Introduce a minimal "Workflows" feature that runs the agent automatically from external triggers (e.g., new email, new HubSpot contact). V1 is intentionally simple: no filter UI. The user configures only the trigger, agent instructions, and allowed tools; approvals and logs are required for safety and transparency.

## Goals

- Let users create an automated agent run from a trigger without manual prompting.
- Keep V1 configuration minimal (Trigger + Agent instructions + Allowed tools).
- Reuse existing approval and auth-needed flows for write actions and missing tokens.
- Provide clear execution logs for every run.

## Non-goals (V1)

- No dedicated filter/condition UI. Filtering is done inside the agent instructions.
- No multi-step visual builder or editable canvas.
- No multi-agent orchestration.

## User Flow

1. User opens Workflows.
2. Clicks "New workflow".
3. Picks a Trigger (e.g., New Gmail email, New HubSpot contact).
4. Writes Agent instructions (with optional "Do / Don't" guidance).
5. Selects Allowed tools (integrations the agent can use).
6. Saves and toggles workflow ON.
7. Trigger fires → Workflow Run starts → Agent executes with approvals and logs.

## UI/UX (V1)

### Workflows List

- Table or cards with:
  - Name
  - Trigger type
  - Status (On/Off)
  - Last run status (Completed / Awaiting approval / Error)
  - Last run time

### Workflow Editor (Minimal)

Sections:
- **Trigger**: Single selector. (No filters.)
- **Agent instructions**:
  - Single prompt box
  - Optional "Do" and "Don't" short guidance fields
- **Allowed tools**:
  - Checklist of integrations (reuse integration icons + names)
- **Approvals**:
  - Always enabled for write operations (reuse existing tool approval UI)
- **Logs**:
  - Link to recent runs

### Workflow Run Detail

- Timeline view (reuse chat/activity trace):
  - Trigger payload summary
  - Agent output segments
  - Tool calls
  - Approval cards + results
  - Final result
- Export button for JSON payloads (trigger + tool calls + results)

### Optional (Read-only) Canvas

If desired later, add a read-only XYflow view:
Trigger → Agent → (Tool calls) → Approvals
This should not be the primary editor in V1.

## Agent Execution Model

- Each workflow run creates a standard generation session with:
  - Base system prompt (existing)
  - Workflow prompt (user-defined)
  - Trigger payload injected as context
- The agent can only call tools that are in the workflow's Allowed tools list.
- Write operations require approval via the existing approval flow.
- Missing tokens invoke the existing auth-needed flow.

## Data Model (Proposed)

### Workflow

```typescript
Workflow {
  id: string
  name: string
  ownerId: string
  status: "on" | "off"
  trigger: {
    type: "gmail.new_email" | "hubspot.new_contact" | string
    // V1: no filter fields
  }
  prompt: string
  promptDo?: string
  promptDont?: string
  allowedIntegrations: IntegrationType[]
  createdAt: string
  updatedAt: string
}
```

### Workflow Run

```typescript
WorkflowRun {
  id: string
  workflowId: string
  status: "running" | "awaiting_approval" | "awaiting_auth" | "completed" | "error" | "cancelled"
  triggerPayload: json
  generationId: string
  startedAt: string
  finishedAt?: string
  errorMessage?: string
}
```

## Triggers (V1)

Start with two triggers that already map to existing integrations:
- `gmail.new_email`
- `hubspot.new_contact`

Implementation can be via webhook or polling; V1 should pick the simplest method per integration.

## Permissions & Approvals

- Reuse `integration-permissions` plugin behavior:
  - Read operations auto-allowed.
  - Write operations require approval from the user.
- If a workflow run is awaiting approval, it is visible on the Workflows page with a badge.

## Logs & Audit

- Store all tool calls, approval decisions, and outputs with each run.
- Show a compact summary at the run list level.
- Provide full detail on the run detail page.

## Technical Notes (Alignment with Existing Code)

- Approval flow: `src/e2b-template/plugins/integration-permissions.ts` + `src/server/services/generation-manager.ts` + `src/components/chat/tool-approval-card.tsx`.
- Auth flow: `specs/request-connection.md` (awaiting_auth status and UI).
- Integration list + icons: `src/lib/integration-icons.ts`.
- Trigger execution should create a generation in the same way as chat.

## Execution Policy (V1)

- Workflow runs are visible only under Workflows (not in main chat).
- Hard rate limit: 1 run per workflow per hour.

## Open Questions

1. Should users be able to pause a workflow run while awaiting approval, or only approve/deny?

# Segmented Activity Feed Specification

## Overview

Redesign the activity feed and approval flow to display activities in **segments separated by approvals**, instead of one continuous activity feed with approvals below.

### Current Behavior
```
┌─────────────────────────────┐
│ Activity Feed               │
│ - all activities            │
│ - including post-approval   │
└─────────────────────────────┘
┌─────────────────────────────┐
│ Approval Card(s)            │
└─────────────────────────────┘
```

### Desired Behavior
```
┌─────────────────────────────┐
│ Activity Feed 1 (collapsed) │
│ - activities before approval│
│ - tool call ⏳ (pending)    │
└─────────────────────────────┘
┌─────────────────────────────┐
│ Approval Card A             │
└─────────────────────────────┘
┌─────────────────────────────┐
│ Activity Feed 2 (collapsed) │
│ - activities after A        │
│ - another tool ⏳ (pending) │
└─────────────────────────────┘
┌─────────────────────────────┐
│ Approval Card B             │
└─────────────────────────────┘
┌─────────────────────────────┐
│ Activity Feed 3 (expanded)  │  ← Only latest segment is expanded
│ - activities after B        │
└─────────────────────────────┘
```

---

## Requirements

### 1. Segmented Display During Streaming

**R1.1** Activities must be grouped into segments, where each segment ends when an approval is required.

**R1.2** The tool call that requires approval should appear **inside** the activity segment (as the last item with "pending" status), then the approval card appears below it.

**R1.3** When an approval is resolved, a new activity segment begins for subsequent activities.

**R1.4** If two approvals happen consecutively (no activities in between), show them back-to-back without an empty activity block.

**R1.5** Only the **latest** activity segment should be expanded. All previous segments should be collapsed.

**R1.6** Each activity segment should have its own independent expand/collapse state.

### 2. Approval Card Display

**R2.1** During streaming (pending state): Show full approval card with Approve/Deny buttons.

**R2.2** After resolution (in saved messages): Show approval card with final status only (Approved/Denied), no buttons.

### 3. Data Persistence

**R3.1** Add a new `MessagePart` type for approvals:
```typescript
type ApprovalPart = {
  type: "approval";
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  status: "approved" | "denied";
};
```

**R3.2** Insert approval parts into the `parts` array at the correct position (after the corresponding tool_call).

**R3.3** The segmented view must be preserved on page reload/navigation - saved messages should render identically to streaming view.

---

## Implementation Details

### Files to Modify

#### 1. `src/components/chat/message-list.tsx`
- Add `ApprovalPart` to the `MessagePart` union type

#### 2. `src/components/chat/chat-area.tsx`

**State Changes:**
- Replace `activityItems: ActivityItemData[]` with `segments: ActivitySegment[]`
- Replace `pendingApprovals: PendingApproval[]` with tracking within segments

**New Types:**
```typescript
type ActivitySegment = {
  id: string;
  items: ActivityItemData[];
  approval?: {
    toolUseId: string;
    toolName: string;
    toolInput: unknown;
    integration: string;
    operation: string;
    command?: string;
    status: "pending" | "approved" | "denied";
  };
  isExpanded: boolean;
};
```

**Event Handler Changes:**

- `onToolUse`: Add to current segment's items
- `onToolResult`: Update tool in current segment
- `onPendingApproval`:
  1. Update the last tool_call in current segment to "pending" status
  2. Attach approval data to current segment
  3. Collapse current segment
  4. Create new segment (only if there will be more activities)
- `onApprovalResult`:
  1. Update approval status in the segment
  2. Ensure new segment exists for subsequent activities
- `onDone`:
  1. Convert segments to `MessagePart[]` including approval parts
  2. Pass to message storage

**Rendering Changes:**
```tsx
{isStreaming && (
  <div className="py-4 space-y-4">
    {segments.map((segment, index) => (
      <React.Fragment key={segment.id}>
        {/* Only render activity feed if segment has items */}
        {segment.items.length > 0 && (
          <ActivityFeed
            items={segment.items}
            isStreaming={isStreaming && index === segments.length - 1}
            isExpanded={segment.isExpanded}
            onToggleExpand={() => toggleSegmentExpand(segment.id)}
            integrationsUsed={/* segment-specific integrations */}
          />
        )}

        {/* Render approval card if segment has one */}
        {segment.approval && (
          <ToolApprovalCard
            {...segment.approval}
            onApprove={() => handleApprove(segment.approval.toolUseId)}
            onDeny={() => handleDeny(segment.approval.toolUseId)}
          />
        )}
      </React.Fragment>
    ))}
  </div>
)}
```

#### 3. `src/components/chat/message-item.tsx`

**Changes:**
- Parse `parts` array to reconstruct segments from saved message
- Handle `approval` part type
- Render segmented view using same visual structure as streaming

**Logic:**
```typescript
const segments = useMemo(() => {
  if (!parts) return [];

  const result: DisplaySegment[] = [];
  let currentSegment: DisplaySegment = { id: 'seg-0', items: [], approval: null };

  for (const part of parts) {
    if (part.type === "approval") {
      // Attach approval to current segment and start new one
      currentSegment.approval = {
        ...part,
        status: part.status, // "approved" or "denied"
      };
      result.push(currentSegment);
      currentSegment = { id: `seg-${result.length}`, items: [], approval: null };
    } else if (part.type === "tool_call" || part.type === "thinking" || part.type === "text") {
      // Add to current segment's items
      currentSegment.items.push(convertToActivityItem(part));
    }
  }

  // Push final segment if it has items
  if (currentSegment.items.length > 0) {
    result.push(currentSegment);
  }

  return result;
}, [parts]);
```

#### 4. `src/components/chat/collapsed-trace.tsx`

**Changes:**
- Rename to `SegmentedTrace` or update to handle segments
- Accept segments array instead of flat activity items
- Render multiple collapsible sections with approval cards between them
- Only last segment expanded by default

#### 5. `src/components/chat/tool-approval-card.tsx`

**Changes:**
- Support a `readonly` or `showButtonsOnly={false}` mode for saved approvals
- When `status !== "pending"`, don't render approve/deny buttons
- Keep the card collapsed by default in readonly mode

#### 6. Backend: Message Storage

Ensure the `contentParts` stored in the database includes approval parts. When `onDone` fires:

```typescript
// Convert segments to parts array for storage
const partsToStore: MessagePart[] = [];

for (const segment of segments) {
  // Add all activity items as parts
  for (const item of segment.items) {
    if (item.type === "tool_call") {
      partsToStore.push({
        type: "tool_call",
        id: item.id,
        name: item.toolName,
        input: item.input,
        result: item.result,
        integration: item.integration,
        operation: item.operation,
      });
    } else if (item.type === "thinking") {
      partsToStore.push({ type: "thinking", id: item.id, content: item.content });
    } else if (item.type === "text") {
      partsToStore.push({ type: "text", content: item.content });
    }
  }

  // Add approval part if exists
  if (segment.approval) {
    partsToStore.push({
      type: "approval",
      toolUseId: segment.approval.toolUseId,
      toolName: segment.approval.toolName,
      toolInput: segment.approval.toolInput,
      integration: segment.approval.integration,
      operation: segment.approval.operation,
      command: segment.approval.command,
      status: segment.approval.status,
    });
  }
}
```

---

## Edge Cases

### E1: Approval at the very start
If an approval is required before any activity, the first segment will only contain the pending tool call. Render it normally.

### E2: Multiple consecutive approvals
Skip empty activity blocks:
```
Approval A → Approval B → Activity
```
Renders as:
```
[Approval Card A]
[Approval Card B]
[Activity Feed]
```

### E3: Streaming ends with pending approval
If streaming completes while an approval is pending, keep the approval card visible with pending status (this shouldn't happen normally but handle gracefully).

### E4: Error during streaming
Keep all segments visible with error state on the last one.

---

## Visual States

### Activity Segment Header
- **Collapsed (previous segments):** Show item count, integrations used badge
- **Expanded (latest segment):** Show full activity list with auto-scroll

### Approval Card States
- **Pending:** Amber border, spinner, Approve/Deny buttons
- **Approved:** Green border, checkmark, no buttons
- **Denied:** Red border, X icon, no buttons

---

## Testing Checklist

- [ ] Single approval flow displays correctly during streaming
- [ ] Multiple approval flow creates separate segments
- [ ] Consecutive approvals render back-to-back without empty segments
- [ ] Only latest segment is expanded during streaming
- [ ] Page reload preserves segmented view structure
- [ ] Navigation away and back preserves view
- [ ] Approval cards show correct status after approval/denial
- [ ] Saved messages render identically to streaming view
- [ ] Tool call with pending status appears in activity segment before approval card
- [ ] Error states handled gracefully

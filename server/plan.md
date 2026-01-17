# Frontend Refactor: Activity Feed & Message Bubbles

## Overview

Refactor the chat UI to separate "agent working" activity from actual messages. The goal is to reduce visual noise from large traces while keeping users informed of agent progress.

### Current State
- All content (thinking, tool calls, tool results, text) displayed inline in the chat
- Large traces make it difficult to follow conversations
- Tool calls shown as collapsible sections but still take up significant space

### Target State
- **Activity Feed**: Compact 5-line preview window showing latest agent activity
- **Message Bubbles**: Only show final text responses and important outputs (approvals, errors)
- **Collapsed State**: Previous traces collapse to a single "Working..." line when new user message arrives

---

## Component Architecture

### New Components

#### 1. `ActivityFeed` (`src/components/chat/activity-feed.tsx`)
A compact, scrollable window showing real-time agent activity.

**Props:**
```typescript
interface ActivityFeedProps {
  items: ActivityItem[];
  isStreaming: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  integrationsUsed: IntegrationType[];
}

type ActivityItem = {
  id: string;
  timestamp: number;
  type: 'thinking' | 'tool_call' | 'tool_result';
  content: string; // Truncated preview text
  toolName?: string;
  integration?: IntegrationType;
  status?: 'running' | 'complete' | 'error';
}
```

**Behavior:**
- Default height: ~5 lines of text (approx 120px)
- Auto-scroll to bottom when new items arrive (if user is at scroll end)
- Respect manual scrolling - don't auto-scroll if user scrolled up
- Expandable to full height on click/toggle
- Collapse automatically when streaming completes
- Show integration badges row below the feed

**Visual Design:**
```
┌─────────────────────────────────────────────────┐
│ Activity Feed                            [↕]    │
├─────────────────────────────────────────────────┤
│ 🤔 Analyzing the user request...                │
│ 🔧 gmail.send_email → Running...                │
│ ✓  gmail.send_email → Complete                  │
│ 🤔 Now I'll check the calendar...               │
│ 🔧 google_calendar.list_events → Running...     │
└─────────────────────────────────────────────────┘
│ [Gmail] [Calendar]                              │  ← Integration badges
└─────────────────────────────────────────────────┘
```

#### 2. `IntegrationBadges` (`src/components/chat/integration-badges.tsx`)
Row of small badges showing which integrations were used.

**Props:**
```typescript
interface IntegrationBadgesProps {
  integrations: IntegrationType[];
  size?: 'sm' | 'md'; // default 'sm'
}
```

**Visual:** Small rounded badges with integration logo + optional name on hover.

#### 3. `CollapsedTrace` (`src/components/chat/collapsed-trace.tsx`)
Minimal representation of a completed trace.

**Props:**
```typescript
interface CollapsedTraceProps {
  messageId: string;
  integrationsUsed: IntegrationType[];
  hasError: boolean;
  onExpand: () => void;
}
```

**Visual:**
```
┌─────────────────────────────────────────────────┐
│ ✓ Working...  [Gmail] [Calendar]        [View]  │
└─────────────────────────────────────────────────┘
```

Or with error:
```
┌─────────────────────────────────────────────────┐
│ ⚠ Completed with error  [Gmail]         [View]  │
└─────────────────────────────────────────────────┘
```

---

## Message Display Logic

### What Shows in Activity Feed (Compact)
- All `thinking` content
- All `tool_use` events (tool being called)
- All `tool_result` events (tool completion)
- Internal reflections

### What Shows in Main Chat (Bubbles)
- **User messages**: Always show as bubbles
- **Final text response**: Last text content from assistant after stream completes
- **Approval requests**: `pending_approval` events - show approval card
- **Errors**: Display prominently, keep expanded

### Display States by Scenario

| Scenario | Activity Feed | Main Chat |
|----------|--------------|-----------|
| Streaming in progress | Active, showing live updates | Empty or previous bubble |
| Stream complete (success) | Auto-collapse | Show final text bubble |
| Stream complete (error) | Stay expanded | Show error message |
| Approval needed | Active | Show last text + approval card |
| New user message sent | Previous trace → collapsed | User message bubble |

---

## State Management

### New State in `chat-area.tsx` or Context

```typescript
interface TraceState {
  id: string;
  messageId?: string;
  status: 'streaming' | 'complete' | 'error' | 'waiting_approval';
  activityItems: ActivityItem[];
  integrationsUsed: Set<IntegrationType>;
  isExpanded: boolean;
  finalTextContent?: string;
}

// Per conversation, track traces
interface ChatState {
  traces: Map<string, TraceState>;
  activeTraceId: string | null;
}
```

### State Transitions

1. **User sends message** → Create new trace, set as active, collapse previous trace
2. **Receive `thinking`** → Add to active trace's activity items
3. **Receive `tool_use`** → Add to activity items, add integration to `integrationsUsed`
4. **Receive `tool_result`** → Update corresponding tool item status
5. **Receive `text`** → Buffer as potential final text
6. **Receive `pending_approval`** → Set status to `waiting_approval`, show approval card
7. **Receive `result` (success)** → Set status to `complete`, auto-collapse activity feed
8. **Receive `error`** → Set status to `error`, keep expanded

---

## Files to Modify

### Create New Files
- `src/components/chat/activity-feed.tsx` - Main activity feed component
- `src/components/chat/activity-item.tsx` - Individual activity line
- `src/components/chat/integration-badges.tsx` - Integration badges row
- `src/components/chat/collapsed-trace.tsx` - Collapsed trace representation
- `src/components/chat/message-bubble.tsx` - Clean bubble for final messages

### Modify Existing Files
- `src/components/chat/chat-area.tsx` - Add trace state management, orchestrate new components
- `src/components/chat/streaming-message.tsx` - Refactor to use ActivityFeed instead of inline display
- `src/components/chat/message-list.tsx` - Handle collapsed vs expanded traces
- `src/components/chat/message-item.tsx` - Simplify to show bubbles only
- `src/lib/integration-icons.ts` - Already has what we need, possibly add helper for badge rendering

### Files to Reference (No Changes)
- `src/components/chat/tool-approval-card.tsx` - Reuse as-is for approval requests
- `src/components/chat/previews/*` - Keep preview components for expanded tool details

---

## Implementation Steps

### Phase 1: Activity Feed Component
1. Create `ActivityFeed` component with basic structure
2. Implement auto-scroll behavior (scroll to bottom unless user scrolled up)
3. Add expand/collapse toggle
4. Style for 5-line compact view

### Phase 2: Integration Badges
1. Create `IntegrationBadges` component
2. Use existing `getIntegrationLogo()` from `integration-icons.ts`
3. Add to bottom of ActivityFeed

### Phase 3: State Management
1. Add trace state to `chat-area.tsx`
2. Track integrations used per trace
3. Implement state transitions for all stream events
4. Handle active trace switching on new user message

### Phase 4: Collapsed Trace
1. Create `CollapsedTrace` component
2. Implement expand-to-full-trace functionality
3. Handle error state display

### Phase 5: Message Bubbles
1. Create clean `MessageBubble` component for final text
2. Update `message-item.tsx` to use new bubble style
3. Ensure approval cards still display correctly

### Phase 6: Integration & Polish
1. Wire everything together in `chat-area.tsx`
2. Handle edge cases (empty traces, rapid messages, etc.)
3. Test streaming behavior
4. Ensure smooth animations for collapse/expand

---

## Edge Cases to Handle

1. **No final text message**: If stream ends without text (only tool calls), show a subtle "Task completed" indicator
2. **Very long activity**: Ensure scrolling works smoothly with hundreds of items
3. **Multiple rapid user messages**: Each should collapse the previous trace cleanly
4. **Approval timeout/cancellation**: Handle gracefully, update trace status
5. **Reconnection/refresh**: Restore collapsed state from saved messages
6. **Mobile responsiveness**: Activity feed should work on smaller screens

---

## Visual Mockup: Full Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        Chat Area                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [User bubble]  "Send an email to John about the meeting"   │
│                                                              │
│  ┌─ Collapsed Trace ──────────────────────────────────────┐ │
│  │ ✓ Working...  [Gmail]                          [View]  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Assistant bubble]  "I've sent the email to John about     │
│                       tomorrow's meeting."                   │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  [User bubble]  "Now check my calendar for tomorrow"        │
│                                                              │
│  ┌─ Activity Feed (Live) ─────────────────────────────────┐ │
│  │ 🤔 Let me check your calendar for tomorrow...          │ │
│  │ 🔧 google_calendar.list_events → Running...            │ │
│  │                                                         │ │
│  │                                                         │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│  │ [Calendar]                                              │ │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [Input field]                                    [Send]    │
└─────────────────────────────────────────────────────────────┘
```

---

## Decisions

1. **Animation**: Should collapse/expand be animated? yes, use motion library
2. **Activity Feed position**: Above 
3. **Timestamp display**: Show timestamps in activity feed? yes, and time taken
4. **Tool details on click**: When clicking a tool in activity feed, show full details? (Proposed: yes, inline expand)

---

## Success Criteria

- [x] Activity feed shows max 5 lines by default, scrollable
- [x] Auto-scroll works correctly (respects user scroll position)
- [x] Integration badges appear below activity feed
- [x] Previous traces collapse to single line on new user message
- [x] Collapsed traces can be expanded to see full history
- [x] Errors keep trace expanded
- [x] Approval requests show properly in main chat
- [x] Final text message appears in clean bubble
- [x] Smooth transitions between states

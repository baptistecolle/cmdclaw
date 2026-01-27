# Implementation Plan: Expandable Integration Cards with Actions

## Goal
Add expandable cards to the integrations page that show all available actions for each integration when tapped/clicked. Mobile-friendly, informational only.

## Current State
- **Integration page**: `src/app/settings/integrations/page.tsx`
- **Action labels**: `src/lib/integration-icons.ts` → `INTEGRATION_OPERATION_LABELS`
- **Issue**: LinkedIn is in the page config but missing from `integration-icons.ts`

## Implementation Steps

### 1. Update `integration-icons.ts` to include LinkedIn

Add LinkedIn to:
- `IntegrationType` union type
- `INTEGRATION_ICONS`
- `INTEGRATION_DISPLAY_NAMES`
- `INTEGRATION_COLORS`
- `INTEGRATION_LOGOS`
- `INTEGRATION_OPERATION_LABELS` (use operations from `agent-runner.ts`)

LinkedIn operations to add:
```
chats.list, chats.get, messages.list, messages.send, messages.start,
profile.me, profile.get, profile.company, search, invite.list, invite.send,
connections.list, connections.remove, posts.list, posts.get, posts.create,
posts.comment, posts.react, company.posts, company.post
```

### 2. Create helper to get action labels for display

Add a new export in `integration-icons.ts`:
```typescript
export function getIntegrationActions(integration: string): { key: string; label: string }[]
```

This returns a clean array of action labels suitable for display (converts "Listing channels" → "List channels" format for consistency).

### 3. Modify the integration card in `page.tsx`

**Add state:**
```typescript
const [expandedCard, setExpandedCard] = useState<string | null>(null);
```

**Update card structure:**
- Add click handler to toggle expansion
- Add chevron icon (ChevronDown) that rotates when expanded
- Add conditional section below card content showing action chips
- Use CSS transition for smooth expand/collapse animation

**Card layout when expanded:**
```
┌─────────────────────────────────────┐
│ 🔗 Slack    Connected    ▼          │
├─────────────────────────────────────┤
│ ┌──────────────┐ ┌───────────────┐  │
│ │List channels │ │Read messages  │  │
│ └──────────────┘ └───────────────┘  │
│ ┌──────────────┐ ┌───────────────┐  │
│ │Search        │ │Send message   │  │
│ └──────────────┘ └───────────────┘  │
│ ... more chips ...                  │
└─────────────────────────────────────┘
```

### 4. Style the action chips

- Use small, muted badges/chips
- Flex wrap layout to handle varying number of actions
- Subtle styling: `bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs`
- Gap between chips: `gap-2`

### 5. Mobile considerations

- Cards already use `flex-col` on mobile via `sm:flex-row`
- Expanded section will naturally flow below on all screen sizes
- Touch-friendly tap target (entire card header is clickable)
- Chevron provides clear affordance

## Files to Modify

1. `src/lib/integration-icons.ts`
   - Add LinkedIn to all type definitions and maps
   - Add `getIntegrationActions()` helper function

2. `src/app/settings/integrations/page.tsx`
   - Import `getIntegrationActions` and `ChevronDown`
   - Add `expandedCard` state
   - Add click handler to card
   - Add expandable section with action chips
   - Add expand/collapse animation

## Out of Scope
- No permission level display (read vs write)
- No enable/disable for individual actions
- No separate detail page

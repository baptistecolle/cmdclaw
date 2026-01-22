# Onboarding: Integrations Page

## Overview

Add a new onboarding step after login where users can connect integrations before entering the main app. The page is skippable but encourages users to connect at least one integration.

## User Flow

```
Login → /onboarding/integrations → /chat
```

- After successful login, check if user has completed onboarding
- If not completed, redirect to `/onboarding/integrations`
- If completed, redirect to `/chat`

## Page Design

### Layout

- Clean, centered layout
- Header with welcoming copy
- Grid of integration icons
- Action buttons at bottom

### Header Section

- Title: "Connect your tools"
- Subtitle: Brief explanation of why connecting integrations is useful

### Integrations Grid

**Display style:** Compact icon grid (not full cards)

Each integration shows:
- Logo/icon (from existing `/public/integrations/` assets)
- Integration name below icon
- Visual state indicator (connected vs not connected)
- Clicking triggers OAuth flow

**Recommended integrations (show first, highlighted):**
1. Gmail
2. Google Calendar

**Other integrations (show after recommended):**
- Google Docs
- Google Sheets
- Google Drive
- Notion
- Airtable
- Slack
- HubSpot
- LinkedIn

### Action Buttons

- **"Skip for now"** - Always visible, secondary style, goes to `/chat`
- **"Continue"** - Always visible, primary style, goes to `/chat`

Both buttons mark onboarding as completed.

## Data Model

Add to user record:

```typescript
onboardedAt: timestamp | null
```

- `null` = not onboarded, should see onboarding flow
- timestamp = onboarded, skip to `/chat`

## Technical Notes

### Reusable from existing code

- OAuth flow logic from `/app/settings/integrations/page.tsx`
- Integration icons/logos from `integration-icons.ts`
- React Query hooks: `useIntegrationList()`, `useGetAuthUrl()`

### New components needed

- `/app/onboarding/integrations/page.tsx` - Main onboarding page
- Compact integration icon component (simpler than settings cards)

### Redirect logic

Update post-login redirect in auth flow:
1. Check `user.onboardedAt`
2. If null → `/onboarding/integrations`
3. If set → `/chat`

## Edge Cases

- User refreshes during OAuth callback → return to onboarding page, show updated connection state
- User manually navigates to `/onboarding/integrations` after completing → allow access (no harm)
- User has no integrations available → still show page, skip will work

## Success Metrics

- Track: % of users who connect at least one integration during onboarding
- Track: which integrations are most commonly connected first
- Track: skip rate

---
name: linkedin
description: Manage LinkedIn messaging, profiles, posts, connections, and company pages via Unipile. Use for networking, content publishing, and lead engagement.
---

# LinkedIn

Full LinkedIn management via Unipile API -- messaging, profiles, posts, connections, and company pages.

## Environment Variables

- `UNIPILE_API_KEY` - Unipile API key
- `UNIPILE_DSN` - Unipile DSN hostname
- `LINKEDIN_ACCOUNT_ID` - LinkedIn account ID in Unipile

## Commands

### Messaging
```bash
linkedin chats list [-l limit]
linkedin chats get <chatId>
linkedin messages list <chatId> [-l limit]
linkedin messages send <chatId> --text "Hello!"
linkedin messages start <profileId> --text "Hi, let's connect"
```

### Profiles
```bash
linkedin profile me
linkedin profile get <identifier>
linkedin profile company <identifier>
linkedin search -q "product manager SF" [-l limit]
```

### Connections & Invitations
```bash
linkedin invite send <profileId> [--message "Would love to connect"]
linkedin invite list
linkedin connections list [-l limit]
linkedin connections remove <profileId>
```

### Posts & Content
```bash
linkedin posts list [--profile <id>] [-l limit]
linkedin posts get <postId>
linkedin posts create --text "Excited to announce..."
linkedin posts comment <postId> --text "Great post!"
linkedin posts react <postId> --type LIKE
# Reaction types: LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY
```

### Company Pages
```bash
linkedin company posts <companyId> [-l limit]
linkedin company post <companyId> --text "Company update"
```

## Output Format

JSON objects with cursor-based pagination:

```json
{
  "items": [{ "id": "...", "name": "John Doe", "headline": "CEO at Acme" }],
  "cursor": "next_page_cursor"
}
```

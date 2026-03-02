---
name: google-gmail
description: Read, draft, and send Gmail emails. Use for listing emails, reading content, counting unread, drafting messages, and sending messages.
---

# Google Gmail

Read inbox, get email content, count unread, fetch latest email, draft emails, and send emails via Gmail API.

## Environment Variables

- `GMAIL_ACCESS_TOKEN` - Google OAuth2 access token with Gmail scope

## Commands

```bash
# List emails (supports Gmail search syntax, defaults to Inbox)
google-gmail list [-q "from:boss subject:urgent"] [-l limit] [--scope inbox|all|strict-all] [--include-spam-trash]

# Get latest email (defaults to Inbox)
google-gmail latest [-q "from:boss"] [--unread] [--scope inbox|all|strict-all] [--include-spam-trash]

# Get full email content
google-gmail get <messageId>

# Count unread emails (defaults to Inbox)
google-gmail unread [-q "from:boss"] [--scope inbox|all|strict-all] [--include-spam-trash]

# Draft an email
google-gmail draft --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"]

# Send an email
google-gmail send --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"]
```

## Scope behavior

- `--scope inbox` (default): only messages in `INBOX`
- `--scope all`: all mailbox messages except spam/trash (unless `--include-spam-trash`)
- `--scope strict-all`: includes spam/trash by default

## Output Format

JSON arrays. Example for `list`:

```json
[
  { "id": "18d3f...", "subject": "Meeting Tomorrow", "from": "John <john@example.com>", "date": "Mon, 15 Jan 2024 10:00:00", "snippet": "Preview text..." }
]
```

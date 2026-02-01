---
name: google-gmail
description: Read and send Gmail emails. Use for listing emails, reading content, counting unread, and sending messages.
---

# Google Gmail

Read inbox, get email content, count unread, and send emails via Gmail API.

## Environment Variables

- `GMAIL_ACCESS_TOKEN` - Google OAuth2 access token with Gmail scope

## Commands

```bash
# List emails (supports Gmail search syntax)
google-gmail list [-q "from:boss subject:urgent"] [-l limit]

# Get full email content
google-gmail get <messageId>

# Count unread emails
google-gmail unread

# Send an email
google-gmail send --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"]
```

## Output Format

JSON arrays. Example for `list`:

```json
[
  { "id": "18d3f...", "subject": "Meeting Tomorrow", "from": "John <john@example.com>", "date": "Mon, 15 Jan 2024 10:00:00", "snippet": "Preview text..." }
]
```

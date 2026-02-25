---
name: outlook
description: Read and send Outlook emails. Use for listing emails, reading content, counting unread, and sending messages.
---

# Outlook Mail

Read inbox emails, get email content, count unread emails, and send messages via Microsoft Graph.

## Environment Variables

- `OUTLOOK_ACCESS_TOKEN` - Microsoft OAuth2 access token with Mail scopes

## Commands

```bash
# List emails
outlook-mail list [-q "subject keyword"] [-l limit]

# Get full email content
outlook-mail get <messageId>

# Count unread emails
outlook-mail unread [-q "subject keyword"] [-l limit]

# Send an email
outlook-mail send --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"]
```

## Output Format

JSON arrays/objects for read operations.

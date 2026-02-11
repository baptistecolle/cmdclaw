---
name: slack
description: Interact with Slack workspaces. Use for reading channels/messages, sending messages, searching, managing threads, reactions, and uploading files.
---

# Slack

Read and write messages, search, manage threads, add reactions, and upload files in Slack.

## Environment Variables

- `SLACK_ACCESS_TOKEN` - Slack user OAuth token (required for `--as user` and read operations)
- `SLACK_BOT_RELAY_URL` - Optional relay endpoint for posting as bot
- `SLACK_BOT_RELAY_SECRET` - Secret for relay auth (required with `--as bot`)

## Commands

```bash
# List channels
slack channels [-l limit]

# Get channel message history
slack history -c <channelId> [-l limit]

# Get recent messages across all channels
slack recent [-l limit] [-q "filter query"]

# Send a message (optionally in a thread, actor required)
slack send -c <channelId> -t "Hello team" --as <user|bot> [--thread <ts>]

# Search messages
slack search -q "deployment failed" [-l limit]

# List users
slack users [-l limit]

# Get user info
slack user -u <userId>

# Get thread replies
slack thread -c <channelId> --thread <parentTs>

# Add a reaction
slack react -c <channelId> --ts <messageTs> -e thumbsup

# Upload a file
slack upload -c <channelId> -f ./report.pdf [--filename report.pdf] [--title "Q4 Report"] [--text "Here's the report"] [--thread <ts>]
```

## Output Format

JSON arrays. Example for `history`:

```json
[
  { "ts": "1705312800.000100", "user": "U01ABC", "text": "Hello!", "thread": null, "replies": 0 }
]
```

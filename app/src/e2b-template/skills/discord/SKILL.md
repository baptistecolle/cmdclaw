---
name: discord
description: Interact with Discord servers via a bot token. Use for listing guilds/channels, reading messages, and sending messages.
---

# Discord

Read and send messages in Discord servers using a bot token.

## Environment Variables

- `DISCORD_BOT_TOKEN` - Discord bot token

## Commands

```bash
# List guilds the bot is in
discord guilds

# List channels in a guild
discord channels <guildId>

# Get messages from a channel
discord messages <channelId> [-l limit]

# Send a message to a channel
discord send <channelId> --text "Hello world"
```

## Output Format

JSON arrays. Example for `messages`:

```json
[
  {
    "id": "123456",
    "author": { "id": "789", "username": "user1", "bot": false },
    "content": "Hello!",
    "timestamp": "2024-01-15T10:00:00.000000+00:00"
  }
]
```

---
name: reddit
description: Browse and interact with Reddit. Use for reading feeds, subreddits, posting, commenting, voting, and managing subscriptions.
---

# Reddit

Full Reddit interaction -- browsing, posting, commenting, voting, messaging, and subscription management.

## Environment Variables

- `REDDIT_ACCESS_TOKEN` - Reddit OAuth2 access token

## Commands

### Reading
```bash
reddit feed [-l limit] [-s hot|new|top|rising]
reddit subreddit <name> [-l limit] [-s hot|new|top|rising]
reddit post <id> [-l limit]          # Get post with comments
reddit user <username>               # Get user profile + recent activity
reddit search -q "query" [-l limit] [-t all|year|month|week|day|hour]
```

### Engagement
```bash
reddit vote <id> -d up|down|none
reddit comment <postId> --text "Great post!"
reddit reply <commentId> --text "I agree"
reddit save <id>
reddit unsave <id>
```

### Creating Content
```bash
reddit submit <subreddit> --title "My Post" [--text "Body text"]
reddit submit <subreddit> --title "Link Post" --url "https://..."
reddit edit <id> --text "Updated text"
reddit delete <id>
```

### Messaging
```bash
reddit inbox [-l limit]
reddit message <username> --subject "Hi" --text "Message body"
reddit read <messageId>
```

### Subscriptions
```bash
reddit subscriptions [-l limit]
reddit subscribe <subreddit>
reddit unsubscribe <subreddit>
```

Thing ID prefixes: `t1_` = comment, `t3_` = post, `t4_` = message, `t5_` = subreddit.

## Output Format

JSON arrays/objects. Example for `subreddit`:

```json
[
  { "id": "t3_abc123", "title": "Post Title", "author": "user1", "subreddit": "programming", "score": 42, "numComments": 15, "permalink": "https://reddit.com/..." }
]
```

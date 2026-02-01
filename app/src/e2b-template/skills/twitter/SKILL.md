---
name: twitter
description: Interact with Twitter/X. Use for reading timelines, posting tweets, searching, liking, retweeting, and managing follows.
---

# Twitter (X)

Read timelines, post tweets, search, engage with content, and manage follows via the Twitter API v2.

## Environment Variables

- `TWITTER_ACCESS_TOKEN` - Twitter OAuth2 bearer or user token

## Commands

### Profile
```bash
twitter me                          # Get your profile
twitter user <username>             # Get user by username
twitter user-id <id>                # Get user by ID
```

### Reading
```bash
twitter timeline [-l limit]         # Home timeline
twitter mentions [-l limit]         # Your mentions
twitter search -q "query" [-l limit] # Search recent tweets
twitter likes [-l limit]            # Your liked tweets
twitter followers [-l limit]
twitter following [-l limit]
```

### Posting
```bash
twitter post -t "Hello world!"
twitter reply <tweetId> -t "Great point!"
twitter quote <tweetId> -t "This is important"
```

### Engagement
```bash
twitter like <tweetId>
twitter unlike <tweetId>
twitter retweet <tweetId>
twitter unretweet <tweetId>
```

### Following
```bash
twitter follow <userId>
twitter unfollow <userId>
```

## Output Format

JSON objects. Example for `search`:

```json
{
  "meta": { "result_count": 10 },
  "tweets": [
    { "id": "123", "text": "Tweet content", "author": { "username": "user1" }, "metrics": { "like_count": 5 } }
  ]
}
```

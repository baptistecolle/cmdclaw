---
name: linear
description: Manage Linear issues and teams. Use for listing, creating, and updating issues, viewing team info, and checking assigned work.
---

# Linear

Issue tracking via the Linear GraphQL API.

## Environment Variables

- `LINEAR_ACCESS_TOKEN` - Linear API key

## Commands

```bash
# List issues (with optional filters)
linear list [-t <teamKey>] [-s <stateName>] [-l limit]

# Get issue details (includes comments, labels)
linear get ENG-123

# Create an issue
linear create --team ENG --title "Fix login bug" [-d "Description"] [-p 1] [-a user@example.com]
# Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low

# Update an issue
linear update ENG-123 [--title "New title"] [--state "Done"] [--priority 2]

# List teams
linear teams

# List my assigned issues (active only)
linear mine
```

## Output Format

JSON arrays/objects. Example for `list`:

```json
[
  { "identifier": "ENG-123", "title": "Fix login bug", "state": "In Progress", "priority": 2, "assignee": "John", "team": "ENG", "url": "https://linear.app/..." }
]
```

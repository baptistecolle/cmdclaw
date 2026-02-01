---
name: github
description: Interact with GitHub repositories, pull requests, issues, and code search. Use for repo management and code exploration.
---

# GitHub

Manage repos, PRs, issues, and search code via the GitHub REST API.

## Environment Variables

- `GITHUB_ACCESS_TOKEN` - GitHub personal access token

## Commands

```bash
# List your repositories
github repos [-l limit]

# List pull requests
github prs -o <owner> -r <repo> [-s open|closed|all] [-l limit]

# Get PR details with reviews
github pr <number> -o <owner> -r <repo>

# List your PRs across repos
github my-prs [-f created|assigned|review] [-s state]

# List issues
github issues -o <owner> -r <repo> [-s state] [--labels bug,feature]

# Create an issue
github create-issue -o <owner> -r <repo> -t "Bug title" [-b "Description"] [--labels bug]

# Search code
github search -q "useState filename:*.tsx" [-l limit]
```

## Output Format

JSON arrays/objects. Example for `prs`:

```json
[
  { "number": 42, "title": "Fix login", "author": "user1", "draft": false, "url": "https://github.com/..." }
]
```

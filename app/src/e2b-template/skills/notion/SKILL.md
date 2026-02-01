---
name: notion
description: Read and write Notion pages and databases. Use for searching, creating pages, appending content, and querying databases.
---

# Notion

Manage Notion pages and databases via the Notion API.

## Environment Variables

- `NOTION_ACCESS_TOKEN` - Notion integration token

## Commands

```bash
# Search pages and databases
notion search [-q "meeting notes"] [-l limit] [--type page|database]

# Get page content (properties + blocks)
notion get <pageId>

# Create a page under a parent page
notion create --parent <pageId> --title "New Page" [--content "Text content"]

# Create a page in a database
notion create --parent <databaseId> --title "Entry" --type database

# Append content to a page
notion append <pageId> --content "Additional text"

# List all databases
notion databases

# Query database entries
notion query <databaseId> [-l limit]
```

## Output Format

JSON objects. Example for `query`:

```json
[
  { "id": "abc-123", "url": "https://notion.so/...", "Name": "Task 1", "Status": "Done", "Priority": "High" }
]
```

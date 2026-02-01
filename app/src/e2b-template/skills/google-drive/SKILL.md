---
name: google-drive
description: Manage Google Drive files and folders. Use for listing, searching, uploading, downloading, and organizing files.
---

# Google Drive

File management on Google Drive including upload, download, search, and folder operations.

## Environment Variables

- `GOOGLE_DRIVE_ACCESS_TOKEN` - Google OAuth2 access token with Drive scope

## Commands

```bash
# List files
google-drive list [-q "name contains 'report'"] [-l limit] [-f folderId]

# Get file metadata
google-drive get <fileId>

# Download a file (Google Docs/Sheets auto-export as txt/csv)
google-drive download <fileId> [-o output.txt]

# Search files by content
google-drive search -q "budget" [-l limit]

# Upload a file
google-drive upload --file ./report.pdf [--name "Q4 Report"] [--folder <folderId>] [--mime application/pdf]

# Create a folder
google-drive mkdir --name "Projects" [--folder <parentId>]

# Delete a file
google-drive delete <fileId>

# List folders
google-drive folders [-l limit]
```

## Output Format

JSON arrays. Example for `list`:

```json
[
  { "id": "1abc...", "name": "report.pdf", "mimeType": "application/pdf", "size": "245KB", "modifiedTime": "2024-01-15T10:00:00Z", "url": "https://drive.google.com/..." }
]
```

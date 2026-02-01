---
name: google-docs
description: Read and write Google Docs documents. Use for getting document content, creating documents, appending text, and searching.
---

# Google Docs

Read, create, and modify Google Docs via the Google Docs API.

## Environment Variables

- `GOOGLE_DOCS_ACCESS_TOKEN` - Google OAuth2 access token with Docs and Drive scopes

## Commands

```bash
# Get document content
google-docs get <documentId>

# Create a new document
google-docs create --title "My Doc" [--content "Initial text"]

# Append text to a document
google-docs append <documentId> --text "New paragraph"

# List recent documents
google-docs list [-l limit]

# Search documents by content
google-docs search "quarterly report" [-l limit]
```

## Output Format

JSON objects. Example for `get`:

```json
{
  "documentId": "1BxiMVs...",
  "title": "My Document",
  "content": "Full text content of the document...",
  "revisionId": "ALm37BU..."
}
```

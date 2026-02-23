---
name: google-sheets
description: Read and write Google Sheets spreadsheets. Use for getting data, creating sheets, appending rows, updating cells, and managing tabs.
---

# Google Sheets

Read, write, and manage Google Sheets spreadsheets.

## Environment Variables

- `GOOGLE_SHEETS_ACCESS_TOKEN` - Google OAuth2 access token with Sheets and Drive scopes

## Commands

```bash
# Get spreadsheet metadata (sheets, dimensions)
google-sheets get <spreadsheetId>

# Get cell values from a range
google-sheets get <spreadsheetId> --range "Sheet1!A1:D10"

# Create a new spreadsheet
google-sheets create --title "Q4 Report"

# Append rows
google-sheets append <spreadsheetId> --range "A:B" --values '[["Name","Score"],["Alice","95"]]'

# Update specific cells
google-sheets update <spreadsheetId> --range "A1:B2" --values '[["Name","Score"],["Alice","95"]]'

# Clear a range
google-sheets clear <spreadsheetId> --range "A1:B10"

# Add a new sheet tab
google-sheets add-sheet <spreadsheetId> --title "Summary"

# List recent spreadsheets
google-sheets list [-l limit]
```

## Output Format

JSON objects. Example for `get` with range:

```json
{
  "spreadsheetId": "1abc...",
  "range": "Sheet1!A1:D3",
  "values": [["Name","Score"],["Alice","95"],["Bob","87"]]
}
```

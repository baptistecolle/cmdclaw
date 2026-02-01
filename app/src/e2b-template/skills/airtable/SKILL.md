---
name: airtable
description: Manage Airtable bases, tables, and records. Use for listing bases, reading/creating/updating/deleting records, and searching.
---

# Airtable

CRUD operations on Airtable bases and records via the Airtable REST API.

## Environment Variables

- `AIRTABLE_ACCESS_TOKEN` - Airtable personal access token

## Commands

```bash
# List all bases
airtable bases

# Get base schema (tables and fields)
airtable schema -b <baseId>

# List records
airtable list -b <baseId> -t <tableIdOrName> [-l limit] [-v view] [-f formula]

# Get a single record
airtable get -b <baseId> -t <table> -r <recordId>

# Create a record
airtable create -b <baseId> -t <table> --fields '{"Name":"John","Email":"john@example.com"}'

# Update a record
airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"Jane"}'

# Delete a record
airtable delete -b <baseId> -t <table> -r <recordId>

# Search records by field value
airtable search -b <baseId> -t <table> -s <value> --search-field <fieldName>
```

## Output Format

JSON arrays/objects. Example for `list`:

```json
[
  { "id": "recABC123", "Name": "John", "Email": "john@example.com" }
]
```

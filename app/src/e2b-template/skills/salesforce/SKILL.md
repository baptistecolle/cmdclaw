---
name: salesforce
description: Query and manage Salesforce CRM records using SOQL/SOSL. Use for querying any object, CRUD operations, and exploring object metadata.
---

# Salesforce

Salesforce CRM operations via the REST API -- SOQL queries, record CRUD, SOSL search, and object metadata.

## Environment Variables

- `SALESFORCE_ACCESS_TOKEN` - Salesforce OAuth2 access token
- `SALESFORCE_INSTANCE_URL` - Salesforce instance URL (e.g. `https://myorg.my.salesforce.com`)

## Commands

```bash
# Run a SOQL query
salesforce query SELECT Id, Name, Email FROM Contact WHERE Email != null LIMIT 10

# Get a record by ID
salesforce get Contact 003xx000004TmiQAAS [Name,Email,Phone]

# Create a record
salesforce create Contact '{"FirstName":"John","LastName":"Doe","Email":"john@example.com"}'

# Update a record
salesforce update Contact 003xx000004TmiQAAS '{"Phone":"555-1234"}'

# Describe object schema (fields, types, picklists)
salesforce describe Opportunity

# List all available objects
salesforce objects

# Cross-object search (SOSL)
salesforce search FIND {John} IN ALL FIELDS RETURNING Contact(Name, Email), Lead(Name, Email)
```

## Output Format

JSON objects. Example for `query`:

```json
{
  "totalSize": 5,
  "done": true,
  "records": [
    { "Id": "003xx...", "Name": "John Doe", "Email": "john@example.com" }
  ]
}
```

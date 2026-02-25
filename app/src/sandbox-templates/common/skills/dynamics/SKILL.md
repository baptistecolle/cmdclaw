---
name: dynamics
description: Native Microsoft Dynamics 365 Dataverse operations (tables and rows) with read/write support.
---

# Microsoft Dynamics 365 (Dataverse)

Native Dataverse API operations for environments, tables, and rows.

## Environment Variables

- `DYNAMICS_ACCESS_TOKEN` - OAuth access token
- `DYNAMICS_INSTANCE_URL` - Selected Dataverse instance URL (for example: `https://contoso.crm.dynamics.com`)

## Commands

```bash
# Inspect schema
dynamics tables list [--top 50]
dynamics tables get <logicalName>

# Read rows
dynamics rows list <tableLogicalName> [--select col1,col2] [--filter "statecode eq 0"] [--orderby "modifiedon desc"] [--top 25]
dynamics rows get <tableLogicalName> <rowId> [--select col1,col2]

# Write rows
dynamics rows create <tableLogicalName> '{"name":"Acme"}'
dynamics rows update <tableLogicalName> <rowId> '{"name":"Acme Updated"}'
dynamics rows delete <tableLogicalName> <rowId>

# Identity helper
dynamics whoami
```

---
name: hubspot
description: Manage HubSpot CRM records including contacts, companies, deals, tickets, tasks, and notes. Use for CRM operations and pipeline management.
---

# HubSpot

Full CRM management via HubSpot API -- contacts, companies, deals, tickets, tasks, notes, and pipelines.

## Environment Variables

- `HUBSPOT_ACCESS_TOKEN` - HubSpot private app access token

## Commands

### Contacts
```bash
hubspot contacts list [-l limit]
hubspot contacts get <id>
hubspot contacts create --email "j@example.com" [--firstname John] [--lastname Doe] [--company Acme] [--phone 555-1234]
hubspot contacts update <id> --properties '{"firstname":"Jane"}'
hubspot contacts search -q "john"
```

### Companies
```bash
hubspot companies list [-l limit]
hubspot companies get <id>
hubspot companies create --name "Acme Inc" [--domain acme.com] [--industry Technology]
hubspot companies update <id> --properties '{"name":"Acme Corp"}'
```

### Deals
```bash
hubspot deals list [-l limit]
hubspot deals get <id>
hubspot deals create --name "Big Deal" --pipeline <pipelineId> --stage <stageId> [--amount 50000]
hubspot deals update <id> --properties '{"amount":"75000"}'
```

### Tickets
```bash
hubspot tickets list [-l limit]
hubspot tickets get <id>
hubspot tickets create --subject "Bug report" --pipeline <id> --stage <id> [--body "Details"]
hubspot tickets update <id> --properties '{"subject":"Updated"}'
```

### Tasks
```bash
hubspot tasks list [-l limit]
hubspot tasks get <id>
hubspot tasks create --subject "Follow up" [--body "Call client"] [--due 2024-01-20]
hubspot tasks complete <id>
```

### Notes
```bash
hubspot notes list [-l limit]
hubspot notes create --body "Met with client" [--contact <id>] [--company <id>] [--deal <id>]
```

### Pipelines & Owners
```bash
hubspot pipelines deals       # List deal pipelines and stages
hubspot pipelines tickets     # List ticket pipelines and stages
hubspot owners                # List owners/sales reps
```

## Output Format

JSON arrays/objects with CRM properties.

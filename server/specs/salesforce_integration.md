# Salesforce Integration Spec

## Overview

Enable the agent to interact with Salesforce CRM on behalf of users. Users connect their Salesforce account via OAuth, and the agent can query, create, and update records using the Salesforce REST API.

**Agent acts as the user** - inherits the user's Salesforce permissions and data access.

## Goals

- Simple OAuth connection flow (same UX as existing integrations)
- Support core CRM objects: Account, Contact, Lead, Opportunity, Task
- Flexible SOQL queries for custom objects and complex data retrieval
- Read operations auto-approved, write operations require user approval
- No delete or bulk operations (safety guardrails)

## User Flow

### Connecting Salesforce

1. User navigates to Settings → Integrations
2. User clicks "Connect" on Salesforce card
3. User is redirected to Salesforce login page (`login.salesforce.com`)
4. User logs in with their Salesforce credentials
5. User clicks "Allow" to grant BAP access
6. User is redirected back to BAP → connected
7. Integration shows as connected with user's name/org

### Agent Using Salesforce

1. User asks: "Find all opportunities over $50k closing this month"
2. Agent executes: `salesforce query "SELECT Id, Name, Amount FROM Opportunity WHERE Amount > 50000 AND CloseDate = THIS_MONTH"`
3. Results returned to agent (auto-approved - read operation)
4. User asks: "Update the Acme deal to Negotiation stage"
5. Agent executes: `salesforce update Opportunity <id> --Stage="Negotiation"`
6. **Approval prompt shown** (write operation)
7. User approves → record updated

## OAuth Setup

### BAP Side (One-time Setup)

You need to create a Connected App in Salesforce:

1. **Create a free Salesforce Developer account** at [developer.salesforce.com](https://developer.salesforce.com/signup)

2. **Create a Connected App**:
   - Setup → Apps → App Manager → New Connected App
   - Fill in basic info (name: "BAP", contact email)
   - Enable OAuth Settings:
     - Callback URL: `https://yourdomain.com/api/oauth/callback`
     - Selected OAuth Scopes:
       - `Access and manage your data (api)`
       - `Perform requests on your behalf at any time (refresh_token, offline_access)`
       - `Access unique user identifiers (openid)`
     - Require Secret for Web Server Flow: **Checked**
   - Save and wait 2-10 minutes for activation

3. **Get credentials**:
   - Go to App Manager → Your App → View
   - Copy **Consumer Key** → `SALESFORCE_CLIENT_ID`
   - Copy **Consumer Secret** → `SALESFORCE_CLIENT_SECRET`

4. **Add to environment**:
   ```bash
   SALESFORCE_CLIENT_ID=your_consumer_key
   SALESFORCE_CLIENT_SECRET=your_consumer_secret
   ```

### Customer Side

**For most customers**: Nothing required. They just click Connect and log in.

**For enterprise orgs with strict security** (Admin approval required):

The Salesforce admin may need to:
1. Go to Setup → Connected Apps OAuth Usage
2. Find "BAP" in the list
3. Click Install or Unblock

Alternatively, pre-authorize via:
1. Setup → Connected Apps → Manage Connected Apps
2. Find BAP → Edit Policies
3. Set "Permitted Users" to "Admin approved users are pre-authorized"
4. Add profiles/permission sets that can use BAP

> **Note (September 2025)**: Salesforce is [tightening Connected App security](https://admin.salesforce.com/blog/2025/get-ready-for-changes-to-connected-app-usage-restrictions). Enterprise customers with strict settings will need admin approval.

## Technical Design

### 1. Database Schema

Add `salesforce` to the integration type enum:

```typescript
// src/server/db/schema.ts
export const integrationTypeEnum = pgEnum("integration_type", [
  "gmail",
  "google_calendar",
  // ... existing types
  "salesforce", // Add this
]);
```

**Migration**: Run `bun db:push` to apply the enum change.

### 2. OAuth Configuration

```typescript
// src/server/oauth/config.ts
salesforce: () => ({
  clientId: env.SALESFORCE_CLIENT_ID ?? "",
  clientSecret: env.SALESFORCE_CLIENT_SECRET ?? "",
  authUrl: "https://login.salesforce.com/services/oauth2/authorize",
  tokenUrl: "https://login.salesforce.com/services/oauth2/token",
  redirectUri: `${getAppUrl()}/api/oauth/callback`,
  scopes: ["api", "refresh_token", "openid"],
  getUserInfo: async (accessToken: string) => {
    // Salesforce returns instance_url in token response, but we need user info
    const res = await fetch(
      "https://login.salesforce.com/services/oauth2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();
    return {
      id: data.user_id,
      displayName: data.name,
      metadata: {
        organizationId: data.organization_id,
        email: data.email,
        // instance_url comes from token response, handled separately
      },
    };
  },
}),
```

**Important**: Salesforce returns `instance_url` in the token response (e.g., `https://na123.salesforce.com`). This must be stored in metadata and used for all API calls.

Update the OAuth callback handler to capture `instance_url`:

```typescript
// src/app/api/oauth/callback/route.ts
// After token exchange, extract instance_url from token response
if (integrationType === "salesforce") {
  metadata.instanceUrl = tokenResponse.instance_url;
}
```

### 3. Environment Variables

```typescript
// src/env.js
SALESFORCE_CLIENT_ID: z.string().optional(),
SALESFORCE_CLIENT_SECRET: z.string().optional(),
```

### 4. CLI Environment Mapping

```typescript
// src/server/integrations/cli-env.ts
const ENV_VAR_MAP: Record<IntegrationType, string> = {
  // ... existing mappings
  salesforce: "SALESFORCE_ACCESS_TOKEN",
};

// Also need to pass instance URL to CLI
// Add to getCliEnvForUser():
if (integration.type === "salesforce" && integration.metadata?.instanceUrl) {
  envVars["SALESFORCE_INSTANCE_URL"] = integration.metadata.instanceUrl;
}
```

### 5. CLI Implementation

Create new file: `src/e2b-template/cli/salesforce.ts`

```typescript
#!/usr/bin/env node
import { parseArgs } from "util";

const TOKEN = process.env.SALESFORCE_ACCESS_TOKEN;
const INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL;
const API_VERSION = "v59.0";

if (!TOKEN || !INSTANCE_URL) {
  console.log(JSON.stringify({
    error: {
      code: "AUTH_REQUIRED",
      integration: "salesforce",
      message: "Salesforce authentication required",
    },
  }));
  process.exit(1);
}

const baseUrl = `${INSTANCE_URL}/services/data/${API_VERSION}`;

async function sfFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    console.log(JSON.stringify({
      error: {
        code: "AUTH_REQUIRED",
        integration: "salesforce",
        message: "Salesforce session expired, please reconnect",
      },
    }));
    process.exit(1);
  }

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error[0]?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

// Commands
const commands = {
  // SOQL Query - most flexible, works with any object including custom
  async query(soql: string) {
    const encoded = encodeURIComponent(soql);
    return sfFetch(`/query?q=${encoded}`);
  },

  // Get single record by ID
  async get(objectType: string, recordId: string, fields?: string[]) {
    const path = fields
      ? `/sobjects/${objectType}/${recordId}?fields=${fields.join(",")}`
      : `/sobjects/${objectType}/${recordId}`;
    return sfFetch(path);
  },

  // Create new record
  async create(objectType: string, data: Record<string, unknown>) {
    return sfFetch(`/sobjects/${objectType}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Update existing record
  async update(objectType: string, recordId: string, data: Record<string, unknown>) {
    await fetch(`${baseUrl}/sobjects/${objectType}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return { success: true, id: recordId };
  },

  // Describe object (get fields, types, picklist values)
  async describe(objectType: string) {
    return sfFetch(`/sobjects/${objectType}/describe`);
  },

  // List available objects
  async objects() {
    return sfFetch("/sobjects");
  },

  // Search across objects (SOSL)
  async search(sosl: string) {
    const encoded = encodeURIComponent(sosl);
    return sfFetch(`/search?q=${encoded}`);
  },
};

// CLI argument parsing
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    let result;

    switch (command) {
      case "query": {
        const soql = args.slice(1).join(" ");
        if (!soql) throw new Error("Usage: salesforce query <SOQL>");
        result = await commands.query(soql);
        break;
      }

      case "get": {
        const [, objectType, recordId, ...fieldArgs] = args;
        if (!objectType || !recordId) {
          throw new Error("Usage: salesforce get <ObjectType> <RecordId> [field1,field2,...]");
        }
        const fields = fieldArgs[0]?.split(",");
        result = await commands.get(objectType, recordId, fields);
        break;
      }

      case "create": {
        const [, objectType, jsonData] = args;
        if (!objectType || !jsonData) {
          throw new Error('Usage: salesforce create <ObjectType> \'{"Field": "Value"}\'');
        }
        result = await commands.create(objectType, JSON.parse(jsonData));
        break;
      }

      case "update": {
        const [, objectType, recordId, jsonData] = args;
        if (!objectType || !recordId || !jsonData) {
          throw new Error('Usage: salesforce update <ObjectType> <RecordId> \'{"Field": "Value"}\'');
        }
        result = await commands.update(objectType, recordId, JSON.parse(jsonData));
        break;
      }

      case "describe": {
        const [, objectType] = args;
        if (!objectType) throw new Error("Usage: salesforce describe <ObjectType>");
        result = await commands.describe(objectType);
        break;
      }

      case "objects": {
        result = await commands.objects();
        break;
      }

      case "search": {
        const sosl = args.slice(1).join(" ");
        if (!sosl) throw new Error("Usage: salesforce search <SOSL>");
        result = await commands.search(sosl);
        break;
      }

      default:
        console.log(JSON.stringify({
          error: "Unknown command",
          availableCommands: [
            "query <SOQL>       - Execute SOQL query",
            "get <Object> <Id>  - Get record by ID",
            "create <Object> <JSON> - Create new record",
            "update <Object> <Id> <JSON> - Update record",
            "describe <Object>  - Get object metadata",
            "objects            - List available objects",
            "search <SOSL>      - Cross-object search",
          ],
        }));
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }));
    process.exit(1);
  }
}

main();
```

### 6. Agent Runner Permissions

```typescript
// src/e2b-template/agent-runner.ts

// Add to CLI_TO_INTEGRATION map
const CLI_TO_INTEGRATION: Record<string, IntegrationType> = {
  // ... existing mappings
  salesforce: "salesforce",
};

// Add to TOOL_PERMISSIONS
const TOOL_PERMISSIONS: Record<IntegrationType, { read: string[]; write: string[] }> = {
  // ... existing permissions
  salesforce: {
    read: ["query", "get", "describe", "objects", "search"],
    write: ["create", "update"],
  },
};
```

### 7. CLI Instructions for Agent

```typescript
// src/server/integrations/cli-env.ts - getCliInstructions()

salesforce: `
## Salesforce CLI

Query and manage Salesforce CRM records.

### Commands

**Query records (SOQL):**
\`\`\`bash
salesforce query "SELECT Id, Name, Email FROM Contact WHERE AccountId = '001xxx'"
salesforce query "SELECT Id, Name, Amount, StageName FROM Opportunity WHERE Amount > 50000"
salesforce query "SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10"
\`\`\`

**Get single record:**
\`\`\`bash
salesforce get Account 001xxxxxxxxxxxx
salesforce get Contact 003xxxxxxxxxxxx Name,Email,Phone
\`\`\`

**Create record:**
\`\`\`bash
salesforce create Contact '{"FirstName": "John", "LastName": "Doe", "Email": "john@example.com", "AccountId": "001xxx"}'
salesforce create Task '{"Subject": "Follow up", "WhoId": "003xxx", "ActivityDate": "2025-02-01"}'
salesforce create Opportunity '{"Name": "New Deal", "StageName": "Prospecting", "CloseDate": "2025-03-01", "Amount": 10000}'
\`\`\`

**Update record:**
\`\`\`bash
salesforce update Opportunity 006xxxxxxxxxxxx '{"StageName": "Negotiation", "Amount": 15000}'
salesforce update Contact 003xxxxxxxxxxxx '{"Phone": "555-1234"}'
\`\`\`

**Describe object (get fields):**
\`\`\`bash
salesforce describe Account
salesforce describe Opportunity
salesforce describe CustomObject__c
\`\`\`

**List all objects:**
\`\`\`bash
salesforce objects
\`\`\`

**Search across objects (SOSL):**
\`\`\`bash
salesforce search "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)"
\`\`\`

### Common Objects
- **Account** - Companies/organizations
- **Contact** - People at companies
- **Lead** - Potential customers
- **Opportunity** - Sales deals
- **Task** - To-do items
- **Case** - Support tickets

### SOQL Tips
- Use \`LIMIT\` to restrict results
- Date literals: \`TODAY\`, \`THIS_MONTH\`, \`LAST_N_DAYS:30\`
- Custom objects end with \`__c\` (e.g., \`Invoice__c\`)
- Custom fields end with \`__c\` (e.g., \`Custom_Field__c\`)
`,
```

### 8. UI Integration

```typescript
// src/app/settings/integrations/page.tsx
const integrationConfig: Record<IntegrationType, IntegrationConfig> = {
  // ... existing integrations
  salesforce: {
    name: "Salesforce",
    description: "Query and manage CRM records, opportunities, and contacts",
    icon: SalesforceIcon, // Or use an SVG/image
    bgColor: "bg-[#00A1E0]", // Salesforce blue
  },
};
```

Add Salesforce icon to `src/lib/integration-icons.ts` or use an inline SVG.

## Permission Model

| Operation | Command | Auto-approve | Requires approval |
|-----------|---------|--------------|-------------------|
| Query records | `query` | Yes | |
| Get record | `get` | Yes | |
| Describe object | `describe` | Yes | |
| List objects | `objects` | Yes | |
| Search | `search` | Yes | |
| Create record | `create` | | Yes |
| Update record | `update` | | Yes |

**Not supported (by design):**
- `delete` - Too dangerous, users should delete in Salesforce UI
- Bulk operations - Risk of mass data modification
- Admin operations - Creating users, changing permissions, etc.

## Example Agent Interactions

### Query Examples

```
User: "Show me all open opportunities over $50k"
Agent: salesforce query "SELECT Id, Name, Amount, StageName, CloseDate FROM Opportunity WHERE Amount > 50000 AND IsClosed = false ORDER BY Amount DESC"

User: "Find John Smith's contact info"
Agent: salesforce query "SELECT Id, Name, Email, Phone, Account.Name FROM Contact WHERE Name LIKE '%John Smith%'"

User: "What deals are closing this month?"
Agent: salesforce query "SELECT Id, Name, Amount, StageName, Account.Name FROM Opportunity WHERE CloseDate = THIS_MONTH AND IsClosed = false"
```

### Create Examples

```
User: "Create a follow-up task for the Acme opportunity"
Agent:
1. salesforce query "SELECT Id FROM Opportunity WHERE Account.Name = 'Acme' LIMIT 1"
2. salesforce create Task '{"Subject": "Follow up on Acme opportunity", "WhatId": "006xxx", "ActivityDate": "2025-01-30"}'
[Approval required]

User: "Add a new contact Jane Doe at Acme Corp"
Agent:
1. salesforce query "SELECT Id FROM Account WHERE Name = 'Acme Corp' LIMIT 1"
2. salesforce create Contact '{"FirstName": "Jane", "LastName": "Doe", "AccountId": "001xxx"}'
[Approval required]
```

### Update Examples

```
User: "Move the Acme deal to Closed Won"
Agent:
1. salesforce query "SELECT Id FROM Opportunity WHERE Account.Name = 'Acme' AND IsClosed = false LIMIT 1"
2. salesforce update Opportunity 006xxx '{"StageName": "Closed Won"}'
[Approval required]
```

## Token Refresh

Salesforce uses standard OAuth refresh token flow. Add to `token-refresh.ts`:

```typescript
// src/server/integrations/token-refresh.ts
case "salesforce": {
  const response = await fetch("https://login.salesforce.com/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: env.SALESFORCE_CLIENT_ID!,
      client_secret: env.SALESFORCE_CLIENT_SECRET!,
    }),
  });
  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    // Note: Salesforce may return new instance_url, but typically stable
  };
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/server/db/schema.ts` | Add `"salesforce"` to `integrationTypeEnum` |
| `src/server/oauth/config.ts` | Add `salesforce` OAuth configuration |
| `src/app/api/oauth/callback/route.ts` | Handle `instance_url` from Salesforce token response |
| `src/server/integrations/cli-env.ts` | Add `SALESFORCE_ACCESS_TOKEN` and `SALESFORCE_INSTANCE_URL` mapping, add CLI instructions |
| `src/server/integrations/token-refresh.ts` | Add Salesforce refresh token logic |
| `src/e2b-template/agent-runner.ts` | Add Salesforce to `CLI_TO_INTEGRATION` and `TOOL_PERMISSIONS` |
| `src/e2b-template/cli/salesforce.ts` | **New file** - CLI implementation |
| `src/app/settings/integrations/page.tsx` | Add Salesforce to UI config |
| `src/lib/integration-icons.ts` | Add Salesforce icon |
| `src/env.js` | Add `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` |

## Implementation Order

1. **Environment & Schema** - Add env vars and update schema enum
2. **Database migration** - Run `bun db:push`
3. **OAuth config** - Add Salesforce OAuth configuration
4. **OAuth callback** - Handle instance_url extraction
5. **Token refresh** - Add Salesforce refresh logic
6. **CLI env mapping** - Add token and instance URL injection
7. **CLI implementation** - Create salesforce.ts CLI tool
8. **Agent runner** - Add permissions and CLI mapping
9. **UI** - Add Salesforce to integrations page
10. **CLI instructions** - Add help text for agent
11. **Testing** - Connect, query, create, update flows

## Edge Cases

- **Instance URL changes**: Rare, but can happen during org migrations. Stored instance_url should be updated on token refresh if different.
- **API limits**: Salesforce has [API call limits](https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm) (e.g., 100k/day for Enterprise). Agent should be mindful of excessive queries.
- **Field-level security**: Users may not have access to all fields. The API will return only accessible fields.
- **Record types**: Some objects have record types that affect picklist values. Agent can use `describe` to discover valid values.
- **Session timeout**: Salesforce sessions can expire. CLI handles 401 by returning `AUTH_REQUIRED`.

## Future Considerations

### AppExchange Listing (Long-term)

Publishing BAP to Salesforce AppExchange would:
- Make enterprise adoption smoother (one-click install)
- Provide trust signals (Salesforce security review)
- Enable automatic Connected App installation

Requirements:
- Salesforce security review process
- ISV partner program enrollment
- Compliance documentation

### Additional Features (If Needed Later)

- **Case management** - Support ticket creation/updates
- **Chatter** - Post to feeds, collaboration
- **Reports** - Run existing Salesforce reports
- **Files** - Attach/download files on records
- **Bulk API** - For large data operations (with appropriate safeguards)
- **Streaming API** - Real-time record change notifications

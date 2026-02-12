/**
 * OpenCode Plugin: Integration Permissions
 *
 * This plugin handles permission control for integration CLI tools:
 * - Auto-approves read operations
 * - Requests user approval for write operations via HTTP callback
 * - Requests OAuth authentication for missing tokens via HTTP callback
 */

// Integration CLI names to internal type mapping
const CLI_TO_INTEGRATION: Record<string, string> = {
  slack: "slack",
  "google-gmail": "gmail",
  gcalendar: "google_calendar",
  gdocs: "google_docs",
  gsheets: "google_sheets",
  gdrive: "google_drive",
  notion: "notion",
  linear: "linear",
  github: "github",
  airtable: "airtable",
  hubspot: "hubspot",
  linkedin: "linkedin",
  salesforce: "salesforce",
  twitter: "twitter",
  discord: "discord",
};

// Tool permissions: read operations auto-approve, write operations require approval
const TOOL_PERMISSIONS: Record<string, { read: string[]; write: string[] }> = {
  slack: {
    read: ["channels", "history", "search", "recent", "users", "user", "thread"],
    write: ["send", "react", "upload"],
  },
  gmail: {
    read: ["list", "get", "unread"],
    write: ["send"],
  },
  google_calendar: {
    read: ["list", "get", "calendars", "today"],
    write: ["create", "update", "delete"],
  },
  google_docs: {
    read: ["get", "list", "search"],
    write: ["create", "append"],
  },
  google_sheets: {
    read: ["get", "list"],
    write: ["create", "append", "update", "clear", "add-sheet"],
  },
  google_drive: {
    read: ["list", "get", "download", "search", "folders"],
    write: ["upload", "mkdir", "delete"],
  },
  notion: {
    read: ["search", "get", "databases", "query"],
    write: ["create", "append"],
  },
  linear: {
    read: ["list", "get", "teams", "mine"],
    write: ["create", "update"],
  },
  github: {
    read: ["repos", "prs", "pr", "my-prs", "issues", "search"],
    write: ["create-issue"],
  },
  airtable: {
    read: ["bases", "schema", "list", "get", "search"],
    write: ["create", "update", "delete"],
  },
  hubspot: {
    read: [
      "contacts.list",
      "contacts.get",
      "contacts.search",
      "companies.list",
      "companies.get",
      "deals.list",
      "deals.get",
      "tickets.list",
      "tickets.get",
      "tasks.list",
      "tasks.get",
      "notes.list",
      "pipelines.deals",
      "pipelines.tickets",
      "owners",
    ],
    write: [
      "contacts.create",
      "contacts.update",
      "companies.create",
      "companies.update",
      "deals.create",
      "deals.update",
      "tickets.create",
      "tickets.update",
      "tasks.create",
      "tasks.complete",
      "notes.create",
    ],
  },
  linkedin: {
    read: [
      "chats.list",
      "chats.get",
      "messages.list",
      "profile.me",
      "profile.get",
      "profile.company",
      "search",
      "invite.list",
      "connections.list",
      "posts.list",
      "posts.get",
      "company.posts",
    ],
    write: [
      "messages.send",
      "messages.start",
      "invite.send",
      "connections.remove",
      "posts.create",
      "posts.comment",
      "posts.react",
      "company.post",
    ],
  },
  salesforce: {
    read: ["query", "get", "describe", "objects", "search"],
    write: ["create", "update"],
  },
  twitter: {
    read: [
      "me",
      "user",
      "user-id",
      "timeline",
      "mentions",
      "search",
      "likes",
      "followers",
      "following",
    ],
    write: [
      "post",
      "reply",
      "quote",
      "like",
      "unlike",
      "retweet",
      "unretweet",
      "follow",
      "unfollow",
    ],
  },
  discord: {
    read: ["guilds", "channels", "messages"],
    write: ["send"],
  },
};

// Environment variable names for integration tokens
const TOKEN_ENV_VARS: Record<string, string> = {
  slack: "SLACK_ACCESS_TOKEN",
  gmail: "GMAIL_ACCESS_TOKEN",
  google_calendar: "GOOGLE_CALENDAR_ACCESS_TOKEN",
  google_docs: "GOOGLE_DOCS_ACCESS_TOKEN",
  google_sheets: "GOOGLE_SHEETS_ACCESS_TOKEN",
  google_drive: "GOOGLE_DRIVE_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  linear: "LINEAR_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
  hubspot: "HUBSPOT_ACCESS_TOKEN",
  linkedin: "LINKEDIN_ACCOUNT_ID",
  salesforce: "SALESFORCE_ACCESS_TOKEN",
  twitter: "TWITTER_ACCESS_TOKEN",
  discord: "DISCORD_BOT_TOKEN",
};

// Display names for integrations
const INTEGRATION_NAMES: Record<string, string> = {
  slack: "Slack",
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_drive: "Google Drive",
  notion: "Notion",
  linear: "Linear",
  github: "GitHub",
  airtable: "Airtable",
  hubspot: "HubSpot",
  linkedin: "LinkedIn",
  salesforce: "Salesforce",
  twitter: "X (Twitter)",
  discord: "Discord",
};

// Custom integration permissions loaded from env var
let customPermissions: Record<string, { read: string[]; write: string[] }> = {};

function loadCustomPermissions() {
  const raw = process.env.CUSTOM_INTEGRATION_PERMISSIONS;
  if (raw) {
    try {
      customPermissions = JSON.parse(raw);
    } catch {
      console.error("[Plugin] Failed to parse CUSTOM_INTEGRATION_PERMISSIONS");
    }
  }
}

/**
 * Parse a Bash command to extract integration and operation
 */
function parseBashCommand(command: string): { integration: string; operation: string } | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return null;

  const cliName = parts[0];
  let integration = CLI_TO_INTEGRATION[cliName];

  // Check for custom integrations (custom-{slug} pattern)
  if (!integration && cliName.startsWith("custom-")) {
    integration = cliName; // Use full name as integration identifier
  }

  if (!integration) return null;

  const operation = parts[1];
  if (!operation) return null;

  // HubSpot has nested pattern: hubspot <resource> <action>
  if (integration === "hubspot" && parts.length >= 3) {
    const resource = parts[1];
    const action = parts[2];
    if (resource === "owners") {
      return { integration, operation: "owners" };
    }
    return { integration, operation: `${resource}.${action}` };
  }

  // LinkedIn has nested pattern: linkedin <resource> <action>
  if (integration === "linkedin" && parts.length >= 3) {
    const resource = parts[1];
    const action = parts[2];
    if (resource === "search") {
      return { integration, operation: "search" };
    }
    return { integration, operation: `${resource}.${action}` };
  }

  return { integration, operation };
}

function commandUsesSlackBotRelay(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed.startsWith("slack ")) return false;
  if (!/\bsend\b/.test(trimmed)) return false;
  return /\s--as\s+bot(?:\s|$)/.test(trimmed);
}

/**
 * Check if an operation requires approval (is a write operation)
 */
function isWriteOperation(integration: string, operation: string): boolean {
  // Check built-in permissions
  const permissions = TOOL_PERMISSIONS[integration];
  if (permissions) return permissions.write.includes(operation);

  // Check custom integration permissions
  const customPerms = customPermissions[integration];
  if (customPerms) return customPerms.write.includes(operation);

  return false;
}

/**
 * Request approval from the server
 */
async function requestApproval(params: {
  integration: string;
  operation: string;
  command: string;
  toolInput: unknown;
}): Promise<"allow" | "deny"> {
  const serverUrl = process.env.APP_URL;
  const serverSecret = process.env.BAP_SERVER_SECRET;
  const conversationId = process.env.CONVERSATION_ID;
  const sandboxId = process.env.SANDBOX_ID;

  if (!serverUrl || !conversationId) {
    console.error("[Plugin] Missing APP_URL or CONVERSATION_ID");
    return "deny";
  }

  try {
    const response = await fetch(`${serverUrl}/api/internal/approval-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sandboxId: sandboxId || "unknown",
        conversationId,
        integration: params.integration,
        operation: params.operation,
        command: params.command,
        toolInput: params.toolInput,
        authHeader: serverSecret ? `Bearer ${serverSecret}` : undefined,
      }),
    });

    if (!response.ok) {
      console.error("[Plugin] Approval request failed:", response.status);
      return "deny";
    }

    const result = await response.json();
    return result.decision || "deny";
  } catch (error) {
    console.error("[Plugin] Approval request error:", error);
    return "deny";
  }
}

/**
 * Request authentication from the server
 */
async function requestAuth(params: {
  integration: string;
  reason: string;
}): Promise<{ success: boolean; tokens?: Record<string, string> }> {
  const serverUrl = process.env.APP_URL;
  const serverSecret = process.env.BAP_SERVER_SECRET;
  const conversationId = process.env.CONVERSATION_ID;

  if (!serverUrl || !conversationId) {
    console.error("[Plugin] Missing APP_URL or CONVERSATION_ID");
    return { success: false };
  }

  try {
    const response = await fetch(`${serverUrl}/api/internal/auth-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        integration: params.integration,
        reason: params.reason,
        authHeader: serverSecret ? `Bearer ${serverSecret}` : undefined,
      }),
    });

    if (!response.ok) {
      console.error("[Plugin] Auth request failed:", response.status);
      return { success: false };
    }

    const result = await response.json();
    return {
      success: result.success || false,
      tokens: result.tokens,
    };
  } catch (error) {
    console.error("[Plugin] Auth request error:", error);
    return { success: false };
  }
}

/**
 * OpenCode Plugin Export
 */
export const IntegrationPermissionsPlugin = async () => {
  loadCustomPermissions();
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: Record<string, unknown> },
    ) => {
      // Only process Bash commands
      if (input.tool !== "bash" && input.tool !== "Bash") {
        return;
      }

      const command = (output.args.command as string) || "";
      const parsed = parseBashCommand(command);

      // Not an integration command, allow it
      if (!parsed) {
        return;
      }

      const { integration, operation } = parsed;
      const allowedRaw = process.env.ALLOWED_INTEGRATIONS || "";
      const allowedList = allowedRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (allowedList.length > 0 && !allowedList.includes(integration)) {
        throw new Error(`Integration "${integration}" is not allowed for this workflow`);
      }

      console.log(`[Plugin] Detected integration command: ${integration} ${operation}`);

      // Check if integration token is available
      const tokenEnvVar = TOKEN_ENV_VARS[integration];
      // For custom integrations, check {SLUG}_ACCESS_TOKEN or {SLUG}_API_KEY
      let hasToken = tokenEnvVar ? !!process.env[tokenEnvVar] : false;
      if (!hasToken && integration.startsWith("custom-")) {
        const slug = integration.replace("custom-", "").toUpperCase().replace(/-/g, "_");
        hasToken = !!(process.env[`${slug}_ACCESS_TOKEN`] || process.env[`${slug}_API_KEY`]);
      }

      // slack send --as bot can use relay without a Slack user token
      if (
        !hasToken &&
        integration === "slack" &&
        operation === "send" &&
        commandUsesSlackBotRelay(command) &&
        !!process.env.SLACK_BOT_RELAY_SECRET &&
        !!(process.env.SLACK_BOT_RELAY_URL || process.env.APP_URL)
      ) {
        hasToken = true;
        console.log("[Plugin] Slack bot relay mode detected, skipping Slack user auth");
      }

      if (!hasToken) {
        console.log(`[Plugin] No token for ${integration}, requesting auth...`);

        const authResult = await requestAuth({
          integration,
          reason: `${INTEGRATION_NAMES[integration] || integration} authentication required`,
        });

        if (!authResult.success) {
          throw new Error(
            `Authentication not completed for ${INTEGRATION_NAMES[integration] || integration}`,
          );
        }

        // Inject received tokens into environment
        if (authResult.tokens) {
          for (const [key, value] of Object.entries(authResult.tokens)) {
            if (typeof value === "string") {
              process.env[key] = value;
              console.log(`[Plugin] Loaded token for ${key}`);
            }
          }
        }
      }

      // Check if this is a write operation
      if (isWriteOperation(integration, operation)) {
        console.log(`[Plugin] Write operation detected, requesting approval...`);

        const decision = await requestApproval({
          integration,
          operation,
          command,
          toolInput: output.args,
        });

        if (decision === "deny") {
          throw new Error("User denied this action");
        }

        console.log(`[Plugin] Approval granted for ${integration} ${operation}`);
      } else {
        console.log(`[Plugin] Read operation auto-approved: ${integration} ${operation}`);
      }
    },
  };
};

// Default export for OpenCode plugin loader
export default IntegrationPermissionsPlugin;

/**
 * Server-side permission checker for BYOC direct mode.
 * Ported from e2b-template/plugins/integration-permissions.ts.
 *
 * Checks bash commands for integration CLI usage and enforces
 * read/write permissions and auth requirements.
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
  reddit: "reddit",
  twitter: "twitter",
};

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
      "contacts.list", "contacts.get", "contacts.search",
      "companies.list", "companies.get",
      "deals.list", "deals.get",
      "tickets.list", "tickets.get",
      "tasks.list", "tasks.get",
      "notes.list",
      "pipelines.deals", "pipelines.tickets",
      "owners",
    ],
    write: [
      "contacts.create", "contacts.update",
      "companies.create", "companies.update",
      "deals.create", "deals.update",
      "tickets.create", "tickets.update",
      "tasks.create", "tasks.complete",
      "notes.create",
    ],
  },
  linkedin: {
    read: [
      "chats.list", "chats.get",
      "messages.list",
      "profile.me", "profile.get", "profile.company",
      "search",
      "invite.list",
      "connections.list",
      "posts.list", "posts.get",
      "company.posts",
    ],
    write: [
      "messages.send", "messages.start",
      "invite.send",
      "connections.remove",
      "posts.create", "posts.comment", "posts.react",
      "company.post",
    ],
  },
  salesforce: {
    read: ["query", "get", "describe", "objects", "search"],
    write: ["create", "update"],
  },
  reddit: {
    read: [
      "feed", "subreddit", "post", "user", "search", "multireddit",
      "inbox", "subscriptions",
    ],
    write: [
      "vote", "comment", "reply", "save", "unsave", "submit",
      "delete", "edit", "message", "read", "subscribe", "unsubscribe",
    ],
  },
  twitter: {
    read: ["me", "user", "user-id", "timeline", "mentions", "search", "likes", "followers", "following"],
    write: ["post", "reply", "quote", "like", "unlike", "retweet", "unretweet", "follow", "unfollow"],
  },
};

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
  reddit: "Reddit",
  twitter: "X (Twitter)",
};

export interface ParsedCommand {
  integration: string;
  operation: string;
  integrationName: string;
  isWrite: boolean;
}

/**
 * Parse a bash command to extract integration and operation.
 */
export function parseBashCommand(command: string): ParsedCommand | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return null;

  const cliName = parts[0];
  const integration = CLI_TO_INTEGRATION[cliName];
  if (!integration) return null;

  const operation = parts[1];
  if (!operation) return null;

  let finalOperation = operation;

  // HubSpot: hubspot <resource> <action>
  if (integration === "hubspot" && parts.length >= 3) {
    const resource = parts[1];
    const action = parts[2];
    finalOperation = resource === "owners" ? "owners" : `${resource}.${action}`;
  }

  // LinkedIn: linkedin <resource> <action>
  if (integration === "linkedin" && parts.length >= 3) {
    const resource = parts[1];
    const action = parts[2];
    finalOperation = resource === "search" ? "search" : `${resource}.${action}`;
  }

  const permissions = TOOL_PERMISSIONS[integration];
  const isWrite = permissions ? permissions.write.includes(finalOperation) : false;

  return {
    integration,
    operation: finalOperation,
    integrationName: INTEGRATION_NAMES[integration] || integration,
    isWrite,
  };
}

export interface PermissionCheckResult {
  allowed: boolean;
  /** If not allowed, why */
  reason?: string;
  /** Whether user approval is needed (write operation) */
  needsApproval: boolean;
  /** Whether OAuth auth is needed (missing token) */
  needsAuth: boolean;
  /** Which integration needs auth */
  integration?: string;
  /** Human-readable integration name */
  integrationName?: string;
}

/**
 * Check permissions for a tool call.
 * Returns what actions need to happen (auth, approval, or auto-allow).
 */
export function checkToolPermissions(
  toolName: string,
  toolInput: Record<string, unknown>,
  connectedIntegrations: string[]
): PermissionCheckResult {
  // Only bash commands can trigger integration permissions
  if (toolName !== "bash") {
    return { allowed: true, needsApproval: false, needsAuth: false };
  }

  const command = (toolInput.command as string) || "";
  const parsed = parseBashCommand(command);

  // Not an integration command - auto-allow
  if (!parsed) {
    return { allowed: true, needsApproval: false, needsAuth: false };
  }

  // Check if integration token is available
  const hasToken = connectedIntegrations.includes(parsed.integration);

  if (!hasToken) {
    return {
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: parsed.integration,
      integrationName: parsed.integrationName,
      reason: `${parsed.integrationName} authentication required`,
    };
  }

  // Write operations need user approval
  if (parsed.isWrite) {
    return {
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: parsed.integration,
      integrationName: parsed.integrationName,
    };
  }

  // Read operations auto-allowed
  return { allowed: true, needsApproval: false, needsAuth: false };
}

/**
 * Agent Runner Script for E2B Sandbox
 *
 * This script runs the Claude Agent SDK inside the E2B sandbox with:
 * - Auto-approval for read operations
 * - Approval requests for write operations (communicated via stdout/file IPC)
 */

import { query, type HookCallback, type PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink } from "fs/promises";

// Read config from environment
const config = JSON.parse(process.env.AGENT_CONFIG || "{}");
const { prompt, model, resume, systemPrompt } = config;

// Approval and auth communication paths
const APPROVAL_REQUEST_FILE = "/tmp/approval-request.json";
const APPROVAL_RESPONSE_FILE = "/tmp/approval-response.json";
const AUTH_RESPONSE_FILE = "/tmp/auth-response.json";
const INTEGRATION_TOKENS_FILE = "/tmp/integration-tokens.json";
const INTERRUPT_REQUEST_FILE = "/tmp/interrupt-request.json";

// Integration CLI names to internal type mapping
const CLI_TO_INTEGRATION: Record<string, string> = {
  "slack": "slack",
  "google-gmail": "gmail",
  "gcalendar": "google_calendar",
  "gdocs": "google_docs",
  "gsheets": "google_sheets",
  "gdrive": "google_drive",
  "notion": "notion",
  "linear": "linear",
  "github": "github",
  "airtable": "airtable",
  "hubspot": "hubspot",
  "linkedin": "linkedin",
  "salesforce": "salesforce",
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
};

/**
 * Parse a Bash command to extract integration and operation
 */
function parseBashCommand(command: string): { integration: string; operation: string } | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return null;

  const cliName = parts[0];
  const integration = CLI_TO_INTEGRATION[cliName];

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
  // e.g., linkedin chats list, linkedin messages send, linkedin profile me
  if (integration === "linkedin" && parts.length >= 3) {
    const resource = parts[1];
    const action = parts[2];
    // Handle special case for "search" which is just "linkedin search -q ..."
    if (resource === "search") {
      return { integration, operation: "search" };
    }
    return { integration, operation: `${resource}.${action}` };
  }

  return { integration, operation };
}

/**
 * Check if an operation requires approval (is a write operation)
 */
function isWriteOperation(integration: string, operation: string): boolean {
  const permissions = TOOL_PERMISSIONS[integration];
  if (!permissions) return false;
  return permissions.write.includes(operation);
}

/**
 * Emit an event to stdout for the server to stream
 */
function emitEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

/**
 * Wait for approval response from the server
 */
async function waitForApproval(toolUseId: string): Promise<"allow" | "deny"> {
  // Poll for response file
  const startTime = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minute timeout

  while (Date.now() - startTime < timeout) {
    try {
      const responseRaw = await readFile(APPROVAL_RESPONSE_FILE, "utf8");
      const response = JSON.parse(responseRaw);

      if (response.toolUseId === toolUseId) {
        // Clean up the response file
        await unlink(APPROVAL_RESPONSE_FILE).catch(() => {});
        return response.decision;
      }
    } catch {
      // File doesn't exist yet or invalid, continue polling
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, 100));
  }

  // Timeout: default to deny for safety
  return "deny";
}

/**
 * Wait for auth response from the server
 */
async function waitForAuth(): Promise<{ success: boolean; integrations: string[] }> {
  const startTime = Date.now();
  const timeout = 10 * 60 * 1000; // 10 minute timeout

  while (Date.now() - startTime < timeout) {
    try {
      const responseRaw = await readFile(AUTH_RESPONSE_FILE, "utf8");
      const response = JSON.parse(responseRaw);
      await unlink(AUTH_RESPONSE_FILE).catch(() => {});
      return { success: response.success, integrations: response.integrations || [] };
    } catch {
      // File doesn't exist yet, continue polling
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Timeout: default to failure
  return { success: false, integrations: [] };
}

/**
 * Load integration tokens from file and set them in process.env
 * This is called after successful OAuth to inject new tokens into the environment
 */
async function loadTokensFromFile(): Promise<void> {
  try {
    const tokensRaw = await readFile(INTEGRATION_TOKENS_FILE, "utf8");
    const tokens = JSON.parse(tokensRaw);

    // Set each token in the environment
    for (const [envVar, value] of Object.entries(tokens)) {
      if (typeof value === "string") {
        process.env[envVar] = value;
        console.error(`[Agent] Loaded token for ${envVar}`);
      }
    }

    // Clean up the tokens file
    await unlink(INTEGRATION_TOKENS_FILE).catch(() => {});
  } catch {
    // File doesn't exist or invalid - this is fine
  }
}

/**
 * Get the environment variable name for an integration's token
 */
function getTokenEnvVar(integration: string): string {
  const envVarMap: Record<string, string> = {
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
  };
  return envVarMap[integration] || "";
}

/**
 * Get the display name for an integration
 */
function getIntegrationDisplayName(integration: string): string {
  const names: Record<string, string> = {
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
  };
  return names[integration] || integration;
}

/**
 * PreToolUse hook for integration permission control
 */
const integrationPermissionHook: HookCallback = async (input, toolUseId, { signal }) => {
  console.error(`[Hook] Received hook event: ${input.hook_event_name}`);

  if (input.hook_event_name !== "PreToolUse") {
    return {};
  }

  const preInput = input as PreToolUseHookInput;
  const toolName = preInput.tool_name;
  const toolInput = preInput.tool_input as Record<string, unknown>;

  console.error(`[Hook] PreToolUse for tool: ${toolName}`);

  // Only process Bash commands that call our CLI tools
  if (toolName !== "Bash") {
    console.error(`[Hook] Not a Bash command, skipping`);
    return {};
  }

  const command = (toolInput.command as string) || "";
  console.error(`[Hook] Bash command: ${command}`);

  const parsed = parseBashCommand(command);
  console.error(`[Hook] Parsed result: ${JSON.stringify(parsed)}`);

  // Not an integration command, allow it
  if (!parsed) {
    console.error(`[Hook] Not an integration command, allowing`);
    return {};
  }

  const { integration, operation } = parsed;

  // Check if integration token is available
  const tokenEnvVar = getTokenEnvVar(integration);
  const hasToken = tokenEnvVar ? !!process.env[tokenEnvVar] : false;
  console.error(`[Hook] Integration: ${integration}, EnvVar: ${tokenEnvVar}, HasToken: ${hasToken}`);

  if (!hasToken) {
    console.error(`[Hook] No token found, emitting auth_needed event`);
    // Emit auth_needed event
    emitEvent({
      type: "auth_needed",
      integrations: [integration],
      reason: `${getIntegrationDisplayName(integration)} authentication required`,
    });

    // Wait for auth response
    const authResult = await waitForAuth();

    if (!authResult.success) {
      return {
        hookSpecificOutput: {
          hookEventName: input.hook_event_name,
          permissionDecision: "deny",
          permissionDecisionReason: "Authentication not completed",
        },
      };
    }

    // Auth succeeded - load the new tokens from file into process.env
    await loadTokensFromFile();
  }

  // Check if this is a write operation
  if (isWriteOperation(integration, operation)) {
    // Emit approval_needed event to stdout
    emitEvent({
      type: "approval_needed",
      toolUseId,
      toolName: toolName,
      toolInput: toolInput,
      integration,
      operation,
      command,
    });

    // Wait for approval from server
    const decision = await waitForApproval(toolUseId!);

    // Emit approval result back to frontend
    emitEvent({
      type: "approval_result",
      toolUseId,
      decision: decision === "allow" ? "approved" : "denied",
    });

    if (decision === "deny") {
      return {
        hookSpecificOutput: {
          hookEventName: input.hook_event_name,
          permissionDecision: "deny",
          permissionDecisionReason: "User denied this action",
        },
      };
    }

    // User approved
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "allow",
        permissionDecisionReason: "User approved this action",
      },
    };
  }

  // Read operation, auto-approve and emit tool_use event with integration info
  emitEvent({
    type: "tool_use_integration",
    toolUseId,
    integration,
    operation,
    isWrite: false,
  });

  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name,
      permissionDecision: "allow",
      permissionDecisionReason: "Read-only operation auto-approved",
    },
  };
};

/**
 * Main agent execution
 */
async function main() {
  if (!prompt) {
    console.error("No prompt provided in AGENT_CONFIG");
    process.exit(1);
  }

  try {
    // Create the query object so we can call interrupt()
    const q = query({
      prompt,
      options: {
        model: model || "claude-sonnet-4-20250514",
        systemPrompt,
        permissionMode: "bypassPermissions", // We handle permissions via hooks
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
        // maxThinkingTokens: 10000, // Enable extended thinking
        ...(resume ? { resume } : {}),
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [integrationPermissionHook] },
          ],
        },
      },
    });

    // Poll for interrupt requests (similar to approval flow)
    const checkInterrupt = setInterval(async () => {
      try {
        const data = await readFile(INTERRUPT_REQUEST_FILE, "utf8");
        const request = JSON.parse(data);
        if (request.interrupt) {
          clearInterval(checkInterrupt);
          await unlink(INTERRUPT_REQUEST_FILE).catch(() => {});
          emitEvent({ type: "interrupting" });
          await q.interrupt();
        }
      } catch {
        // File doesn't exist yet, continue polling
      }
    }, 100);

    // Stream messages from the query
    for await (const message of q) {
      emitEvent(message as Record<string, unknown>);
    }

    clearInterval(checkInterrupt);
  } catch (error) {
    emitEvent({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    process.exit(1);
  }
}

main();

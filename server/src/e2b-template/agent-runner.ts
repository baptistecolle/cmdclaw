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

// Approval communication paths
const APPROVAL_REQUEST_FILE = "/tmp/approval-request.json";
const APPROVAL_RESPONSE_FILE = "/tmp/approval-response.json";

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
 * PreToolUse hook for integration permission control
 */
const integrationPermissionHook: HookCallback = async (input, toolUseId, { signal }) => {
  if (input.hook_event_name !== "PreToolUse") {
    return {};
  }

  const preInput = input as PreToolUseHookInput;
  const toolName = preInput.tool_name;
  const toolInput = preInput.tool_input as Record<string, unknown>;

  // Only process Bash commands that call our CLI tools
  if (toolName !== "Bash") {
    return {};
  }

  const command = (toolInput.command as string) || "";
  const parsed = parseBashCommand(command);

  // Not an integration command, allow it
  if (!parsed) {
    return {};
  }

  const { integration, operation } = parsed;

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
    // Run the agent with SDK
    for await (const message of query({
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
    })) {
      // Output all messages as JSON to stdout
      emitEvent(message as Record<string, unknown>);
    }
  } catch (error) {
    emitEvent({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    process.exit(1);
  }
}

main();

/**
 * Universal CLI Command Parser
 *
 * Parses CLI commands from various integrations to extract structured data
 * for display in approval previews.
 */

export type ParsedCommand = {
  integration: string;
  operation: string;
  args: Record<string, string | undefined>;
  positionalArgs: string[];
  rawCommand: string;
};

// CLI name to integration type mapping
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

/**
 * Parse a CLI command string into structured data
 */
export function parseCliCommand(command: string): ParsedCommand | null {
  const trimmed = command.trim();
  if (!trimmed) {return null;}

  // Tokenize the command, handling quoted strings
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {return null;}

  const cliName = tokens[0];
  const integration = CLI_TO_INTEGRATION[cliName];

  if (!integration) {return null;}

  // Extract operation (second token for most CLIs)
  let operation = tokens[1] || "";
  let argStartIndex = 2;

  // HubSpot has nested pattern: hubspot <resource> <action>
  if (integration === "hubspot" && tokens.length >= 3) {
    const resource = tokens[1];
    const action = tokens[2];
    // Special cases like "owners" or "pipelines"
    if (resource === "owners" || resource === "pipelines") {
      operation = `${resource}${action ? "." + action : ""}`;
    } else {
      operation = `${resource}.${action}`;
    }
    argStartIndex = 3;
  }

  // LinkedIn has nested pattern: linkedin <resource> <action>
  if (integration === "linkedin" && tokens.length >= 3) {
    const resource = tokens[1];
    const action = tokens[2];
    if (resource === "search") {
      operation = "search";
      argStartIndex = 2;
    } else {
      operation = `${resource}.${action}`;
      argStartIndex = 3;
    }
  }

  // Parse arguments
  const { args, positionalArgs } = parseArguments(tokens.slice(argStartIndex));

  return {
    integration,
    operation,
    args,
    positionalArgs,
    rawCommand: command,
  };
}

/**
 * Tokenize a command string, handling quoted strings
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === " " || char === "\t") {
      if (inQuote) {
        current += char;
      } else if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse argument tokens into named args and positional args
 */
function parseArguments(tokens: string[]): {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
} {
  const args: Record<string, string | undefined> = {};
  const positionalArgs: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith("--")) {
      // Long flag: --name value or --name=value
      const flagName = token.slice(2);
      if (flagName.includes("=")) {
        const [name, value] = flagName.split("=", 2);
        args[name] = value;
      } else {
        // Check if next token is the value (not another flag)
        const nextToken = tokens[i + 1];
        if (nextToken && !nextToken.startsWith("-")) {
          args[flagName] = nextToken;
          i++;
        } else {
          args[flagName] = "true"; // Boolean flag
        }
      }
    } else if (token.startsWith("-") && token.length === 2) {
      // Short flag: -n value
      const flagName = token.slice(1);
      const nextToken = tokens[i + 1];
      if (nextToken && !nextToken.startsWith("-")) {
        args[flagName] = nextToken;
        i++;
      } else {
        args[flagName] = "true"; // Boolean flag
      }
    } else {
      // Positional argument
      positionalArgs.push(token);
    }

    i++;
  }

  return { args, positionalArgs };
}

/**
 * Get a human-readable label for a flag
 */
export function getFlagLabel(flag: string): string {
  const labels: Record<string, string> = {
    // Common flags
    t: "Text",
    c: "Channel",
    q: "Query",
    l: "Limit",
    b: "Body",
    d: "Description",
    p: "Priority",
    r: "Repo/Record",
    o: "Owner",
    u: "User",
    e: "Emoji",
    // Long flags
    to: "To",
    cc: "Cc",
    bcc: "Bcc",
    subject: "Subject",
    body: "Body",
    text: "Text",
    thread: "Thread",
    summary: "Summary",
    start: "Start",
    end: "End",
    description: "Description",
    title: "Title",
    content: "Content",
    parent: "Parent",
    name: "Name",
    file: "File",
    folder: "Folder",
    output: "Output",
    team: "Team",
    state: "State",
    priority: "Priority",
    range: "Range",
    values: "Values",
    fields: "Fields",
    email: "Email",
    firstname: "First Name",
    lastname: "Last Name",
    company: "Company",
    phone: "Phone",
    domain: "Domain",
    industry: "Industry",
    pipeline: "Pipeline",
    stage: "Stage",
    amount: "Amount",
    due: "Due Date",
    ts: "Timestamp",
  };

  return labels[flag] || flag.charAt(0).toUpperCase() + flag.slice(1);
}

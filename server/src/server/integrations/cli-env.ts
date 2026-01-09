import { db } from "@/server/db/client";
import { integration, integrationToken } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";

type IntegrationType = "gmail" | "notion" | "linear" | "github" | "airtable" | "slack";

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  gmail: "GMAIL_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  linear: "LINEAR_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
};

export async function getCliEnvForUser(userId: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  const results = await db
    .select({
      type: integration.type,
      accessToken: integrationToken.accessToken,
    })
    .from(integration)
    .innerJoin(integrationToken, eq(integration.id, integrationToken.integrationId))
    .where(and(eq(integration.userId, userId), eq(integration.enabled, true)));

  for (const row of results) {
    const envVar = ENV_VAR_MAP[row.type];
    if (envVar) {
      env[envVar] = row.accessToken;
    }
  }

  return env;
}

export function getCliInstructions(enabledIntegrations: IntegrationType[]): string {
  const instructions: string[] = [];

  if (enabledIntegrations.includes("gmail")) {
    instructions.push(`
## Gmail CLI
- gmail list [-q query] [-l limit] - List emails
- gmail get <messageId> - Get full email content
- gmail unread - Count unread emails
- gmail send --to <email> --subject <subject> --body <body>
- Example: gmail list -q "is:unread" -l 5`);
  }

  if (enabledIntegrations.includes("notion")) {
    instructions.push(`
## Notion CLI
- notion search [-q query] [--type page|database] - Search pages/databases
- notion get <pageId> - Get page content
- notion create --parent <id> --title <title> [--content <text>]
- notion append <pageId> --content <text> - Append to page
- notion databases - List all databases
- notion query <databaseId> - Query database entries`);
  }

  if (enabledIntegrations.includes("linear")) {
    instructions.push(`
## Linear CLI
- linear list [-t team] [-s state] [-l limit] - List issues
- linear get <identifier> - Get issue (e.g., ENG-123)
- linear create --team <key> --title <title> [-d description] [-p priority]
- linear update <identifier> [--title] [--state] [--priority]
- linear teams - List teams
- linear mine - My assigned issues`);
  }

  if (enabledIntegrations.includes("github")) {
    instructions.push(`
## GitHub CLI
- github repos - List my repositories
- github prs -o <owner> -r <repo> - List pull requests
- github pr <number> -o <owner> -r <repo> - Get PR details
- github my-prs [-f created|assigned|review] - My pull requests
- github issues -o <owner> -r <repo> - List issues
- github create-issue -o <owner> -r <repo> -t <title> [-b body]
- github search -q <query> - Search code`);
  }

  if (enabledIntegrations.includes("airtable")) {
    instructions.push(`
## Airtable CLI
- airtable bases - List all bases
- airtable schema -b <baseId> - Get base schema
- airtable list -b <baseId> -t <table> - List records
- airtable get -b <baseId> -t <table> -r <recordId> - Get record
- airtable create -b <baseId> -t <table> --fields '{"Name":"value"}'
- airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- airtable delete -b <baseId> -t <table> -r <recordId>`);
  }

  if (enabledIntegrations.includes("slack")) {
    instructions.push(`
## Slack CLI
- slack channels - List channels
- slack history -c <channelId> - Get channel messages
- slack send -c <channelId> -t <text> [--thread <ts>] - Send message
- slack search -q <query> - Search messages
- slack users - List users
- slack user -u <userId> - Get user info
- slack thread -c <channelId> --thread <ts> - Get thread replies
- slack react -c <channelId> --ts <messageTs> -e <emoji>`);
  }

  if (instructions.length === 0) {
    return "";
  }

  return `
# Available Integration CLIs

You have access to CLI tools for the following integrations.
The authentication tokens are already configured in the environment.
Source code for each tool is available at /app/cli/<name>.ts

${instructions.join("\n")}
`;
}

export async function getEnabledIntegrationTypes(userId: string): Promise<IntegrationType[]> {
  const results = await db
    .select({ type: integration.type })
    .from(integration)
    .where(and(eq(integration.userId, userId), eq(integration.enabled, true)));

  return results.map((r) => r.type);
}

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

  const CLI = "/home/user/cli";

  if (enabledIntegrations.includes("gmail")) {
    instructions.push(`
## Gmail CLI (${CLI}/gmail)
- ${CLI}/gmail list [-q query] [-l limit] - List emails
- ${CLI}/gmail get <messageId> - Get full email content
- ${CLI}/gmail unread - Count unread emails
- ${CLI}/gmail send --to <email> --subject <subject> --body <body>
- Example: ${CLI}/gmail list -q "is:unread" -l 5`);
  }

  if (enabledIntegrations.includes("notion")) {
    instructions.push(`
## Notion CLI (${CLI}/notion)
- ${CLI}/notion search [-q query] [--type page|database] - Search pages/databases
- ${CLI}/notion get <pageId> - Get page content
- ${CLI}/notion create --parent <id> --title <title> [--content <text>]
- ${CLI}/notion append <pageId> --content <text> - Append to page
- ${CLI}/notion databases - List all databases
- ${CLI}/notion query <databaseId> - Query database entries`);
  }

  if (enabledIntegrations.includes("linear")) {
    instructions.push(`
## Linear CLI (${CLI}/linear)
- ${CLI}/linear list [-t team] [-s state] [-l limit] - List issues
- ${CLI}/linear get <identifier> - Get issue (e.g., ENG-123)
- ${CLI}/linear create --team <key> --title <title> [-d description] [-p priority]
- ${CLI}/linear update <identifier> [--title] [--state] [--priority]
- ${CLI}/linear teams - List teams
- ${CLI}/linear mine - My assigned issues`);
  }

  if (enabledIntegrations.includes("github")) {
    instructions.push(`
## GitHub CLI (${CLI}/github)
- ${CLI}/github repos - List my repositories
- ${CLI}/github prs -o <owner> -r <repo> - List pull requests
- ${CLI}/github pr <number> -o <owner> -r <repo> - Get PR details
- ${CLI}/github my-prs [-f created|assigned|review] - My pull requests
- ${CLI}/github issues -o <owner> -r <repo> - List issues
- ${CLI}/github create-issue -o <owner> -r <repo> -t <title> [-b body]
- ${CLI}/github search -q <query> - Search code`);
  }

  if (enabledIntegrations.includes("airtable")) {
    instructions.push(`
## Airtable CLI (${CLI}/airtable)
- ${CLI}/airtable bases - List all bases
- ${CLI}/airtable schema -b <baseId> - Get base schema
- ${CLI}/airtable list -b <baseId> -t <table> - List records
- ${CLI}/airtable get -b <baseId> -t <table> -r <recordId> - Get record
- ${CLI}/airtable create -b <baseId> -t <table> --fields '{"Name":"value"}'
- ${CLI}/airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- ${CLI}/airtable delete -b <baseId> -t <table> -r <recordId>`);
  }

  if (enabledIntegrations.includes("slack")) {
    instructions.push(`
## Slack CLI (${CLI}/slack)
- ${CLI}/slack channels - List channels
- ${CLI}/slack history -c <channelId> - Get channel messages
- ${CLI}/slack send -c <channelId> -t <text> [--thread <ts>] - Send message
- ${CLI}/slack search -q <query> - Search messages
- ${CLI}/slack users - List users
- ${CLI}/slack user -u <userId> - Get user info
- ${CLI}/slack thread -c <channelId> --thread <ts> - Get thread replies
- ${CLI}/slack react -c <channelId> --ts <messageTs> -e <emoji>`);
  }

  if (instructions.length === 0) {
    return "";
  }

  return `
# Available Integration CLIs

You have access to the following CLI tools located at /home/user/cli/.
The authentication tokens are already configured in the environment.

IMPORTANT: Run tools using their full path, e.g.: /home/user/cli/gmail list

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

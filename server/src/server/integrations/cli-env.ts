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
## Gmail CLI (bun run src/cli/gmail.ts)
- list [-q query] [-l limit] - List emails
- get <messageId> - Get full email content
- unread - Count unread emails
- send --to <email> --subject <subject> --body <body>
- Example: bun run src/cli/gmail.ts list -q "is:unread" -l 5`);
  }

  if (enabledIntegrations.includes("notion")) {
    instructions.push(`
## Notion CLI (bun run src/cli/notion.ts)
- search [-q query] [--type page|database] - Search pages/databases
- get <pageId> - Get page content
- create --parent <id> --title <title> [--content <text>]
- append <pageId> --content <text> - Append to page
- databases - List all databases
- query <databaseId> - Query database entries`);
  }

  if (enabledIntegrations.includes("linear")) {
    instructions.push(`
## Linear CLI (bun run src/cli/linear.ts)
- list [-t team] [-s state] [-l limit] - List issues
- get <identifier> - Get issue (e.g., ENG-123)
- create --team <key> --title <title> [-d description] [-p priority]
- update <identifier> [--title] [--state] [--priority]
- teams - List teams
- mine - My assigned issues`);
  }

  if (enabledIntegrations.includes("github")) {
    instructions.push(`
## GitHub CLI (bun run src/cli/github.ts)
- repos - List my repositories
- prs -o <owner> -r <repo> - List pull requests
- pr <number> -o <owner> -r <repo> - Get PR details
- my-prs [-f created|assigned|review] - My pull requests
- issues -o <owner> -r <repo> - List issues
- create-issue -o <owner> -r <repo> -t <title> [-b body]
- search -q <query> - Search code`);
  }

  if (enabledIntegrations.includes("airtable")) {
    instructions.push(`
## Airtable CLI (bun run src/cli/airtable.ts)
- bases - List all bases
- schema -b <baseId> - Get base schema
- list -b <baseId> -t <table> - List records
- get -b <baseId> -t <table> -r <recordId> - Get record
- create -b <baseId> -t <table> --fields '{"Name":"value"}'
- update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- delete -b <baseId> -t <table> -r <recordId>`);
  }

  if (enabledIntegrations.includes("slack")) {
    instructions.push(`
## Slack CLI (bun run src/cli/slack.ts)
- channels - List channels
- history -c <channelId> - Get channel messages
- send -c <channelId> -t <text> [--thread <ts>] - Send message
- search -q <query> - Search messages
- users - List users
- user -u <userId> - Get user info
- thread -c <channelId> --thread <ts> - Get thread replies
- react -c <channelId> --ts <messageTs> -e <emoji>`);
  }

  if (instructions.length === 0) {
    return "";
  }

  return `
# Available Integration CLIs

You have access to the following CLI tools to interact with the user's connected integrations.
Run them using \`bun run src/cli/<integration>.ts <command>\`.
The authentication tokens are already configured in the environment.

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

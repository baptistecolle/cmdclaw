import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getValidTokensForUser } from "./token-refresh";
import type { IntegrationType } from "@/server/oauth/config";

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  gmail: "GMAIL_ACCESS_TOKEN",
  google_calendar: "GOOGLE_CALENDAR_ACCESS_TOKEN",
  google_docs: "GOOGLE_DOCS_ACCESS_TOKEN",
  google_sheets: "GOOGLE_SHEETS_ACCESS_TOKEN",
  google_drive: "GOOGLE_DRIVE_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  linear: "LINEAR_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  hubspot: "HUBSPOT_ACCESS_TOKEN",
};

export async function getCliEnvForUser(userId: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // Get valid tokens, refreshing any that are expired or about to expire
  // This already filters by enabled integrations
  const tokens = await getValidTokensForUser(userId);

  for (const [type, accessToken] of tokens) {
    const envVar = ENV_VAR_MAP[type];
    if (envVar) {
      env[envVar] = accessToken;
    }
  }

  return env;
}

export function getCliInstructions(enabledIntegrations: IntegrationType[]): string {
  const instructions: string[] = [];

  if (enabledIntegrations.includes("gmail")) {
    instructions.push(`
## Google Gmail CLI
- google-gmail list [-q query] [-l limit] - List emails
- google-gmail get <messageId> - Get full email content
- google-gmail unread - Count unread emails
- google-gmail send --to <email> --subject <subject> --body <body>
- Example: google-gmail list -q "is:unread" -l 5`);
  }

  if (enabledIntegrations.includes("google_calendar")) {
    instructions.push(`
## Google Calendar CLI
- gcalendar list [-t timeMin] [-m timeMax] [-l limit] - List events
- gcalendar get <eventId> - Get event details
- gcalendar create --summary <title> --start <datetime> --end <datetime> [--description <text>]
- gcalendar delete <eventId> - Delete an event
- gcalendar calendars - List available calendars
- Example: gcalendar list -l 10`);
  }

  if (enabledIntegrations.includes("google_docs")) {
    instructions.push(`
## Google Docs CLI
- gdocs get <documentId> - Get document content
- gdocs create --title <title> [--content <text>] - Create a document
- gdocs append <documentId> --text <text> - Append text to document
- gdocs list - List recent documents
- Example: gdocs get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`);
  }

  if (enabledIntegrations.includes("google_sheets")) {
    instructions.push(`
## Google Sheets CLI
- gsheets get <spreadsheetId> [--range <A1:B10>] - Get spreadsheet data
- gsheets create --title <title> - Create a spreadsheet
- gsheets append <spreadsheetId> --range <A:B> --values '[[...]]' - Append rows
- gsheets update <spreadsheetId> --range <A1:B2> --values '[[...]]' - Update cells
- gsheets list - List recent spreadsheets
- Example: gsheets get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms --range Sheet1!A1:D10`);
  }

  if (enabledIntegrations.includes("google_drive")) {
    instructions.push(`
## Google Drive CLI
- gdrive list [-q query] [-l limit] - List files
- gdrive get <fileId> - Get file metadata
- gdrive download <fileId> [--output <path>] - Download file
- gdrive search -q <query> - Search files
- gdrive upload --file <path> [--name <name>] [--folder <folderId>] - Upload file
- Example: gdrive list -l 20`);
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

  if (enabledIntegrations.includes("hubspot")) {
    instructions.push(`
## HubSpot CLI
- hubspot contacts list [-l limit] [-q query] - List contacts
- hubspot contacts get <id> - Get contact details
- hubspot contacts create --email <email> [--firstname] [--lastname] [--company] [--phone]
- hubspot contacts update <id> --properties '{"firstname":"John"}'
- hubspot contacts search -q <query> - Search contacts
- hubspot companies list [-l limit] - List companies
- hubspot companies get <id> - Get company details
- hubspot companies create --name <name> [--domain] [--industry]
- hubspot deals list [-l limit] - List deals
- hubspot deals get <id> - Get deal details
- hubspot deals create --name <name> --pipeline <id> --stage <id> [--amount]
- hubspot tickets list [-l limit] - List tickets
- hubspot tickets get <id> - Get ticket details
- hubspot tickets create --subject <subject> --pipeline <id> --stage <id>
- hubspot tasks list [-l limit] - List tasks
- hubspot tasks create --subject <subject> [--body] [--due]
- hubspot notes create --body <text> [--contact <id>] [--company <id>] [--deal <id>]
- hubspot pipelines deals - List deal pipelines and stages
- hubspot pipelines tickets - List ticket pipelines and stages
- hubspot owners - List owners (sales reps)`);
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

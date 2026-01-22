import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getValidTokensForUser } from "./token-refresh";
import type { IntegrationType } from "@/server/oauth/config";
import { env } from "@/env";

// Token-based integrations map to their access token env var
const ENV_VAR_MAP: Record<Exclude<IntegrationType, "linkedin">, string> = {
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
  const cliEnv: Record<string, string> = {};

  // Get valid tokens, refreshing any that are expired or about to expire
  // This already filters by enabled integrations
  const tokens = await getValidTokensForUser(userId);

  for (const [type, accessToken] of tokens) {
    const envVar = ENV_VAR_MAP[type as Exclude<IntegrationType, "linkedin">];
    if (envVar) {
      cliEnv[envVar] = accessToken;
    }
  }

  // LinkedIn special case - uses Unipile account_id instead of OAuth tokens
  const linkedinIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "linkedin"),
      eq(integration.enabled, true)
    ),
  });

  if (linkedinIntegration && linkedinIntegration.providerAccountId) {
    cliEnv.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
    if (env.UNIPILE_API_KEY) cliEnv.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
    if (env.UNIPILE_DSN) cliEnv.UNIPILE_DSN = env.UNIPILE_DSN;
  }

  return cliEnv;
}

export function getCliInstructions(connectedIntegrations: IntegrationType[]): string {
  // Helper to show connection status
  const statusTag = (type: IntegrationType) =>
    connectedIntegrations.includes(type) ? "✓ Connected" : "⚡ Auth Required";

  // Always include ALL integration instructions - auth will be requested on use if needed
  const instructions = `
## Google Gmail CLI [${statusTag("gmail")}]
- google-gmail list [-q query] [-l limit] - List emails
- google-gmail get <messageId> - Get full email content
- google-gmail unread - Count unread emails
- google-gmail send --to <email> --subject <subject> --body <body>
- Example: google-gmail list -q "is:unread" -l 5

## Google Calendar CLI [${statusTag("google_calendar")}]
- gcalendar list [-t timeMin] [-m timeMax] [-l limit] - List events
- gcalendar get <eventId> - Get event details
- gcalendar create --summary <title> --start <datetime> --end <datetime> [--description <text>]
- gcalendar delete <eventId> - Delete an event
- gcalendar calendars - List available calendars
- Example: gcalendar list -l 10

## Google Docs CLI [${statusTag("google_docs")}]
- gdocs get <documentId> - Get document content
- gdocs create --title <title> [--content <text>] - Create a document
- gdocs append <documentId> --text <text> - Append text to document
- gdocs list - List recent documents
- Example: gdocs get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

## Google Sheets CLI [${statusTag("google_sheets")}]
- gsheets get <spreadsheetId> [--range <A1:B10>] - Get spreadsheet data
- gsheets create --title <title> - Create a spreadsheet
- gsheets append <spreadsheetId> --range <A:B> --values '[[...]]' - Append rows
- gsheets update <spreadsheetId> --range <A1:B2> --values '[[...]]' - Update cells
- gsheets list - List recent spreadsheets
- Example: gsheets get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms --range Sheet1!A1:D10

## Google Drive CLI [${statusTag("google_drive")}]
- gdrive list [-q query] [-l limit] - List files
- gdrive get <fileId> - Get file metadata
- gdrive download <fileId> [--output <path>] - Download file
- gdrive search -q <query> - Search files
- gdrive upload --file <path> [--name <name>] [--folder <folderId>] - Upload file
- Example: gdrive list -l 20

## Notion CLI [${statusTag("notion")}]
- notion search [-q query] [--type page|database] - Search pages/databases
- notion get <pageId> - Get page content
- notion create --parent <id> --title <title> [--content <text>]
- notion append <pageId> --content <text> - Append to page
- notion databases - List all databases
- notion query <databaseId> - Query database entries

## Linear CLI [${statusTag("linear")}]
- linear list [-t team] [-s state] [-l limit] - List issues
- linear get <identifier> - Get issue (e.g., ENG-123)
- linear create --team <key> --title <title> [-d description] [-p priority]
- linear update <identifier> [--title] [--state] [--priority]
- linear teams - List teams
- linear mine - My assigned issues

## GitHub CLI [${statusTag("github")}]
- github repos - List my repositories
- github prs -o <owner> -r <repo> - List pull requests
- github pr <number> -o <owner> -r <repo> - Get PR details
- github my-prs [-f created|assigned|review] - My pull requests
- github issues -o <owner> -r <repo> - List issues
- github create-issue -o <owner> -r <repo> -t <title> [-b body]
- github search -q <query> - Search code

## Airtable CLI [${statusTag("airtable")}]
- airtable bases - List all bases
- airtable schema -b <baseId> - Get base schema
- airtable list -b <baseId> -t <table> - List records
- airtable get -b <baseId> -t <table> -r <recordId> - Get record
- airtable create -b <baseId> -t <table> --fields '{"Name":"value"}'
- airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- airtable delete -b <baseId> -t <table> -r <recordId>

## Slack CLI [${statusTag("slack")}]
- slack channels - List channels
- slack history -c <channelId> - Get channel messages
- slack send -c <channelId> -t <text> [--thread <ts>] - Send message
- slack search -q <query> - Search messages
- slack users - List users
- slack user -u <userId> - Get user info
- slack thread -c <channelId> --thread <ts> - Get thread replies
- slack react -c <channelId> --ts <messageTs> -e <emoji>

## HubSpot CLI [${statusTag("hubspot")}]
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
- hubspot owners - List owners (sales reps)

## LinkedIn CLI (via Unipile) [${statusTag("linkedin")}]
MESSAGING
- linkedin chats list [-l limit]                    List conversations
- linkedin chats get <chatId>                       Get conversation details
- linkedin messages list <chatId> [-l limit]        List messages in chat
- linkedin messages send <chatId> --text <message>  Send message
- linkedin messages start <profileId> --text <msg>  Start new conversation

PROFILES
- linkedin profile me                               Get my profile
- linkedin profile get <identifier>                 Get user profile (URL or ID)
- linkedin profile company <identifier>             Get company profile
- linkedin search -q <query> [-l limit]             Search for people

INVITATIONS & CONNECTIONS
- linkedin invite send <profileId> [--message <m>]  Send connection request
- linkedin invite list                              List pending invitations
- linkedin connections list [-l limit]              List my connections
- linkedin connections remove <profileId>           Remove connection

POSTS & CONTENT
- linkedin posts list [--profile <id>] [-l limit]   List posts
- linkedin posts get <postId>                       Get post details
- linkedin posts create --text <content>            Create a post
- linkedin posts comment <postId> --text <comment>  Comment on post
- linkedin posts react <postId> --type <LIKE|...>   React to post

COMPANY PAGES
- linkedin company posts <companyId> [-l limit]     List company posts
- linkedin company post <companyId> --text <text>   Post as company (if admin)
`;

  return `
# Available Integration CLIs

You have access to CLI tools for the following integrations.
For integrations marked [⚡ Auth Required], authentication will be requested when you try to use them.
Source code for each tool is available at /app/cli/<name>.ts

${instructions}
`;
}

export async function getEnabledIntegrationTypes(userId: string): Promise<IntegrationType[]> {
  const results = await db
    .select({ type: integration.type })
    .from(integration)
    .where(and(eq(integration.userId, userId), eq(integration.enabled, true)));

  return results.map((r) => r.type);
}

/**
 * Get tokens for specific integrations (used for mid-conversation auth)
 * Returns a map of environment variable name -> access token
 */
export async function getTokensForIntegrations(
  userId: string,
  integrationTypes: string[]
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};

  // Get valid tokens for these integrations
  const allTokens = await getValidTokensForUser(userId);

  for (const [type, accessToken] of allTokens) {
    if (integrationTypes.includes(type)) {
      const envVar = ENV_VAR_MAP[type as Exclude<IntegrationType, "linkedin">];
      if (envVar) {
        tokens[envVar] = accessToken;
      }
    }
  }

  // LinkedIn special case
  if (integrationTypes.includes("linkedin")) {
    const linkedinIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, userId),
        eq(integration.type, "linkedin"),
        eq(integration.enabled, true)
      ),
    });

    if (linkedinIntegration && linkedinIntegration.providerAccountId) {
      tokens.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
      if (env.UNIPILE_API_KEY) tokens.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
      if (env.UNIPILE_DSN) tokens.UNIPILE_DSN = env.UNIPILE_DSN;
    }
  }

  return tokens;
}

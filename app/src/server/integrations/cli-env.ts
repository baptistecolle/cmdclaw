import { eq, and } from "drizzle-orm";
import type { IntegrationType } from "@/server/oauth/config";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { integration, customIntegrationCredential } from "@/server/db/schema";
import { decrypt } from "@/server/lib/encryption";
import { getValidTokensForUser, getValidCustomTokens } from "./token-refresh";

// Token-based integrations map to their access token env var
const ENV_VAR_MAP: Record<Exclude<IntegrationType, "linkedin">, string> = {
  gmail: "GMAIL_ACCESS_TOKEN",
  outlook: "OUTLOOK_ACCESS_TOKEN",
  outlook_calendar: "OUTLOOK_CALENDAR_ACCESS_TOKEN",
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
  salesforce: "SALESFORCE_ACCESS_TOKEN",
  reddit: "REDDIT_ACCESS_TOKEN",
  twitter: "TWITTER_ACCESS_TOKEN",
};

export async function getCliEnvForUser(userId: string): Promise<Record<string, string>> {
  const cliEnv: Record<string, string> = {};
  const appUrl = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;

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
      eq(integration.enabled, true),
    ),
  });

  if (linkedinIntegration && linkedinIntegration.providerAccountId) {
    cliEnv.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
    if (env.UNIPILE_API_KEY) {
      cliEnv.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
    }
    if (env.UNIPILE_DSN) {
      cliEnv.UNIPILE_DSN = env.UNIPILE_DSN;
    }
  }

  // Salesforce special case - needs instance URL from metadata
  const salesforceIntegration = await db.query.integration.findFirst({
    where: and(
      eq(integration.userId, userId),
      eq(integration.type, "salesforce"),
      eq(integration.enabled, true),
    ),
  });

  if (salesforceIntegration && salesforceIntegration.metadata) {
    const metadata = salesforceIntegration.metadata as Record<string, unknown>;
    if (metadata.instanceUrl) {
      cliEnv.SALESFORCE_INSTANCE_URL = metadata.instanceUrl as string;
    }
  }

  // Discord bot token - server-level, not per-user OAuth
  if (env.DISCORD_BOT_TOKEN) {
    cliEnv.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  }

  // Slack bot relay config (keeps SLACK_BOT_TOKEN server-side only)
  const slackRelaySecret = env.SLACK_BOT_RELAY_SECRET ?? env.CMDCLAW_SERVER_SECRET;
  if (slackRelaySecret) {
    cliEnv.SLACK_BOT_RELAY_SECRET = slackRelaySecret;
  }
  if (appUrl) {
    const relayBaseUrl =
      new URL(appUrl).hostname === "localhost" && process.env.NODE_ENV !== "production"
        ? "https://localcan.baptistecolle.com"
        : appUrl;
    cliEnv.SLACK_BOT_RELAY_URL = `${relayBaseUrl}/api/internal/slack/post-as-bot`;
  }

  // Custom integrations
  try {
    const customCreds = await db.query.customIntegrationCredential.findMany({
      where: and(
        eq(customIntegrationCredential.userId, userId),
        eq(customIntegrationCredential.enabled, true),
      ),
      with: {
        customIntegration: true,
      },
    });

    // Refresh OAuth tokens for custom integrations
    const refreshedTokens = await getValidCustomTokens(userId);

    for (const cred of customCreds) {
      const slug = cred.customIntegration.slug.toUpperCase().replace(/-/g, "_");
      const integ = cred.customIntegration;

      // Set base URL
      cliEnv[`${slug}_BASE_URL`] = integ.baseUrl;

      if (integ.authType === "api_key" && cred.apiKey) {
        try {
          cliEnv[`${slug}_API_KEY`] = decrypt(cred.apiKey);
          if (integ.apiKeyConfig) {
            cliEnv[`${slug}_API_KEY_METHOD`] = integ.apiKeyConfig.method;
            if (integ.apiKeyConfig.headerName) {
              cliEnv[`${slug}_API_KEY_HEADER`] = integ.apiKeyConfig.headerName;
            }
            if (integ.apiKeyConfig.queryParam) {
              cliEnv[`${slug}_API_KEY_PARAM`] = integ.apiKeyConfig.queryParam;
            }
          }
        } catch (e) {
          console.error(`Failed to decrypt API key for custom integration ${integ.slug}:`, e);
        }
      } else if (integ.authType === "bearer_token" && cred.apiKey) {
        try {
          cliEnv[`${slug}_ACCESS_TOKEN`] = decrypt(cred.apiKey);
        } catch (e) {
          console.error(`Failed to decrypt bearer token for custom integration ${integ.slug}:`, e);
        }
      } else if (integ.authType === "oauth2") {
        // Use refreshed token if available, otherwise use stored token
        const refreshedToken = refreshedTokens.get(cred.id);
        if (refreshedToken) {
          cliEnv[`${slug}_ACCESS_TOKEN`] = refreshedToken;
        } else if (cred.accessToken) {
          cliEnv[`${slug}_ACCESS_TOKEN`] = cred.accessToken;
        }
      }
    }
  } catch (e) {
    console.error("Failed to load custom integration credentials:", e);
  }

  return cliEnv;
}

export async function getCliInstructionsWithCustom(
  connectedIntegrations: IntegrationType[],
  userId: string,
): Promise<string> {
  const base = getCliInstructions(connectedIntegrations);

  try {
    const customCreds = await db.query.customIntegrationCredential.findMany({
      where: and(
        eq(customIntegrationCredential.userId, userId),
        eq(customIntegrationCredential.enabled, true),
      ),
      with: {
        customIntegration: true,
      },
    });

    if (customCreds.length === 0) {
      return base;
    }

    const customSections = customCreds.map((cred) => {
      const integ = cred.customIntegration;
      return `\n## ${integ.name} CLI (Custom) [✓ Connected]\n${integ.cliInstructions}\n`;
    });

    return base + "\n" + customSections.join("\n");
  } catch {
    return base;
  }
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

## Outlook Mail CLI [${statusTag("outlook")}]
- outlook-mail list [-q query] [-l limit] - List emails
- outlook-mail get <messageId> - Get full email content
- outlook-mail unread - Count unread emails
- outlook-mail send --to <email> --subject <subject> --body <body>
- Example: outlook-mail list -q "is:unread" -l 5

## Outlook Calendar CLI [${statusTag("outlook_calendar")}]
- outlook-calendar list [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - List events
- outlook-calendar get <eventId> [-c calendarId] - Get event details
- outlook-calendar create --summary <title> --start <datetime> --end <datetime> [--description <text>] [--location <text>]
- outlook-calendar update <eventId> [--summary <title>] [--start <datetime>] [--end <datetime>] [--description <text>] [--location <text>]
- outlook-calendar delete <eventId> [-c calendarId] - Delete an event
- outlook-calendar calendars - List available calendars
- outlook-calendar today [-c calendarId] - List today's events
- Example: outlook-calendar list -l 10

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
- slack send -c <channelId> -t <text> --as <user|bot> [--thread <ts>] - Send message (explicit actor required)
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

## Salesforce CLI [${statusTag("salesforce")}]

Query and manage Salesforce CRM records.

### Commands

**Query records (SOQL):**
\`\`\`bash
salesforce query "SELECT Id, Name, Email FROM Contact WHERE AccountId = '001xxx'"
salesforce query "SELECT Id, Name, Amount, StageName FROM Opportunity WHERE Amount > 50000"
salesforce query "SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10"
\`\`\`

**Get single record:**
\`\`\`bash
salesforce get Account 001xxxxxxxxxxxx
salesforce get Contact 003xxxxxxxxxxxx Name,Email,Phone
\`\`\`

**Create record:**
\`\`\`bash
salesforce create Contact '{"FirstName": "John", "LastName": "Doe", "Email": "john@example.com", "AccountId": "001xxx"}'
salesforce create Task '{"Subject": "Follow up", "WhoId": "003xxx", "ActivityDate": "2025-02-01"}'
salesforce create Opportunity '{"Name": "New Deal", "StageName": "Prospecting", "CloseDate": "2025-03-01", "Amount": 10000}'
\`\`\`

**Update record:**
\`\`\`bash
salesforce update Opportunity 006xxxxxxxxxxxx '{"StageName": "Negotiation", "Amount": 15000}'
salesforce update Contact 003xxxxxxxxxxxx '{"Phone": "555-1234"}'
\`\`\`

**Describe object (get fields):**
\`\`\`bash
salesforce describe Account
salesforce describe Opportunity
salesforce describe CustomObject__c
\`\`\`

**List all objects:**
\`\`\`bash
salesforce objects
\`\`\`

**Search across objects (SOSL):**
\`\`\`bash
salesforce search "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)"
\`\`\`

### Common Objects
- **Account** - Companies/organizations
- **Contact** - People at companies
- **Lead** - Potential customers
- **Opportunity** - Sales deals
- **Task** - To-do items
- **Case** - Support tickets

### SOQL Tips
- Use \`LIMIT\` to restrict results
- Date literals: \`TODAY\`, \`THIS_MONTH\`, \`LAST_N_DAYS:30\`
- Custom objects end with \`__c\` (e.g., \`Invoice__c\`)
- Custom fields end with \`__c\` (e.g., \`Custom_Field__c\`)

## Reddit CLI [${statusTag("reddit")}]

Browse, vote, comment, and post on Reddit.

### Reading
- reddit feed [-l limit] [-s hot|new|top|rising] - Get home feed
- reddit subreddit <name> [-l limit] [-s hot|new|top|rising] - Get subreddit posts
- reddit post <id> [-l limit] - Get post with comments
- reddit user <username> - Get user profile and recent activity
- reddit search -q <query> [-l limit] [-t all|year|month|week|day|hour] - Search Reddit
- reddit multireddit <user> <name> - Get multireddit posts

### Engagement
- reddit vote <id> -d up|down|none - Vote on post/comment (t1_xxx for comment, t3_xxx for post)
- reddit comment <postId> --text <text> - Add comment to post
- reddit reply <commentId> --text <text> - Reply to comment
- reddit save <id> - Save post/comment
- reddit unsave <id> - Unsave post/comment

### Creating Content
- reddit submit <subreddit> --title <title> [--text <body>] [--url <link>] - Submit post
- reddit delete <id> - Delete own post/comment
- reddit edit <id> --text <newText> - Edit own post/comment

### Messaging
- reddit inbox [-l limit] - List messages
- reddit message <username> -s <subject> --text <body> - Send private message
- reddit read <id> - Mark message as read

### Subscriptions
- reddit subscriptions [-l limit] - List subscribed subreddits
- reddit subscribe <subreddit> - Subscribe to subreddit
- reddit unsubscribe <subreddit> - Unsubscribe from subreddit

### Thing ID Prefixes
- t1_ = comment
- t3_ = post/link
- t4_ = message
- t5_ = subreddit

## Discord CLI (Bot Token)

Interact with Discord guilds, channels, and messages via bot token.

### Commands
- discord guilds - List guilds the bot is in
- discord channels <guildId> - List channels in a guild
- discord messages <channelId> [-l limit] - Get messages from a channel
- discord send <channelId> --text <message> - Send a message to a channel

## X (Twitter) CLI [${statusTag("twitter")}]

Post tweets, manage followers, and interact with content on X (Twitter).

### User Profile
- twitter me - Get your profile
- twitter user <username> - Get user by username
- twitter user-id <id> - Get user by ID

### Reading
- twitter timeline [-l limit] - Get your home timeline
- twitter mentions [-l limit] - Get your mentions
- twitter search -q <query> [-l limit] - Search tweets
- twitter likes [-l limit] - Get your liked tweets
- twitter followers [-l limit] - List your followers
- twitter following [-l limit] - List accounts you follow

### Posting
- twitter post -t <text> - Post a tweet
- twitter reply <tweetId> -t <text> - Reply to a tweet
- twitter quote <tweetId> -t <text> - Quote tweet

### Engagement
- twitter like <tweetId> - Like a tweet
- twitter unlike <tweetId> - Unlike a tweet
- twitter retweet <tweetId> - Retweet
- twitter unretweet <tweetId> - Remove retweet

### Following
- twitter follow <userId> - Follow a user
- twitter unfollow <userId> - Unfollow a user
`;

  return `
# Available Integration CLIs

You have access to CLI tools for the following integrations.
For integrations marked [⚡ Auth Required], authentication will be requested automatically when you try to use them — the user will be prompted to connect the service. IMPORTANT: You MUST still attempt to use the CLI tool even if the integration is marked as [⚡ Auth Required]. Never refuse or tell the user to connect a service manually. Just proceed with the bash command and the system will handle the authentication flow automatically.
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
  integrationTypes: string[],
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  const requestedTokenIntegrations = integrationTypes.filter(
    (type): type is Exclude<IntegrationType, "linkedin"> => type in ENV_VAR_MAP,
  );

  // Get valid tokens only for requested token-based integrations
  const allTokens = await getValidTokensForUser(userId, requestedTokenIntegrations);

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
        eq(integration.enabled, true),
      ),
    });

    if (linkedinIntegration && linkedinIntegration.providerAccountId) {
      tokens.LINKEDIN_ACCOUNT_ID = linkedinIntegration.providerAccountId;
      if (env.UNIPILE_API_KEY) {
        tokens.UNIPILE_API_KEY = env.UNIPILE_API_KEY;
      }
      if (env.UNIPILE_DSN) {
        tokens.UNIPILE_DSN = env.UNIPILE_DSN;
      }
    }
  }

  // Salesforce special case - needs instance URL from metadata
  if (integrationTypes.includes("salesforce")) {
    const salesforceIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, userId),
        eq(integration.type, "salesforce"),
        eq(integration.enabled, true),
      ),
    });

    if (salesforceIntegration && salesforceIntegration.metadata) {
      const metadata = salesforceIntegration.metadata as Record<string, unknown>;
      if (metadata.instanceUrl) {
        tokens.SALESFORCE_INSTANCE_URL = metadata.instanceUrl as string;
      }
    }
  }

  return tokens;
}

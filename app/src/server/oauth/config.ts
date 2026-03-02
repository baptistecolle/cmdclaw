import { env } from "@/env";

export type IntegrationType =
  | "gmail"
  | "outlook"
  | "outlook_calendar"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "linear"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "dynamics"
  | "reddit"
  | "twitter";

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
  getUserInfo: (accessToken: string) => Promise<{
    id: string;
    displayName: string;
    metadata?: Record<string, unknown>;
  }>;
};

type JwtClaims = {
  sub?: unknown;
  oid?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  upn?: unknown;
  email?: unknown;
};

function parseJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as JwtClaims;
    return claims;
  } catch {
    return null;
  }
}

const getAppUrl = () => env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const configs: Record<IntegrationType, () => OAuthConfig> = {
  gmail: () => ({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "profile",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email };
    },
  }),

  outlook: () => ({
    clientId: env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["offline_access", "openid", "profile", "email", "User.Read", "Mail.Read", "Mail.Send"],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        id: data.id,
        displayName: data.mail ?? data.userPrincipalName ?? data.displayName ?? "Outlook User",
      };
    },
  }),

  outlook_calendar: () => ({
    clientId: env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "offline_access",
      "openid",
      "profile",
      "email",
      "User.Read",
      "Calendars.Read",
      "Calendars.ReadWrite",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        id: data.id,
        displayName:
          data.mail ?? data.userPrincipalName ?? data.displayName ?? "Outlook Calendar User",
      };
    },
  }),

  google_calendar: () => ({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["https://www.googleapis.com/auth/calendar", "openid", "email", "profile"],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email };
    },
  }),

  google_docs: () => ({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly",
      "openid",
      "email",
      "profile",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email };
    },
  }),

  google_sheets: () => ({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
      "openid",
      "email",
      "profile",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email };
    },
  }),

  google_drive: () => ({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "openid",
      "email",
      "profile",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email };
    },
  }),

  notion: () => ({
    clientId: env.NOTION_CLIENT_ID ?? "",
    clientSecret: env.NOTION_CLIENT_SECRET ?? "",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [], // Notion uses fixed scopes
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      const data = await res.json();
      return {
        id: data.bot?.owner?.user?.id ?? data.id,
        displayName: data.bot?.owner?.user?.name ?? data.name ?? "Notion User",
        metadata: { workspaceName: data.bot?.workspace_name },
      };
    },
  }),

  linear: () => ({
    clientId: env.LINEAR_CLIENT_ID ?? "",
    clientSecret: env.LINEAR_CLIENT_SECRET ?? "",
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["read", "write", "issues:create"],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { id name email } }" }),
      });
      const data = await res.json();
      return {
        id: data.data?.viewer?.id ?? "",
        displayName: data.data?.viewer?.name ?? data.data?.viewer?.email ?? "",
      };
    },
  }),

  github: () => ({
    clientId: env.GITHUB_CLIENT_ID ?? "",
    clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["repo", "read:user", "user:email"],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      const data = await res.json();
      return { id: String(data.id), displayName: data.login };
    },
  }),

  airtable: () => ({
    clientId: env.AIRTABLE_CLIENT_ID ?? "",
    clientSecret: env.AIRTABLE_CLIENT_SECRET ?? "",
    authUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["data.records:read", "data.records:write", "schema.bases:read", "user.email:read"],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://api.airtable.com/v0/meta/whoami", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return { id: data.id, displayName: data.email ?? data.id };
    },
  }),

  slack: () => ({
    clientId: env.SLACK_CLIENT_ID ?? "",
    clientSecret: env.SLACK_CLIENT_SECRET ?? "",
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    redirectUri: `${getAppUrl().replace("http://localhost", "https://localhost")}/api/oauth/callback`,
    scopes: [
      "channels:read",
      "channels:history",
      "chat:write",
      "users:read",
      "users:read.email",
      "im:read",
      "im:history",
      "groups:read",
      "groups:history",
      "mpim:read",
      "mpim:history",
      "search:read",
    ],
    getUserInfo: async (accessToken) => {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        id: data.user_id,
        displayName: data.user ?? data.team ?? "Slack User",
        metadata: { teamId: data.team_id, teamName: data.team },
      };
    },
  }),

  hubspot: () => ({
    clientId: env.HUBSPOT_CLIENT_ID ?? "",
    clientSecret: env.HUBSPOT_CLIENT_SECRET ?? "",
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.companies.read",
      "crm.objects.companies.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
      "tickets",
      "crm.objects.owners.read",
    ],
    getUserInfo: async (accessToken) => {
      // Get token info which includes the user email
      const tokenRes = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`);
      const tokenData = await tokenRes.json();

      return {
        id: String(tokenData.hub_id),
        displayName: tokenData.user ?? tokenData.hub_domain ?? String(tokenData.hub_id),
        metadata: {
          portalId: tokenData.hub_id,
          userId: tokenData.user_id,
          hubDomain: tokenData.hub_domain,
        },
      };
    },
  }),

  // LinkedIn uses Unipile hosted auth, not standard OAuth
  // This config is a placeholder - actual auth is handled via generateLinkedInAuthUrl
  linkedin: () => ({
    clientId: "",
    clientSecret: "",
    authUrl: "",
    tokenUrl: "",
    redirectUri: `${getAppUrl()}/api/integrations/linkedin/callback`,
    scopes: [],
    getUserInfo: async () => {
      throw new Error("LinkedIn uses Unipile auth, not standard OAuth");
    },
  }),

  salesforce: () => ({
    clientId: env.SALESFORCE_CLIENT_ID ?? "",
    clientSecret: env.SALESFORCE_CLIENT_SECRET ?? "",
    authUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: ["api", "refresh_token", "openid"],
    getUserInfo: async (accessToken: string) => {
      const res = await fetch("https://login.salesforce.com/services/oauth2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        id: data.user_id,
        displayName: data.name || data.email,
        metadata: {
          organizationId: data.organization_id,
          email: data.email,
        },
      };
    },
  }),

  dynamics: () => ({
    clientId: env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "offline_access",
      "openid",
      "profile",
      "email",
      "https://globaldisco.crm.dynamics.com/user_impersonation",
    ],
    getUserInfo: async (accessToken: string) => {
      const claims = parseJwtClaims(accessToken);
      const providerId =
        typeof claims?.oid === "string"
          ? claims.oid
          : typeof claims?.sub === "string"
            ? claims.sub
            : "dynamics-user";
      const displayName =
        typeof claims?.preferred_username === "string"
          ? claims.preferred_username
          : typeof claims?.email === "string"
            ? claims.email
            : typeof claims?.upn === "string"
              ? claims.upn
              : typeof claims?.name === "string"
                ? claims.name
                : "Microsoft Dynamics User";
      return {
        id: providerId,
        displayName,
        metadata: {
          userPrincipalName:
            typeof claims?.preferred_username === "string"
              ? claims.preferred_username
              : typeof claims?.upn === "string"
                ? claims.upn
                : undefined,
          email:
            typeof claims?.email === "string"
              ? claims.email
              : typeof claims?.preferred_username === "string"
                ? claims.preferred_username
                : undefined,
        },
      };
    },
  }),

  reddit: () => ({
    clientId: env.REDDIT_CLIENT_ID ?? "",
    clientSecret: env.REDDIT_CLIENT_SECRET ?? "",
    authUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "identity",
      "read",
      "submit",
      "vote",
      "save",
      "subscribe",
      "privatemessages",
      "history",
      "mysubreddits",
    ],
    getUserInfo: async (accessToken: string) => {
      const res = await fetch("https://oauth.reddit.com/api/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "cmdclaw-app:v1.0.0 (by /u/cmdclaw-integration)",
        },
      });
      const data = await res.json();
      return {
        id: data.id,
        displayName: data.name,
        metadata: {
          username: data.name,
          iconImg: data.icon_img,
        },
      };
    },
  }),

  twitter: () => ({
    clientId: env.TWITTER_CLIENT_ID ?? "",
    clientSecret: env.TWITTER_CLIENT_SECRET ?? "",
    authUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "tweet.read",
      "tweet.write",
      "users.read",
      "dm.read",
      "like.read",
      "like.write",
      "follows.read",
      "follows.write",
      "offline.access",
    ],
    getUserInfo: async (accessToken: string) => {
      const res = await fetch(
        "https://api.twitter.com/2/users/me?user.fields=profile_image_url,username",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const data = await res.json();
      return {
        id: data.data?.id,
        displayName: data.data?.username ?? data.data?.name ?? "Twitter User",
        metadata: {
          username: data.data?.username,
          name: data.data?.name,
          profileImageUrl: data.data?.profile_image_url,
        },
      };
    },
  }),
};

export function getOAuthConfig(type: IntegrationType): OAuthConfig {
  const configFn = configs[type];
  if (!configFn) {
    throw new Error(`Unknown integration type: ${type}`);
  }
  return configFn();
}

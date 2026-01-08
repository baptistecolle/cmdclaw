import { env } from "@/env";

export type IntegrationType = "gmail" | "notion" | "linear" | "github" | "airtable" | "slack";

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

const getAppUrl = () => env.APP_URL ?? "http://localhost:3000";

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
      "https://www.googleapis.com/auth/gmail.modify",
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
    scopes: ["data.records:read", "data.records:write", "schema.bases:read"],
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
    redirectUri: `${getAppUrl()}/api/oauth/callback`,
    scopes: [
      "channels:read",
      "channels:history",
      "chat:write",
      "users:read",
      "users:read.email",
      "im:read",
      "im:history",
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
};

export function getOAuthConfig(type: IntegrationType): OAuthConfig {
  const configFn = configs[type];
  if (!configFn) {
    throw new Error(`Unknown integration type: ${type}`);
  }
  return configFn();
}

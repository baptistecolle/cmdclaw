import { env } from "@/env";

const getAppUrl = () => env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

export type SubscriptionProviderID = "openai" | "google" | "kimi";

export interface SubscriptionProviderModel {
  id: string;
  name: string;
}

interface SubscriptionProviderBaseConfig {
  name: string;
  description: string;
  models: SubscriptionProviderModel[];
}

export interface OAuthSubscriptionProviderConfig extends SubscriptionProviderBaseConfig {
  authType: "oauth";
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes?: string[];
  usePKCE: boolean;
}

export interface ApiKeySubscriptionProviderConfig extends SubscriptionProviderBaseConfig {
  authType: "api_key";
  docsUrl?: string;
  apiKeyLabel?: string;
}

export type SubscriptionProviderConfig =
  | OAuthSubscriptionProviderConfig
  | ApiKeySubscriptionProviderConfig;

export const SUBSCRIPTION_PROVIDERS: Record<SubscriptionProviderID, SubscriptionProviderConfig> = {
  openai: {
    authType: "oauth",
    name: "ChatGPT",
    description: "Use your ChatGPT Plus/Pro/Max subscription",
    // OpenAI Codex public PKCE client — no secret needed
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    // Must match OpenCode's registered redirect URI for this client
    redirectUri: "http://localhost:1455/auth/callback",
    scopes: ["openid", "profile", "email", "offline_access"],
    usePKCE: true,
    models: [
      { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
      { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
      { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
    ],
  },
  google: {
    authType: "oauth",
    name: "Gemini",
    description: "Use your Google AI Pro/Ultra subscription",
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: `${getAppUrl()}/api/auth/provider/google/callback`,
    scopes: ["https://www.googleapis.com/auth/cloud-platform", "openid"],
    usePKCE: false,
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  kimi: {
    authType: "api_key",
    name: "Kimi",
    description: "Use your Kimi for Coding subscription",
    docsUrl: "https://www.kimi.com/coding/docs/en/third-party-agents.html",
    apiKeyLabel: "KIMI_API_KEY",
    models: [
      { id: "k2p5", name: "Kimi K2.5" },
      { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
    ],
  },
};

export function isOAuthProviderConfig(
  config: SubscriptionProviderConfig
): config is OAuthSubscriptionProviderConfig {
  return config.authType === "oauth";
}

/**
 * Get all models for a given subscription provider.
 */
export function getProviderModels(provider: SubscriptionProviderID): SubscriptionProviderModel[] {
  return SUBSCRIPTION_PROVIDERS[provider].models;
}

/**
 * Get all subscription provider IDs.
 */
export function getSubscriptionProviderIds(): SubscriptionProviderID[] {
  return Object.keys(SUBSCRIPTION_PROVIDERS) as SubscriptionProviderID[];
}

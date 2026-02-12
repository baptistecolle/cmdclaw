import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { protectedProcedure } from "../middleware";
import { providerAuth } from "@/server/db/schema";
import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "@/server/ai/subscription-providers";
import { listOpencodeFreeModels } from "@/server/ai/opencode-models";
import { encrypt } from "@/server/utils/encryption";
import { storePending } from "@/server/ai/pending-oauth";
import { ensureOAuthCallbackServer } from "@/server/ai/oauth-callback-server";

const oauthProviderSchema = z.enum(["openai", "google"]);
const providerSchema = z.enum(["openai", "google", "kimi"]);

// PKCE helpers — matches OpenCode's codex.ts implementation
function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(43);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateState(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * GET /provider-auth/connect/:provider
 * Generate authorization URL for the given subscription provider.
 * For OpenAI (PKCE), generates code verifier/challenge.
 * For Google, uses standard OAuth with client secret.
 */
const connect = protectedProcedure
  .input(z.object({ provider: oauthProviderSchema }))
  .handler(async ({ input, context }) => {
    const config = SUBSCRIPTION_PROVIDERS[input.provider];
    if (!isOAuthProviderConfig(config)) {
      throw new Error(`Provider "${input.provider}" does not support OAuth`);
    }

    // Start the OAuth callback server for providers that use localhost:1455
    if (input.provider === "openai") {
      ensureOAuthCallbackServer();
    }

    // Generate random state for CSRF protection
    const state = generateState();

    // Generate PKCE verifier — stored server-side, never in the URL
    const codeVerifier = config.usePKCE ? generateCodeVerifier() : undefined;

    // Store pending OAuth data in-memory (matches OpenCode's approach)
    storePending(state, {
      userId: context.user.id,
      provider: input.provider,
      codeVerifier: codeVerifier ?? "",
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
    });

    if (config.scopes?.length) {
      params.set("scope", config.scopes.join(" "));
    }

    // PKCE challenge for OpenAI
    if (codeVerifier) {
      params.set("code_challenge", await generateCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }

    // OpenAI-specific params (matches OpenCode's codex.ts)
    if (input.provider === "openai") {
      params.set("id_token_add_organizations", "true");
      params.set("codex_cli_simplified_flow", "true");
      params.set("originator", "opencode");
    }

    // Google-specific params
    if (input.provider === "google") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    return {
      authUrl: `${config.authUrl}?${params}`,
    };
  });

/**
 * GET /provider-auth/status
 * Return which subscription providers the user has connected.
 */
const status = protectedProcedure.handler(async ({ context }) => {
  const auths = await context.db.query.providerAuth.findMany({
    where: eq(providerAuth.userId, context.user.id),
  });

  const connected: Record<string, { connectedAt: Date }> = {};
  for (const auth of auths) {
    connected[auth.provider] = {
      connectedAt: auth.createdAt,
    };
  }

  return { connected };
});

/**
 * DELETE /provider-auth/disconnect/:provider
 * Remove stored tokens for a subscription provider.
 */
const disconnect = protectedProcedure
  .input(z.object({ provider: providerSchema }))
  .handler(async ({ input, context }) => {
    await context.db
      .delete(providerAuth)
      .where(
        and(eq(providerAuth.userId, context.user.id), eq(providerAuth.provider, input.provider)),
      );

    return { success: true };
  });

/**
 * PUT /provider-auth/api-key/:provider
 * Store API key for a subscription provider.
 */
const setApiKey = protectedProcedure
  .input(
    z.object({
      provider: z.literal("kimi"),
      apiKey: z.string().min(1),
    }),
  )
  .handler(async ({ input, context }) => {
    const apiKey = input.apiKey.trim();
    if (!apiKey) {
      throw new Error("API key cannot be empty");
    }

    // Keep API-key credentials effectively non-expiring in the current schema.
    const expiresAt = new Date("2999-01-01T00:00:00.000Z");

    await storeProviderTokens({
      userId: context.user.id,
      provider: input.provider,
      accessToken: apiKey,
      refreshToken: "",
      expiresAt,
    });

    return { success: true };
  });

/**
 * GET /provider-auth/free-models
 * Return free models available from OpenCode Zen.
 */
const freeModels = protectedProcedure.handler(async () => {
  const models = await listOpencodeFreeModels();
  return { models };
});

/**
 * Internal: Store tokens after OAuth callback.
 * Called from the API callback route, not directly from the client.
 */
export async function storeProviderTokens(params: {
  userId: string;
  provider: SubscriptionProviderID;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<void> {
  const { db } = await import("@/server/db/client");

  const encryptedAccess = encrypt(params.accessToken);
  const encryptedRefresh = encrypt(params.refreshToken);

  // Upsert: update if exists, insert if not
  const existing = await db.query.providerAuth.findFirst({
    where: and(eq(providerAuth.userId, params.userId), eq(providerAuth.provider, params.provider)),
  });

  if (existing) {
    await db
      .update(providerAuth)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: params.expiresAt,
      })
      .where(eq(providerAuth.id, existing.id));
  } else {
    await db.insert(providerAuth).values({
      userId: params.userId,
      provider: params.provider,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt: params.expiresAt,
    });
  }
}

export const providerAuthRouter = {
  connect,
  status,
  disconnect,
  setApiKey,
  freeModels,
};

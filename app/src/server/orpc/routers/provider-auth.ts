import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { listOpencodeFreeModels } from "@/server/ai/opencode-models";
import { deletePending, getPending, storePending } from "@/server/ai/pending-oauth";
import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "@/server/ai/subscription-providers";
import { providerAuth } from "@/server/db/schema";
import { encrypt } from "@/server/utils/encryption";
import { protectedProcedure } from "../middleware";

const oauthProviderSchema = z.enum(["openai", "google"]);
const providerSchema = z.enum(["openai", "google", "kimi"]);
const pollProviderSchema = z.object({
  provider: z.literal("openai"),
  flowId: z.string().min(1),
});

function generateState(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const openAIDeviceCodeResponseSchema = z.object({
  device_auth_id: z.string(),
  user_code: z.string(),
  expires_in: z.coerce.number().optional(),
  expires_at: z.string().optional(),
  interval: z.coerce.number().optional(),
});

const openAIDeviceTokenResponseSchema = z.object({
  authorization_code: z.string(),
  code_verifier: z.string(),
});

const openAITokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number().optional(),
});

const openAIDeviceFlowStateSchema = z.object({
  deviceAuthId: z.string(),
  userCode: z.string(),
  interval: z.number(),
});

async function requestOpenAIDeviceCode(config: {
  clientId: string;
  authUrl: string;
}): Promise<z.infer<typeof openAIDeviceCodeResponseSchema>> {
  const issuer = new URL(config.authUrl).origin;
  const deviceCodeUrl = new URL("/api/accounts/deviceauth/usercode", issuer).toString();

  const response = await fetch(deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "opencode/bap",
    },
    body: JSON.stringify({ client_id: config.clientId }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenAI device-code request failed (${response.status}): ${text.slice(0, 180)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI device-code response was not JSON");
  }

  return openAIDeviceCodeResponseSchema.parse(parsed);
}

/**
 * GET /provider-auth/connect/:provider
 * Start provider auth flow.
 * OpenAI uses a device-code flow (no browser redirect callback).
 */
const connect = protectedProcedure
  .input(z.object({ provider: oauthProviderSchema }))
  .handler(async ({ input, context }) => {
    if (input.provider === "google") {
      throw new Error("Google subscription is not supported yet");
    }

    const config = SUBSCRIPTION_PROVIDERS[input.provider];
    if (!isOAuthProviderConfig(config)) {
      throw new Error(`Provider "${input.provider}" does not support OAuth`);
    }

    const flowId = generateState();
    const device = await requestOpenAIDeviceCode({
      clientId: config.clientId,
      authUrl: config.authUrl,
    });
    const interval = Math.max(device.interval ?? 5, 1);
    const flowState = openAIDeviceFlowStateSchema.parse({
      deviceAuthId: device.device_auth_id,
      userCode: device.user_code,
      interval,
    });

    await storePending(flowId, {
      userId: context.user.id,
      provider: input.provider,
      // Reuse durable pending state storage for device-flow state.
      codeVerifier: JSON.stringify(flowState),
    });

    return {
      mode: "device" as const,
      flowId,
      userCode: device.user_code,
      verificationUri: `${new URL(config.authUrl).origin}/codex/device`,
      verificationUriComplete: `${new URL(config.authUrl).origin}/codex/device`,
      interval,
      expiresIn: device.expires_at
        ? Math.max(Math.floor((new Date(device.expires_at).getTime() - Date.now()) / 1000), 30)
        : (device.expires_in ?? 900),
    };
  });

/**
 * Poll OpenAI device flow and finalize token storage once approved.
 */
const poll = protectedProcedure.input(pollProviderSchema).handler(async ({ input, context }) => {
  const pending = await getPending(input.flowId);
  if (!pending || pending.userId !== context.user.id || pending.provider !== input.provider) {
    return {
      status: "failed" as const,
      error: "invalid_state",
    };
  }

  const config = SUBSCRIPTION_PROVIDERS[input.provider];
  if (!isOAuthProviderConfig(config)) {
    return {
      status: "failed" as const,
      error: "invalid_provider",
    };
  }

  const issuer = new URL(config.authUrl).origin;

  let flowState: z.infer<typeof openAIDeviceFlowStateSchema>;
  try {
    flowState = openAIDeviceFlowStateSchema.parse(JSON.parse(pending.codeVerifier));
  } catch {
    await deletePending(input.flowId);
    return { status: "failed" as const, error: "invalid_state_payload" };
  }

  const deviceTokenResponse = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "opencode/bap",
    },
    body: JSON.stringify({
      device_auth_id: flowState.deviceAuthId,
      user_code: flowState.userCode,
    }),
  });

  if (deviceTokenResponse.status === 403 || deviceTokenResponse.status === 404) {
    return { status: "pending" as const, interval: flowState.interval + 3 };
  }
  if (!deviceTokenResponse.ok) {
    await deletePending(input.flowId);
    return {
      status: "failed" as const,
      error: `device_token_failed_${deviceTokenResponse.status}`,
    };
  }

  let deviceTokenData: z.infer<typeof openAIDeviceTokenResponseSchema>;
  try {
    deviceTokenData = openAIDeviceTokenResponseSchema.parse(await deviceTokenResponse.json());
  } catch {
    await deletePending(input.flowId);
    return { status: "failed" as const, error: "invalid_device_token_response" };
  }

  const oauthTokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: deviceTokenData.authorization_code,
    redirect_uri: `${issuer}/deviceauth/callback`,
    client_id: config.clientId,
    code_verifier: deviceTokenData.code_verifier,
  });

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: oauthTokenBody,
  });

  const text = await tokenResponse.text();
  if (!tokenResponse.ok) {
    await deletePending(input.flowId);
    return { status: "failed" as const, error: `oauth_token_failed_${tokenResponse.status}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "failed" as const, error: "invalid_token_response" };
  }

  const tokens = openAITokenResponseSchema.parse(parsed);
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

  await storeProviderTokens({
    userId: context.user.id,
    provider: input.provider,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt,
  });
  await deletePending(input.flowId);

  return { status: "connected" as const };
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
  poll,
  status,
  disconnect,
  setApiKey,
  freeModels,
};

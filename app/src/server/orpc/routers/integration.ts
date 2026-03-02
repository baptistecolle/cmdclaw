import { ORPCError } from "@orpc/server";
import { createHash, randomBytes } from "crypto";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/env";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import {
  integration,
  integrationToken,
  customIntegration,
  customIntegrationCredential,
  googleIntegrationAccessAllowlist,
  user,
} from "@/server/db/schema";
import { fetchDynamicsInstances } from "@/server/integrations/dynamics";
import {
  generateLinkedInAuthUrl,
  deleteUnipileAccount,
  getUnipileAccount,
} from "@/server/integrations/unipile";
import { encrypt, decrypt } from "@/server/lib/encryption";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";
import { protectedProcedure, type AuthenticatedContext } from "../middleware";

const GOOGLE_INTEGRATION_TYPES = new Set<IntegrationType>([
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);
const GOOGLE_ACCESS_REQUEST_SLACK_CHANNEL_NAME = "google-oauth-access-for-users";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSlackChannelName(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

async function ensureAdmin(context: AuthenticatedContext) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true },
  });

  if (dbUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }
}

async function canUserAccessGoogleIntegrations(context: AuthenticatedContext) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true, email: true },
  });

  if (dbUser?.role === "admin") {
    return true;
  }

  const normalizedEmail =
    typeof dbUser?.email === "string" && dbUser.email.length > 0
      ? normalizeEmail(dbUser.email)
      : null;

  if (!normalizedEmail) {
    return false;
  }

  const allowlisted = await context.db.query.googleIntegrationAccessAllowlist.findFirst({
    where: eq(googleIntegrationAccessAllowlist.email, normalizedEmail),
    columns: { id: true },
  });

  return Boolean(allowlisted);
}

async function lookupSlackChannelIdByName(channelName: string): Promise<string> {
  const targetName = normalizeSlackChannelName(channelName);
  const lookupPage = async (cursor?: string): Promise<string> => {
    const params = new URLSearchParams({
      exclude_archived: "true",
      limit: "200",
      types: "public_channel,private_channel,mpim",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name?: string; name_normalized?: string }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!result.ok) {
      throw new Error(result.error ?? "Could not list Slack channels");
    }

    const match = result.channels?.find((channel) => {
      const name = channel.name_normalized ?? channel.name;
      if (!name) {
        return false;
      }
      return normalizeSlackChannelName(name) === targetName;
    });
    if (match?.id) {
      return match.id;
    }

    const nextCursor = result.response_metadata?.next_cursor?.trim();
    if (!nextCursor) {
      throw new Error(`Slack channel not found: ${channelName}`);
    }

    return lookupPage(nextCursor);
  };

  return lookupPage();
}

async function postSlackMessage(channelId: string, text: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
    }),
  });

  return response.json() as Promise<{ ok: boolean; error?: string }>;
}

// PKCE helpers for Airtable OAuth
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const integrationTypeSchema = z.enum([
  "gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

const googleIntegrationTypeSchema = z.enum([
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);

// List user's integrations
const list = protectedProcedure.handler(async ({ context }) => {
  const integrations = await context.db.query.integration.findMany({
    where: eq(integration.userId, context.user.id),
  });

  return integrations.map((i) => {
    const metadata =
      typeof i.metadata === "object" && i.metadata !== null
        ? (i.metadata as Record<string, unknown>)
        : null;

    const instanceName =
      i.type === "dynamics" && typeof metadata?.instanceName === "string"
        ? metadata.instanceName
        : null;
    const instanceUrl =
      i.type === "dynamics" && typeof metadata?.instanceUrl === "string"
        ? metadata.instanceUrl
        : null;

    return {
      id: i.id,
      type: i.type,
      displayName: i.displayName,
      enabled: i.enabled,
      setupRequired: i.type === "dynamics" && metadata?.pendingInstanceSelection === true,
      instanceName,
      instanceUrl,
      authStatus: i.authStatus,
      authErrorCode: i.authErrorCode,
      scopes: i.scopes,
      createdAt: i.createdAt,
    };
  });
});

const getGoogleAccessStatus = protectedProcedure.handler(async ({ context }) => {
  const allowed = await canUserAccessGoogleIntegrations(context);
  return { allowed };
});

const listGoogleAccessAllowlist = protectedProcedure.handler(async ({ context }) => {
  await ensureAdmin(context);

  return context.db.query.googleIntegrationAccessAllowlist.findMany({
    columns: {
      id: true,
      email: true,
      createdByUserId: true,
      createdAt: true,
    },
    orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.createdAt)],
  });
});

const addGoogleAccessAllowlistEntry = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    await ensureAdmin(context);

    const normalizedEmail = normalizeEmail(input.email);
    const inserted = await context.db
      .insert(googleIntegrationAccessAllowlist)
      .values({
        email: normalizedEmail,
        createdByUserId: context.user.id,
      })
      .onConflictDoNothing({
        target: [googleIntegrationAccessAllowlist.email],
      })
      .returning({
        id: googleIntegrationAccessAllowlist.id,
        email: googleIntegrationAccessAllowlist.email,
        createdByUserId: googleIntegrationAccessAllowlist.createdByUserId,
        createdAt: googleIntegrationAccessAllowlist.createdAt,
      });

    if (inserted[0]) {
      return inserted[0];
    }

    const existing = await context.db.query.googleIntegrationAccessAllowlist.findFirst({
      where: eq(googleIntegrationAccessAllowlist.email, normalizedEmail),
      columns: {
        id: true,
        email: true,
        createdByUserId: true,
        createdAt: true,
      },
    });

    if (!existing) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to add Google access entry",
      });
    }

    return existing;
  });

const removeGoogleAccessAllowlistEntry = protectedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    await ensureAdmin(context);

    const removed = await context.db
      .delete(googleIntegrationAccessAllowlist)
      .where(eq(googleIntegrationAccessAllowlist.id, input.id))
      .returning({
        id: googleIntegrationAccessAllowlist.id,
      });

    if (!removed[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: "Google access entry not found",
      });
    }

    return { success: true as const };
  });

const requestGoogleAccess = protectedProcedure
  .input(
    z.object({
      integration: googleIntegrationTypeSchema.optional(),
      source: z.enum(["integrations", "chat", "onboarding"]).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const alreadyAllowed = await canUserAccessGoogleIntegrations(context);
    if (alreadyAllowed) {
      return { ok: true as const, alreadyAllowed: true as const };
    }

    if (!env.SLACK_BOT_TOKEN) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Slack notifications are not configured",
      });
    }

    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { email: true, name: true },
    });

    const channelId = await lookupSlackChannelIdByName(GOOGLE_ACCESS_REQUEST_SLACK_CHANNEL_NAME);
    const message = [
      ":lock: *Google Access Request*",
      `*User:* ${dbUser?.email ?? context.user.id}`,
      `*Name:* ${dbUser?.name ?? "unknown"}`,
      `*User ID:* ${context.user.id}`,
      `*Integration:* ${input.integration ?? "not specified"}`,
      `*Source:* ${input.source ?? "unknown"}`,
      `*Requested at:* ${new Date().toISOString()}`,
    ].join("\n");

    const slackResult = await postSlackMessage(channelId, message);
    if (!slackResult.ok) {
      throw new ORPCError("BAD_GATEWAY", {
        message: slackResult.error ?? "Failed to send Slack notification",
      });
    }

    return { ok: true as const, alreadyAllowed: false as const };
  });

// Get OAuth authorization URL
const getAuthUrl = protectedProcedure
  .input(
    z.object({
      type: integrationTypeSchema,
      redirectUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    // LinkedIn uses Unipile hosted auth instead of standard OAuth
    if (input.type === "linkedin") {
      let url: string;
      try {
        url = await generateLinkedInAuthUrl(context.user.id, input.redirectUrl);
      } catch (error) {
        if (isUnipileMissingCredentialsError(error)) {
          throw new ORPCError("BAD_REQUEST", {
            message: UNIPILE_MISSING_CREDENTIALS_MESSAGE,
          });
        }
        throw error;
      }
      return { authUrl: url };
    }

    if (GOOGLE_INTEGRATION_TYPES.has(input.type as IntegrationType)) {
      const allowed = await canUserAccessGoogleIntegrations(context);
      if (!allowed) {
        throw new ORPCError("FORBIDDEN", {
          message: "Google integrations require admin approval. Request access first.",
        });
      }
    }

    const config = getOAuthConfig(input.type as IntegrationType);

    // Generate PKCE code_verifier for providers that require it
    const pkceProviders = ["airtable", "salesforce", "twitter"];
    const codeVerifier = pkceProviders.includes(input.type) ? generateCodeVerifier() : undefined;

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: input.type,
        redirectUrl: input.redirectUrl,
        codeVerifier, // Store verifier in state for Airtable
      }),
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
    });

    // For Slack, use user_scope to get user tokens instead of bot tokens
    if (input.type === "slack") {
      params.set("user_scope", config.scopes.join(" "));
    } else {
      params.set("scope", config.scopes.join(" "));
    }

    // Add provider-specific params
    const googleTypes = [
      "gmail",
      "google_calendar",
      "google_docs",
      "google_sheets",
      "google_drive",
    ];
    if (googleTypes.includes(input.type)) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (input.type === "notion") {
      params.set("owner", "user");
    }

    // Reddit requires duration=permanent for refresh tokens
    if (input.type === "reddit") {
      params.set("duration", "permanent");
    }

    // Airtable and Salesforce require PKCE
    if (codeVerifier) {
      params.set("code_challenge", generateCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }

    return { authUrl: `${config.authUrl}?${params}` };
  });

// Handle OAuth callback (called from callback route)
const handleCallback = protectedProcedure
  .input(
    z.object({
      code: z.string(),
      state: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    let stateData: {
      userId: string;
      type: IntegrationType;
      redirectUrl: string;
      codeVerifier?: string;
    };

    try {
      stateData = JSON.parse(Buffer.from(input.state, "base64url").toString());
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid state parameter",
      });
    }

    // Verify user matches
    if (stateData.userId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "User mismatch" });
    }

    const config = getOAuthConfig(stateData.type);

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    });

    // Airtable and Salesforce require code_verifier for PKCE
    if (stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    // Notion requires Basic auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Notion, Airtable, Reddit, and Twitter require Basic auth header
    if (
      stateData.type === "notion" ||
      stateData.type === "airtable" ||
      stateData.type === "reddit" ||
      stateData.type === "twitter"
    ) {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`;
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_id");
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_secret");
    }

    // Reddit requires User-Agent header for all API calls
    if (stateData.type === "reddit") {
      headers["User-Agent"] = "cmdclaw-app:v1.0.0 (by /u/cmdclaw-integration)";
    }

    // GitHub needs Accept header
    if (stateData.type === "github") {
      headers["Accept"] = "application/json";
    }

    // Debug logging for token exchange
    console.log("Token exchange request:", {
      url: config.tokenUrl,
      headers: {
        ...headers,
        Authorization: headers.Authorization ? "[REDACTED]" : undefined,
      },
      body: Object.fromEntries(tokenBody.entries()),
      clientIdPresent: !!config.clientId,
      clientSecretPresent: !!config.clientSecret,
      clientIdLength: config.clientId?.length,
    });

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      console.error("Response status:", tokenResponse.status);
      console.error("Response headers:", Object.fromEntries(tokenResponse.headers.entries()));
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to exchange code for tokens",
      });
    }

    const tokens = await tokenResponse.json();

    // Handle different response formats per provider
    // Slack user tokens are in authed_user.access_token
    let accessToken: string;
    if (stateData.type === "slack") {
      accessToken = tokens.authed_user?.access_token;
      if (!accessToken) {
        console.error("Slack token response:", JSON.stringify(tokens, null, 2));
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to get Slack user token",
        });
      }
    } else {
      accessToken = tokens.access_token;
    }

    // Get user info from provider
    const userInfo = await config.getUserInfo(accessToken);

    if (stateData.type === "dynamics") {
      const instances = await fetchDynamicsInstances(accessToken);
      if (instances.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No Dynamics environments available",
        });
      }
      userInfo.metadata = {
        ...userInfo.metadata,
        pendingInstanceSelection: true,
        availableInstances: instances,
      };
    }

    // Create or update integration
    const existingIntegration = await context.db.query.integration.findFirst({
      where: and(eq(integration.userId, context.user.id), eq(integration.type, stateData.type)),
    });

    let integId: string;

    if (existingIntegration) {
      await context.db
        .update(integration)
        .set({
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          scopes: config.scopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics",
          authStatus: "connected",
          authErrorCode: null,
          authErrorAt: null,
          authErrorDetail: null,
        })
        .where(eq(integration.id, existingIntegration.id));
      integId = existingIntegration.id;
    } else {
      const [newInteg] = await context.db
        .insert(integration)
        .values({
          userId: context.user.id,
          type: stateData.type,
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          scopes: config.scopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics",
          authStatus: "connected",
          authErrorCode: null,
          authErrorAt: null,
          authErrorDetail: null,
        })
        .returning();
      integId = newInteg.id;
    }

    // Delete old tokens and store new ones
    await context.db.delete(integrationToken).where(eq(integrationToken.integrationId, integId));

    await context.db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      idToken: tokens.id_token,
    });

    return {
      success: true,
      integrationId: integId,
      redirectUrl: stateData.redirectUrl,
    };
  });

// Toggle integration enabled/disabled
const toggle = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existing = await context.db.query.integration.findFirst({
      where: and(eq(integration.id, input.id), eq(integration.userId, context.user.id)),
    });

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    if (
      existing.type === "dynamics" &&
      input.enabled &&
      typeof existing.metadata === "object" &&
      existing.metadata !== null &&
      (existing.metadata as Record<string, unknown>).pendingInstanceSelection === true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Complete Dynamics environment selection before enabling the integration",
      });
    }

    const result = await context.db
      .update(integration)
      .set({ enabled: input.enabled })
      .where(and(eq(integration.id, input.id), eq(integration.userId, context.user.id)))
      .returning({ id: integration.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    return { success: true };
  });

// Disconnect integration
const disconnect = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    // First, get the integration to check if it's LinkedIn
    const existingIntegration = await context.db.query.integration.findFirst({
      where: and(eq(integration.id, input.id), eq(integration.userId, context.user.id)),
    });

    if (!existingIntegration) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    // For LinkedIn, also delete the Unipile account
    if (existingIntegration.type === "linkedin" && existingIntegration.providerAccountId) {
      try {
        await deleteUnipileAccount(existingIntegration.providerAccountId);
      } catch (error) {
        console.error("Failed to delete Unipile account:", error);
        // Continue with deletion even if Unipile deletion fails
      }
    }

    await context.db.delete(integration).where(eq(integration.id, input.id));

    return { success: true };
  });

// Link LinkedIn account after redirect (Unipile strips query params from webhook notify_url)
const linkLinkedIn = protectedProcedure
  .input(z.object({ accountId: z.string() }))
  .handler(async ({ input, context }) => {
    try {
      const account = await getUnipileAccount(input.accountId);

      const integrationData = {
        providerAccountId: input.accountId,
        displayName: account.name || account.identifier,
        enabled: true,
        authStatus: "connected" as const,
        authErrorCode: null,
        authErrorAt: null,
        authErrorDetail: null,
        metadata: {
          unipileAccountId: input.accountId,
          linkedinIdentifier: account.identifier,
        },
      };

      // Use upsert to handle race conditions
      await context.db
        .insert(integration)
        .values({
          userId: context.user.id,
          type: "linkedin",
          ...integrationData,
        })
        .onConflictDoUpdate({
          target: [integration.userId, integration.type],
          set: integrationData,
        });

      return { success: true };
    } catch (error) {
      console.error("Failed to link LinkedIn account:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to link LinkedIn account",
      });
    }
  });

// ========== CUSTOM INTEGRATIONS ==========

const createCustomIntegration = protectedProcedure
  .input(
    z.object({
      slug: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/),
      name: z.string().min(1).max(128),
      description: z.string().min(1).max(1000),
      iconUrl: z.string().url().nullish(),
      baseUrl: z.string().url(),
      authType: z.enum(["oauth2", "api_key", "bearer_token"]),
      oauthConfig: z
        .object({
          authUrl: z.string().url(),
          tokenUrl: z.string().url(),
          scopes: z.array(z.string()),
          pkce: z.boolean().optional(),
          authStyle: z.enum(["header", "params"]).optional(),
          extraAuthParams: z.record(z.string(), z.string()).optional(),
        })
        .nullish(),
      apiKeyConfig: z
        .object({
          method: z.enum(["header", "query"]),
          headerName: z.string().optional(),
          queryParam: z.string().optional(),
        })
        .nullish(),
      cliCode: z.string().default("// CLI code placeholder"),
      cliInstructions: z.string().default("Custom integration CLI"),
      permissions: z
        .object({
          readOps: z.array(z.string()),
          writeOps: z.array(z.string()),
        })
        .default({ readOps: [], writeOps: [] }),
      // Credentials (for the creating user)
      clientId: z.string().nullish(),
      clientSecret: z.string().nullish(),
      apiKey: z.string().nullish(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Check slug uniqueness
    const existing = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });
    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Integration with slug '${input.slug}' already exists`,
      });
    }

    const [created] = await context.db
      .insert(customIntegration)
      .values({
        slug: input.slug,
        name: input.name,
        description: input.description,
        iconUrl: input.iconUrl ?? null,
        baseUrl: input.baseUrl,
        authType: input.authType,
        oauthConfig: input.oauthConfig
          ? {
              ...input.oauthConfig,
              extraAuthParams: input.oauthConfig.extraAuthParams as
                | Record<string, string>
                | undefined,
            }
          : null,
        apiKeyConfig: input.apiKeyConfig ?? null,
        cliCode: input.cliCode,
        cliInstructions: input.cliInstructions,
        permissions: input.permissions,
        createdByUserId: context.user.id,
      })
      .returning();

    // Save credentials if provided
    if (input.clientId || input.clientSecret || input.apiKey) {
      await context.db.insert(customIntegrationCredential).values({
        userId: context.user.id,
        customIntegrationId: created.id,
        clientId: input.clientId ? encrypt(input.clientId) : null,
        clientSecret: input.clientSecret ? encrypt(input.clientSecret) : null,
        apiKey: input.apiKey ? encrypt(input.apiKey) : null,
        enabled: true,
      });
    }

    return { id: created.id, slug: created.slug };
  });

const listCustomIntegrations = protectedProcedure.handler(async ({ context }) => {
  const integrations = await context.db.query.customIntegration.findMany({
    where: or(
      eq(customIntegration.createdByUserId, context.user.id),
      eq(customIntegration.isBuiltIn, true),
    ),
  });

  // Get user's credentials for these integrations
  const credentials = await context.db.query.customIntegrationCredential.findMany({
    where: eq(customIntegrationCredential.userId, context.user.id),
  });

  const credMap = new Map(credentials.map((c) => [c.customIntegrationId, c]));

  return integrations.map((i) => {
    const cred = credMap.get(i.id);
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      description: i.description,
      iconUrl: i.iconUrl,
      baseUrl: i.baseUrl,
      authType: i.authType,
      isBuiltIn: i.isBuiltIn,
      communityStatus: i.communityStatus,
      communityPrUrl: i.communityPrUrl,
      createdAt: i.createdAt,
      connected: !!cred,
      enabled: cred?.enabled ?? false,
      displayName: cred?.displayName ?? null,
    };
  });
});

const getCustomIntegration = protectedProcedure
  .input(z.object({ slug: z.string() }))
  .handler(async ({ input, context }) => {
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });

    if (!integ) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    return {
      ...integ,
      connected: !!cred,
      enabled: cred?.enabled ?? false,
      displayName: cred?.displayName ?? null,
      hasClientId: !!cred?.clientId,
      hasClientSecret: !!cred?.clientSecret,
      hasApiKey: !!cred?.apiKey,
    };
  });

const setCustomCredentials = protectedProcedure
  .input(
    z.object({
      customIntegrationId: z.string(),
      clientId: z.string().nullish(),
      clientSecret: z.string().nullish(),
      apiKey: z.string().nullish(),
      displayName: z.string().nullish(),
    }),
  )
  .handler(async ({ input, context }) => {
    const values = {
      userId: context.user.id,
      customIntegrationId: input.customIntegrationId,
      clientId: input.clientId ? encrypt(input.clientId) : null,
      clientSecret: input.clientSecret ? encrypt(input.clientSecret) : null,
      apiKey: input.apiKey ? encrypt(input.apiKey) : null,
      displayName: input.displayName ?? null,
      enabled: true,
    };

    await context.db
      .insert(customIntegrationCredential)
      .values(values)
      .onConflictDoUpdate({
        target: [
          customIntegrationCredential.userId,
          customIntegrationCredential.customIntegrationId,
        ],
        set: {
          clientId: values.clientId,
          clientSecret: values.clientSecret,
          apiKey: values.apiKey,
          displayName: values.displayName,
          updatedAt: new Date(),
        },
      });

    return { success: true };
  });

const disconnectCustomIntegration = protectedProcedure
  .input(z.object({ customIntegrationId: z.string() }))
  .handler(async ({ input, context }) => {
    await context.db
      .delete(customIntegrationCredential)
      .where(
        and(
          eq(customIntegrationCredential.userId, context.user.id),
          eq(customIntegrationCredential.customIntegrationId, input.customIntegrationId),
        ),
      );

    return { success: true };
  });

const toggleCustomIntegration = protectedProcedure
  .input(z.object({ customIntegrationId: z.string(), enabled: z.boolean() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(customIntegrationCredential)
      .set({ enabled: input.enabled })
      .where(
        and(
          eq(customIntegrationCredential.userId, context.user.id),
          eq(customIntegrationCredential.customIntegrationId, input.customIntegrationId),
        ),
      )
      .returning({ id: customIntegrationCredential.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
    }

    return { success: true };
  });

const deleteCustomIntegration = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .delete(customIntegration)
      .where(
        and(
          eq(customIntegration.id, input.id),
          eq(customIntegration.createdByUserId, context.user.id),
        ),
      )
      .returning({ id: customIntegration.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    return { success: true };
  });

// Custom OAuth auth URL
const getCustomAuthUrl = protectedProcedure
  .input(
    z.object({
      slug: z.string(),
      redirectUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, input.slug),
    });
    if (!integ || integ.authType !== "oauth2" || !integ.oauthConfig) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Not a valid OAuth2 custom integration",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    if (!cred?.clientId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Client credentials not configured",
      });
    }

    const clientId = decrypt(cred.clientId);
    const oauth = integ.oauthConfig;

    const codeVerifier = oauth.pkce ? generateCodeVerifier() : undefined;

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: `custom_${integ.slug}`,
        redirectUrl: input.redirectUrl,
        codeVerifier,
      }),
    ).toString("base64url");

    const appUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${appUrl}/api/oauth/callback`,
      response_type: "code",
      state,
      scope: oauth.scopes.join(" "),
    });

    if (codeVerifier) {
      params.set("code_challenge", generateCodeChallenge(codeVerifier));
      params.set("code_challenge_method", "S256");
    }

    if (oauth.extraAuthParams) {
      for (const [k, v] of Object.entries(oauth.extraAuthParams)) {
        params.set(k, v);
      }
    }

    return { authUrl: `${oauth.authUrl}?${params}` };
  });

// Custom OAuth callback handler
const handleCustomCallback = protectedProcedure
  .input(
    z.object({
      code: z.string(),
      state: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    let stateData: {
      userId: string;
      type: string;
      redirectUrl: string;
      codeVerifier?: string;
    };
    try {
      stateData = JSON.parse(Buffer.from(input.state, "base64url").toString());
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid state parameter",
      });
    }

    if (stateData.userId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "User mismatch" });
    }

    const slug = stateData.type.replace("custom_", "");
    const integ = await context.db.query.customIntegration.findFirst({
      where: eq(customIntegration.slug, slug),
    });

    if (!integ || !integ.oauthConfig) {
      throw new ORPCError("NOT_FOUND", {
        message: "Custom integration not found",
      });
    }

    const cred = await context.db.query.customIntegrationCredential.findFirst({
      where: and(
        eq(customIntegrationCredential.userId, context.user.id),
        eq(customIntegrationCredential.customIntegrationId, integ.id),
      ),
    });

    if (!cred?.clientId || !cred?.clientSecret) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Client credentials not configured",
      });
    }

    const clientId = decrypt(cred.clientId);
    const clientSecret = decrypt(cred.clientSecret);
    const oauth = integ.oauthConfig;
    const appUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: `${appUrl}/api/oauth/callback`,
    });

    if (stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (oauth.authStyle === "header") {
      headers["Authorization"] =
        `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      tokenBody.set("client_id", clientId);
      tokenBody.set("client_secret", clientSecret);
    }

    const tokenResponse = await fetch(oauth.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Custom OAuth token exchange failed:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to exchange code for tokens",
      });
    }

    const tokens = await tokenResponse.json();

    // Update credential with tokens
    await context.db
      .update(customIntegrationCredential)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        enabled: true,
      })
      .where(eq(customIntegrationCredential.id, cred.id));

    return { success: true, redirectUrl: stateData.redirectUrl };
  });

export const integrationRouter = {
  list,
  getGoogleAccessStatus,
  listGoogleAccessAllowlist,
  addGoogleAccessAllowlistEntry,
  removeGoogleAccessAllowlistEntry,
  requestGoogleAccess,
  getAuthUrl,
  handleCallback,
  toggle,
  disconnect,
  linkLinkedIn,
  // Custom integrations
  createCustomIntegration,
  listCustomIntegrations,
  getCustomIntegration,
  setCustomCredentials,
  disconnectCustomIntegration,
  toggleCustomIntegration,
  deleteCustomIntegration,
  getCustomAuthUrl,
  handleCustomCallback,
};

import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { integration, integrationToken } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";
import { createHash, randomBytes } from "crypto";

// PKCE helpers for Airtable OAuth
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const integrationTypeSchema = z.enum([
  "gmail",
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
]);

// List user's integrations
const list = protectedProcedure.handler(async ({ context }) => {
  const integrations = await context.db.query.integration.findMany({
    where: eq(integration.userId, context.user.id),
  });

  return integrations.map((i) => ({
    id: i.id,
    type: i.type,
    displayName: i.displayName,
    enabled: i.enabled,
    scopes: i.scopes,
    createdAt: i.createdAt,
  }));
});

// Get OAuth authorization URL
const getAuthUrl = protectedProcedure
  .input(
    z.object({
      type: integrationTypeSchema,
      redirectUrl: z.string().url(),
    })
  )
  .handler(async ({ input, context }) => {
    const config = getOAuthConfig(input.type as IntegrationType);

    // Generate PKCE code_verifier for Airtable
    const codeVerifier = input.type === "airtable" ? generateCodeVerifier() : undefined;

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: input.type,
        redirectUrl: input.redirectUrl,
        codeVerifier, // Store verifier in state for Airtable
      })
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
    const googleTypes = ["gmail", "google_calendar", "google_docs", "google_sheets", "google_drive"];
    if (googleTypes.includes(input.type)) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (input.type === "notion") {
      params.set("owner", "user");
    }

    // Airtable requires PKCE
    if (input.type === "airtable" && codeVerifier) {
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
    })
  )
  .handler(async ({ input, context }) => {
    let stateData: { userId: string; type: IntegrationType; redirectUrl: string; codeVerifier?: string };

    try {
      stateData = JSON.parse(
        Buffer.from(input.state, "base64url").toString()
      );
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid state parameter" });
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

    // Airtable requires code_verifier for PKCE
    if (stateData.type === "airtable" && stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
    }

    // Notion requires Basic auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Notion and Airtable require Basic auth header
    if (stateData.type === "notion" || stateData.type === "airtable") {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`
      ).toString("base64")}`;
      tokenBody.delete("client_id");
      tokenBody.delete("client_secret");
    }

    // GitHub needs Accept header
    if (stateData.type === "github") {
      headers["Accept"] = "application/json";
    }

    // Debug logging for token exchange
    console.log("Token exchange request:", {
      url: config.tokenUrl,
      headers: { ...headers, Authorization: headers.Authorization ? "[REDACTED]" : undefined },
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
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to exchange code for tokens" });
    }

    const tokens = await tokenResponse.json();

    // Handle different response formats per provider
    // Slack user tokens are in authed_user.access_token
    let accessToken: string;
    if (stateData.type === "slack") {
      accessToken = tokens.authed_user?.access_token;
      if (!accessToken) {
        console.error("Slack token response:", JSON.stringify(tokens, null, 2));
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to get Slack user token" });
      }
    } else {
      accessToken = tokens.access_token;
    }

    // Get user info from provider
    const userInfo = await config.getUserInfo(accessToken);

    // Create or update integration
    const existingIntegration = await context.db.query.integration.findFirst({
      where: and(
        eq(integration.userId, context.user.id),
        eq(integration.type, stateData.type)
      ),
    });

    let integId: string;

    if (existingIntegration) {
      await context.db
        .update(integration)
        .set({
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          metadata: userInfo.metadata,
          enabled: true,
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
        })
        .returning();
      integId = newInteg.id;
    }

    // Delete old tokens and store new ones
    await context.db
      .delete(integrationToken)
      .where(eq(integrationToken.integrationId, integId));

    await context.db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
      idToken: tokens.id_token,
    });

    return { success: true, integrationId: integId, redirectUrl: stateData.redirectUrl };
  });

// Toggle integration enabled/disabled
const toggle = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
    })
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(integration)
      .set({ enabled: input.enabled })
      .where(
        and(
          eq(integration.id, input.id),
          eq(integration.userId, context.user.id)
        )
      )
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
    const result = await context.db
      .delete(integration)
      .where(
        and(
          eq(integration.id, input.id),
          eq(integration.userId, context.user.id)
        )
      )
      .returning({ id: integration.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
    }

    return { success: true };
  });

export const integrationRouter = {
  list,
  getAuthUrl,
  handleCallback,
  toggle,
  disconnect,
};

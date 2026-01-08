import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { integration, integrationToken } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";

const integrationTypeSchema = z.enum([
  "gmail",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
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

    const state = Buffer.from(
      JSON.stringify({
        userId: context.user.id,
        type: input.type,
        redirectUrl: input.redirectUrl,
      })
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
    });

    // Add provider-specific params
    if (input.type === "gmail") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (input.type === "notion") {
      params.set("owner", "user");
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
    let stateData: { userId: string; type: IntegrationType; redirectUrl: string };

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

    // Notion requires Basic auth header
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (stateData.type === "notion") {
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

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to exchange code for tokens" });
    }

    const tokens = await tokenResponse.json();

    // Handle Notion's different response format
    const accessToken = stateData.type === "notion"
      ? tokens.access_token
      : tokens.access_token;

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

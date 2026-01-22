import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { integration, integrationToken } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.error("OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${error}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", request.url)
    );
  }

  // Get session
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.user) {
    return NextResponse.redirect(
      new URL("/login?error=unauthorized", request.url)
    );
  }

  // Parse state
  let stateData: { userId: string; type: IntegrationType; redirectUrl: string; codeVerifier?: string };

  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", request.url)
    );
  }

  // Helper to build redirect URL with the correct base path
  const buildRedirectUrl = (params: string) => {
    const baseUrl = stateData.redirectUrl || "/settings/integrations";
    return new URL(`${baseUrl}?${params}`, request.url);
  };

  // Verify user matches
  if (stateData.userId !== sessionData.user.id) {
    return NextResponse.redirect(buildRedirectUrl("error=user_mismatch"));
  }

  try {
    const config = getOAuthConfig(stateData.type);

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    });

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

    // Airtable requires code_verifier for PKCE
    if (stateData.type === "airtable" && stateData.codeVerifier) {
      tokenBody.set("code_verifier", stateData.codeVerifier);
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
      return NextResponse.redirect(buildRedirectUrl("error=token_exchange_failed"));
    }

    const tokens = await tokenResponse.json();

    // Handle different token response formats
    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number | undefined;

    if (stateData.type === "slack") {
      // Slack user tokens are in authed_user object
      accessToken = tokens.authed_user?.access_token;
      refreshToken = tokens.authed_user?.refresh_token;
      // Slack user tokens don't expire by default
    } else {
      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      expiresIn = tokens.expires_in;
    }

    if (!accessToken) {
      console.error("No access token in response:", tokens);
      return NextResponse.redirect(buildRedirectUrl("error=no_access_token"));
    }

    // Get user info from provider
    const userInfo = await config.getUserInfo(accessToken);

    // Create or update integration
    const existingIntegration = await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, sessionData.user.id),
        eq(integration.type, stateData.type)
      ),
    });

    let integId: string;

    if (existingIntegration) {
      await db
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
      const [newInteg] = await db
        .insert(integration)
        .values({
          userId: sessionData.user.id,
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
    await db
      .delete(integrationToken)
      .where(eq(integrationToken.integrationId, integId));

    await db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
      idToken: tokens.id_token,
    });

    return NextResponse.redirect(buildRedirectUrl("success=true"));
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(buildRedirectUrl("error=callback_failed"));
  }
}

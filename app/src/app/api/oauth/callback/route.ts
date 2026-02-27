import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { integration, integrationToken } from "@/server/db/schema";
import { fetchDynamicsInstances } from "@/server/integrations/dynamics";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";
import { generationManager } from "@/server/services/generation-manager";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.error("OAuth error:", error);
    return NextResponse.redirect(new URL(`/integrations?error=${error}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/integrations?error=missing_params", request.url));
  }

  // Get session
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  // Parse state
  let stateData: {
    userId: string;
    type: IntegrationType;
    redirectUrl: string;
    codeVerifier?: string;
    dynamicsInstanceUrl?: string;
    dynamicsInstanceName?: string;
  };

  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(new URL("/integrations?error=invalid_state", request.url));
  }

  // Helper to build redirect URL with the correct base path
  const buildRedirectUrl = (params: string) => {
    const baseUrl = stateData.redirectUrl || "/integrations";
    const redirectUrl = new URL(baseUrl, request.url);
    const extraParams = new URLSearchParams(params);
    for (const [key, value] of extraParams.entries()) {
      redirectUrl.searchParams.set(key, value);
    }
    return redirectUrl;
  };

  const resolveAuthResumeContext = (): { generationId?: string; integration?: string } => {
    try {
      const redirectUrl = new URL(stateData.redirectUrl, request.url);
      return {
        generationId: redirectUrl.searchParams.get("generation_id") ?? undefined,
        integration: redirectUrl.searchParams.get("auth_complete") ?? undefined,
      };
    } catch {
      return {};
    }
  };

  // Verify user matches
  if (stateData.userId !== sessionData.user.id) {
    return NextResponse.redirect(buildRedirectUrl("error=user_mismatch"));
  }

  try {
    const config = getOAuthConfig(stateData.type);
    const normalizedDynamicsInstanceUrl =
      typeof stateData.dynamicsInstanceUrl === "string"
        ? stateData.dynamicsInstanceUrl.trim().replace(/\/+$/, "")
        : "";
    const isDynamicsInstanceScopedAuth =
      stateData.type === "dynamics" && normalizedDynamicsInstanceUrl.length > 0;
    const integrationScopes =
      isDynamicsInstanceScopedAuth && stateData.type === "dynamics"
        ? [
            "offline_access",
            "openid",
            "profile",
            "email",
            `${normalizedDynamicsInstanceUrl}/user_impersonation`,
          ]
        : config.scopes;

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
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`;
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_id");
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_secret");
    }

    // Airtable and Salesforce require code_verifier for PKCE
    if (stateData.codeVerifier) {
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

    // Salesforce: capture instance_url from token response
    if (stateData.type === "salesforce" && tokens.instance_url) {
      userInfo.metadata = {
        ...userInfo.metadata,
        instanceUrl: tokens.instance_url,
      };
    }

    // Dynamics: require environment selection before enabling integration
    if (stateData.type === "dynamics") {
      if (isDynamicsInstanceScopedAuth) {
        userInfo.metadata = {
          ...userInfo.metadata,
          pendingInstanceSelection: false,
          pendingInstanceReauth: false,
          availableInstances: [],
          instanceUrl: normalizedDynamicsInstanceUrl,
          instanceName: stateData.dynamicsInstanceName ?? normalizedDynamicsInstanceUrl,
        };
      } else {
        const instances = await fetchDynamicsInstances(accessToken);
        if (instances.length === 0) {
          return NextResponse.redirect(buildRedirectUrl("error=dynamics_no_environments"));
        }
        userInfo.metadata = {
          ...userInfo.metadata,
          pendingInstanceSelection: true,
          pendingInstanceReauth: false,
          availableInstances: instances,
        };
      }
    }

    // Create or update integration
    const existingIntegration = await db.query.integration.findFirst({
      where: and(eq(integration.userId, sessionData.user.id), eq(integration.type, stateData.type)),
    });

    let integId: string;

    if (existingIntegration) {
      await db
        .update(integration)
        .set({
          providerAccountId: userInfo.id,
          displayName: userInfo.displayName,
          scopes: integrationScopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics" || isDynamicsInstanceScopedAuth,
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
          scopes: integrationScopes,
          metadata: userInfo.metadata,
          enabled: stateData.type !== "dynamics" || isDynamicsInstanceScopedAuth,
        })
        .returning();
      integId = newInteg.id;
    }

    // Delete old tokens and store new ones
    await db.delete(integrationToken).where(eq(integrationToken.integrationId, integId));

    await db.insert(integrationToken).values({
      integrationId: integId,
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      idToken: tokens.id_token,
    });

    if (stateData.type === "dynamics" && !isDynamicsInstanceScopedAuth) {
      const dynamicsRedirect = new URL("/integrations", request.url);
      dynamicsRedirect.searchParams.set("dynamics_select", "true");
      const authResume = resolveAuthResumeContext();
      if (authResume.generationId) {
        dynamicsRedirect.searchParams.set("generation_id", authResume.generationId);
      }
      if (authResume.integration) {
        dynamicsRedirect.searchParams.set("auth_complete", authResume.integration);
      }
      return NextResponse.redirect(dynamicsRedirect);
    }

    const authResume = resolveAuthResumeContext();
    if (authResume.generationId) {
      try {
        await generationManager.submitAuthResult(
          authResume.generationId,
          authResume.integration ?? stateData.type,
          true,
          sessionData.user.id,
        );
      } catch (resumeError) {
        console.warn("[OAuth callback] Failed to auto-submit auth result:", resumeError);
      }
    }

    return NextResponse.redirect(buildRedirectUrl("success=true"));
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(buildRedirectUrl("error=callback_failed"));
  }
}

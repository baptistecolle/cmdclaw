import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { consumePending } from "@/server/ai/pending-oauth";
import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "@/server/ai/subscription-providers";
import { storeProviderTokens } from "@/server/orpc/routers/provider-auth";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const settingsUrl = new URL("/settings/subscriptions", request.url);

  // Handle OAuth errors
  if (error) {
    const errorDescription = searchParams.get("error_description");
    console.error(`[ProviderAuth] OAuth error for ${provider}:`, errorDescription || error);
    settingsUrl.searchParams.set("provider_error", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("provider_error", "missing_params");
    return NextResponse.redirect(settingsUrl);
  }

  // Validate provider
  if (!(provider in SUBSCRIPTION_PROVIDERS)) {
    settingsUrl.searchParams.set("provider_error", "invalid_provider");
    return NextResponse.redirect(settingsUrl);
  }

  const providerConfig = SUBSCRIPTION_PROVIDERS[provider as SubscriptionProviderID];
  if (!isOAuthProviderConfig(providerConfig)) {
    settingsUrl.searchParams.set("provider_error", "invalid_provider");
    return NextResponse.redirect(settingsUrl);
  }

  // Retrieve pending OAuth data from in-memory store (PKCE verifier stored server-side)
  const pending = await consumePending(state);
  if (!pending) {
    settingsUrl.searchParams.set("provider_error", "invalid_state");
    return NextResponse.redirect(settingsUrl);
  }

  // Verify the user is authenticated and matches
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.id !== pending.userId) {
    settingsUrl.searchParams.set("provider_error", "auth_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: providerConfig.redirectUri,
      client_id: providerConfig.clientId,
    });

    // Add PKCE verifier (stored server-side, never in URL)
    if (pending.codeVerifier) {
      tokenBody.set("code_verifier", pending.codeVerifier);
    }

    // Add client secret for Google (non-PKCE flow)
    if (!providerConfig.usePKCE && providerConfig.clientSecret) {
      tokenBody.set("client_secret", providerConfig.clientSecret);
    }

    const tokenResponse = await fetch(providerConfig.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`[ProviderAuth] Token exchange failed for ${provider}:`, errorText);
      settingsUrl.searchParams.set("provider_error", "token_exchange_failed");
      return NextResponse.redirect(settingsUrl);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };

    // Calculate expiration
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000); // Default 1 hour

    // Store encrypted tokens
    await storeProviderTokens({
      userId: pending.userId,
      provider: provider as SubscriptionProviderID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt,
    });

    settingsUrl.searchParams.set("provider_connected", provider);
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    console.error(`[ProviderAuth] Callback error for ${provider}:`, err);
    settingsUrl.searchParams.set("provider_error", "callback_failed");
    return NextResponse.redirect(settingsUrl);
  }
}

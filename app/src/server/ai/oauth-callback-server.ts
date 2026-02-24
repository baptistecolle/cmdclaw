/**
 * Temporary HTTP server on port 1455 to receive OpenAI OAuth callbacks.
 *
 * The Codex public PKCE client (app_EMoamEEZ73f0CkXaXp7hrann) only accepts
 * http://localhost:1455/auth/callback as a redirect URI. This matches
 * OpenCode's registered redirect URI.
 *
 * Flow:
 *  1. User clicks "Connect ChatGPT" → CmdClaw generates auth URL
 *  2. Browser opens OpenAI auth page
 *  3. OpenAI redirects to http://localhost:1455/auth/callback
 *  4. This server catches the callback, exchanges code for tokens
 *  5. Redirects browser back to CmdClaw's settings page
 */
import { createServer, type Server } from "node:http";
import { env } from "@/env";
import { storeProviderTokens } from "../orpc/routers/provider-auth";
import { consumePending } from "./pending-oauth";
import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "./subscription-providers";

const OAUTH_PORT = 1455;

function getAppUrl() {
  return (
    env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  );
}

let server: Server | null = null;

export function ensureOAuthCallbackServer(): void {
  if (server) {
    return;
  }

  server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${OAUTH_PORT}`);

    if (url.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    const settingsUrl = new URL("/settings/subscriptions", getAppUrl());

    if (error) {
      console.error(`[OAuthCallback] OAuth error: ${errorDescription || error}`);
      settingsUrl.searchParams.set("provider_error", error);
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
      return;
    }

    if (!code || !state) {
      settingsUrl.searchParams.set("provider_error", "missing_params");
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
      return;
    }

    const pending = await consumePending(state);
    if (!pending) {
      settingsUrl.searchParams.set("provider_error", "invalid_state");
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
      return;
    }

    const provider = pending.provider as SubscriptionProviderID;
    const config = SUBSCRIPTION_PROVIDERS[provider];
    if (!isOAuthProviderConfig(config)) {
      settingsUrl.searchParams.set("provider_error", "invalid_provider");
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
      return;
    }

    try {
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
      });

      if (pending.codeVerifier) {
        tokenBody.set("code_verifier", pending.codeVerifier);
      }

      if (!config.usePKCE && config.clientSecret) {
        tokenBody.set("client_secret", config.clientSecret);
      }

      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`[OAuthCallback] Token exchange failed for ${provider}:`, errorText);
        settingsUrl.searchParams.set("provider_error", "token_exchange_failed");
        res.writeHead(302, { Location: settingsUrl.toString() });
        res.end();
        return;
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      };

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000);

      await storeProviderTokens({
        userId: pending.userId,
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt,
      });

      console.log(`[OAuthCallback] Successfully connected ${provider}`);
      settingsUrl.searchParams.set("provider_connected", provider);
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
    } catch (err) {
      console.error(`[OAuthCallback] Error for ${provider}:`, err);
      settingsUrl.searchParams.set("provider_error", "callback_failed");
      res.writeHead(302, { Location: settingsUrl.toString() });
      res.end();
    }
  });

  server.listen(OAUTH_PORT, () => {
    console.log(`[OAuthCallback] Listening on http://localhost:${OAUTH_PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[OAuthCallback] Port ${OAUTH_PORT} already in use (OpenCode may be running)`);
    } else {
      console.error(`[OAuthCallback] Server error:`, err);
    }
    server = null;
  });
}

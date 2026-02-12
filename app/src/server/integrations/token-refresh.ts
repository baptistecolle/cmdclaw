import { db } from "@/server/db/client";
import {
  integration,
  integrationToken,
  customIntegrationCredential,
} from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";
import { decrypt } from "@/server/lib/encryption";

// Refresh tokens 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface TokenWithMetadata {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  integrationId: string;
  type: IntegrationType;
}

/**
 * Check if a token needs to be refreshed
 */
function needsRefresh(token: TokenWithMetadata): boolean {
  if (!token.expiresAt) {
    // No expiry set - assume it doesn't expire (e.g., some OAuth providers)
    return false;
  }

  const expiresAtMs = token.expiresAt.getTime();
  const nowMs = Date.now();

  // Refresh if expired or will expire within buffer
  return nowMs >= expiresAtMs - EXPIRY_BUFFER_MS;
}

/**
 * Refresh an access token using the refresh token
 */
async function refreshAccessToken(token: TokenWithMetadata): Promise<string> {
  if (!token.refreshToken) {
    throw new Error(`No refresh token available for ${token.type} integration`);
  }

  const config = getOAuthConfig(token.type);

  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // Notion, Airtable, and Reddit require Basic auth header for token refresh
  if (
    token.type === "notion" ||
    token.type === "airtable" ||
    token.type === "reddit"
  ) {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64")}`;
    tokenBody.delete("client_id");
    tokenBody.delete("client_secret");
  }

  // Reddit requires User-Agent header for all API calls
  if (token.type === "reddit") {
    headers["User-Agent"] = "bap-app:v1.0.0 (by /u/bap-integration)";
  }

  // Salesforce uses standard OAuth refresh but may return updated instance_url
  // (handled in the response processing below)

  const now = new Date();
  const tokenAge = token.expiresAt
    ? Math.round((now.getTime() - token.expiresAt.getTime()) / 1000 / 60)
    : "unknown";
  console.log(`[Token Refresh] Refreshing ${token.type} token...`);
  console.log(`[Token Refresh] Integration ID: ${token.integrationId}`);
  console.log(
    `[Token Refresh] Token expired at: ${token.expiresAt?.toISOString() ?? "no expiry"}`,
  );
  console.log(`[Token Refresh] Token age (mins past expiry): ${tokenAge}`);
  console.log(
    `[Token Refresh] Refresh token present: ${!!token.refreshToken} (length: ${token.refreshToken?.length ?? 0})`,
  );

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: tokenBody,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(
      `[Token Refresh] Failed to refresh ${token.type} token:`,
      error,
    );
    throw new Error(`Failed to refresh ${token.type} token: ${error}`);
  }

  const tokens = await response.json();

  const newAccessToken = tokens.access_token;
  const newRefreshToken = tokens.refresh_token || token.refreshToken; // Some providers return new refresh token
  const expiresIn = tokens.expires_in;

  if (!newAccessToken) {
    throw new Error(`No access token in refresh response for ${token.type}`);
  }

  // Update tokens in database
  await db
    .update(integrationToken)
    .set({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(integrationToken.integrationId, token.integrationId));

  console.log(`[Token Refresh] Successfully refreshed ${token.type} token`);

  return newAccessToken;
}

/**
 * Get a valid access token for an integration, refreshing if necessary
 */
export async function getValidAccessToken(
  token: TokenWithMetadata,
): Promise<string> {
  if (!needsRefresh(token)) {
    return token.accessToken;
  }

  try {
    return await refreshAccessToken(token);
  } catch (error) {
    console.error(`[Token Refresh] Error refreshing token:`, error);
    // Return the existing token as fallback - it might still work briefly
    // or will fail with a clear auth error
    return token.accessToken;
  }
}

/**
 * Get valid access tokens for all enabled integrations for a user,
 * refreshing any that are expired or about to expire
 */
export async function getValidTokensForUser(
  userId: string,
): Promise<Map<IntegrationType, string>> {
  const results = await db
    .select({
      type: integration.type,
      accessToken: integrationToken.accessToken,
      refreshToken: integrationToken.refreshToken,
      expiresAt: integrationToken.expiresAt,
      integrationId: integrationToken.integrationId,
      enabled: integration.enabled,
    })
    .from(integration)
    .innerJoin(
      integrationToken,
      eq(integration.id, integrationToken.integrationId),
    )
    .where(eq(integration.userId, userId));

  const tokens = new Map<IntegrationType, string>();

  // Process tokens in parallel, only for enabled integrations
  await Promise.all(
    results
      .filter((row) => row.enabled && row.accessToken)
      .map(async (row) => {
        const validToken = await getValidAccessToken({
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          expiresAt: row.expiresAt,
          integrationId: row.integrationId,
          type: row.type,
        });

        tokens.set(row.type, validToken);
      }),
  );

  return tokens;
}

/**
 * Refresh a custom integration's OAuth token
 */
async function refreshCustomToken(
  credId: string,
  accessToken: string,
  refreshToken: string,
  oauthConfig: { tokenUrl: string; authStyle?: "header" | "params" },
  encryptedClientId: string,
  encryptedClientSecret: string,
): Promise<string> {
  const clientId = decrypt(encryptedClientId);
  const clientSecret = decrypt(encryptedClientSecret);

  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (oauthConfig.authStyle === "header") {
    headers["Authorization"] =
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    tokenBody.set("client_id", clientId);
    tokenBody.set("client_secret", clientSecret);
  }

  const response = await fetch(oauthConfig.tokenUrl, {
    method: "POST",
    headers,
    body: tokenBody,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[Custom Token Refresh] Failed:`, error);
    throw new Error(`Failed to refresh custom token: ${error}`);
  }

  const tokens = await response.json();
  const newAccessToken = tokens.access_token;
  const newRefreshToken = tokens.refresh_token || refreshToken;

  await db
    .update(customIntegrationCredential)
    .set({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
    })
    .where(eq(customIntegrationCredential.id, credId));

  return newAccessToken;
}

/**
 * Get valid tokens for all custom OAuth integrations, refreshing as needed
 * Returns Map<credentialId, accessToken>
 */
export async function getValidCustomTokens(
  userId: string,
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();

  const creds = await db.query.customIntegrationCredential.findMany({
    where: and(
      eq(customIntegrationCredential.userId, userId),
      eq(customIntegrationCredential.enabled, true),
    ),
    with: {
      customIntegration: true,
    },
  });

  await Promise.all(
    creds
      .filter((c) => c.customIntegration.authType === "oauth2" && c.accessToken)
      .map(async (c) => {
        const oauth = c.customIntegration.oauthConfig;
        if (!oauth || !c.refreshToken || !c.clientId || !c.clientSecret) {
          if (c.accessToken) tokens.set(c.id, c.accessToken);
          return;
        }

        // Check if needs refresh
        if (
          c.expiresAt &&
          Date.now() >= c.expiresAt.getTime() - EXPIRY_BUFFER_MS
        ) {
          try {
            const newToken = await refreshCustomToken(
              c.id,
              c.accessToken!,
              c.refreshToken,
              oauth,
              c.clientId,
              c.clientSecret,
            );
            tokens.set(c.id, newToken);
          } catch {
            if (c.accessToken) tokens.set(c.id, c.accessToken);
          }
        } else if (c.accessToken) {
          tokens.set(c.id, c.accessToken);
        }
      }),
  );

  return tokens;
}

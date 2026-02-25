import { eq, and, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integration, integrationToken, customIntegrationCredential } from "@/server/db/schema";
import { decrypt } from "@/server/lib/encryption";
import { getOAuthConfig, type IntegrationType } from "@/server/oauth/config";

// Refresh tokens 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface TokenWithMetadata {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  integrationId: string;
  type: IntegrationType;
}

type RefreshAccessTokenResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "error"; message: string };

type OAuthFailureType = "definitive_auth_failure" | "transient_failure" | "unknown_failure";

type OAuthFailureClassification = {
  type: OAuthFailureType;
  code: string | null;
  detail: string | null;
};

const DEFINITIVE_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "bad_refresh_token",
  "token_revoked",
  "revoked_token",
]);

const BASE_DEFINITIVE_PATTERNS = [
  /invalid token/i,
  /invalid refresh token/i,
  /refresh token (?:is )?invalid/i,
  /refresh token.*expired/i,
  /refresh token.*revoked/i,
  /revoked/i,
  /expired or revoked/i,
];

const PROVIDER_DEFINITIVE_PATTERNS: Partial<Record<IntegrationType, RegExp[]>> = {
  airtable: [/invalid token/i],
  google_calendar: [/expired or revoked/i],
  gmail: [/expired or revoked/i],
  outlook: [/invalid_grant/i, /refresh token.*invalid/i],
  outlook_calendar: [/invalid_grant/i, /refresh token.*invalid/i],
  google_docs: [/expired or revoked/i],
  google_drive: [/expired or revoked/i],
  google_sheets: [/expired or revoked/i],
  github: [/bad_refresh_token/i],
  hubspot: [/refresh token.*invalid/i],
  linear: [/invalid_grant/i],
  notion: [/revoked/i],
  reddit: [/invalid_grant/i],
  salesforce: [/invalid_grant/i],
  slack: [/invalid refresh token/i],
  twitter: [/invalid_grant/i],
};

function parseOAuthErrorPayload(raw: string): { code: string | null; description: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { code: null, description: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; error_description?: unknown };
    return {
      code: typeof parsed.error === "string" ? parsed.error : null,
      description: typeof parsed.error_description === "string" ? parsed.error_description : null,
    };
  } catch {
    // fall through
  }

  const params = new URLSearchParams(trimmed);
  const code = params.get("error");
  const description = params.get("error_description");
  if (code || description) {
    return { code, description };
  }

  return { code: null, description: trimmed };
}

function classifyOAuthRefreshFailure(
  provider: IntegrationType,
  status: number,
  rawError: string,
): OAuthFailureClassification {
  const { code, description } = parseOAuthErrorPayload(rawError);
  const detail = description ?? (rawError.trim() || null);
  const normalizedCode = code?.toLowerCase() ?? null;
  const haystack = [normalizedCode, detail?.toLowerCase()].filter(Boolean).join(" ");

  if (status === 429 || status >= 500) {
    return { type: "transient_failure", code: normalizedCode, detail };
  }

  if (normalizedCode && DEFINITIVE_ERROR_CODES.has(normalizedCode)) {
    return { type: "definitive_auth_failure", code: normalizedCode, detail };
  }

  const providerPatterns = PROVIDER_DEFINITIVE_PATTERNS[provider] ?? [];
  const patterns = [...BASE_DEFINITIVE_PATTERNS, ...providerPatterns];
  if (patterns.some((pattern) => pattern.test(haystack))) {
    return { type: "definitive_auth_failure", code: normalizedCode, detail };
  }

  return { type: "unknown_failure", code: normalizedCode, detail };
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

  const result = await db.transaction(async (tx): Promise<RefreshAccessTokenResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${token.integrationId}))`);

    const current = await tx.query.integrationToken.findFirst({
      where: eq(integrationToken.integrationId, token.integrationId),
      orderBy: (table, { desc }) => [desc(table.updatedAt)],
      columns: {
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
      },
    });
    if (!current) {
      throw new Error(`Integration token not found for ${token.type}`);
    }

    const currentToken: TokenWithMetadata = {
      ...token,
      accessToken: current.accessToken,
      refreshToken: current.refreshToken,
      expiresAt: current.expiresAt,
    };

    if (!needsRefresh(currentToken)) {
      return {
        kind: "ok",
        accessToken: currentToken.accessToken,
      };
    }

    if (!currentToken.refreshToken) {
      throw new Error(`No refresh token available for ${token.type} integration`);
    }

    const config = getOAuthConfig(token.type);

    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentToken.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Notion, Airtable, and Reddit require Basic auth header for token refresh
    if (token.type === "notion" || token.type === "airtable" || token.type === "reddit") {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`;
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_id");
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete, not a Drizzle query
      tokenBody.delete("client_secret");
    }

    // Reddit requires User-Agent header for all API calls
    if (token.type === "reddit") {
      headers["User-Agent"] = "cmdclaw-app:v1.0.0 (by /u/cmdclaw-integration)";
    }

    const now = new Date();
    const tokenAge = currentToken.expiresAt
      ? Math.round((now.getTime() - currentToken.expiresAt.getTime()) / 1000 / 60)
      : "unknown";
    console.log(`[Token Refresh] Refreshing ${token.type} token...`);
    console.log(`[Token Refresh] Integration ID: ${token.integrationId}`);
    console.log(
      `[Token Refresh] Token expired at: ${currentToken.expiresAt?.toISOString() ?? "no expiry"}`,
    );
    console.log(`[Token Refresh] Token age (mins past expiry): ${tokenAge}`);
    console.log(
      `[Token Refresh] Refresh token present: ${!!currentToken.refreshToken} (length: ${
        currentToken.refreshToken?.length ?? 0
      })`,
    );

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: tokenBody,
    });

    if (!response.ok) {
      const error = await response.text();
      const classification = classifyOAuthRefreshFailure(token.type, response.status, error);
      console.error(`[Token Refresh] Failed to refresh ${token.type} token:`, error);
      console.error(
        `[Token Refresh] Failure classification for ${token.type}: ${classification.type}`,
      );

      if (classification.type === "definitive_auth_failure") {
        await tx
          .update(integration)
          .set({
            enabled: false,
            authStatus: "reauth_required",
            authErrorCode: classification.code,
            authErrorAt: new Date(),
            authErrorDetail: classification.detail,
            updatedAt: new Date(),
          })
          .where(eq(integration.id, token.integrationId));

        await tx
          .delete(integrationToken)
          .where(eq(integrationToken.integrationId, token.integrationId));

        console.warn(
          `[Token Refresh] Disabled ${token.type} integration ${token.integrationId}; reauth required`,
        );
      } else if (classification.type === "transient_failure") {
        await tx
          .update(integration)
          .set({
            authStatus: "transient_error",
            authErrorCode: classification.code,
            authErrorAt: new Date(),
            authErrorDetail: classification.detail,
            updatedAt: new Date(),
          })
          .where(eq(integration.id, token.integrationId));
      }

      return {
        kind: "error",
        message: `Failed to refresh ${token.type} token: ${error}`,
      };
    }

    const tokens = await response.json();

    const newAccessToken = tokens.access_token;
    const newRefreshToken = tokens.refresh_token || currentToken.refreshToken; // Some providers return new refresh token
    const expiresIn = tokens.expires_in;

    if (!newAccessToken) {
      return {
        kind: "error",
        message: `No access token in refresh response for ${token.type}`,
      };
    }

    // Update tokens in database
    await tx
      .update(integrationToken)
      .set({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        updatedAt: new Date(),
      })
      .where(eq(integrationToken.integrationId, token.integrationId));

    await tx
      .update(integration)
      .set({
        authStatus: "connected",
        authErrorCode: null,
        authErrorAt: null,
        authErrorDetail: null,
        updatedAt: new Date(),
      })
      .where(eq(integration.id, token.integrationId));

    console.log(`[Token Refresh] Successfully refreshed ${token.type} token`);

    return {
      kind: "ok",
      accessToken: newAccessToken,
    };
  });

  if (result.kind === "error") {
    throw new Error(result.message);
  }

  return result.accessToken;
}

/**
 * Get a valid access token for an integration, refreshing if necessary
 */
export async function getValidAccessToken(token: TokenWithMetadata): Promise<string> {
  if (!needsRefresh(token)) {
    return token.accessToken;
  }

  return await refreshAccessToken(token);
}

/**
 * Get valid access tokens for all enabled integrations for a user,
 * refreshing any that are expired or about to expire
 */
export async function getValidTokensForUser(
  userId: string,
  integrationTypes?: readonly IntegrationType[],
): Promise<Map<IntegrationType, string>> {
  const results = await db
    .select({
      type: integration.type,
      accessToken: integrationToken.accessToken,
      refreshToken: integrationToken.refreshToken,
      expiresAt: integrationToken.expiresAt,
      integrationId: integrationToken.integrationId,
      tokenUpdatedAt: integrationToken.updatedAt,
      enabled: integration.enabled,
    })
    .from(integration)
    .innerJoin(integrationToken, eq(integration.id, integrationToken.integrationId))
    .where(eq(integration.userId, userId));

  const tokens = new Map<IntegrationType, string>();
  const allowedTypes = integrationTypes ? new Set(integrationTypes) : null;
  const latestTokenRows = new Map<string, (typeof results)[number]>();

  for (const row of results) {
    if (!row.enabled || !row.accessToken) {
      continue;
    }
    if (allowedTypes && !allowedTypes.has(row.type)) {
      continue;
    }

    const current = latestTokenRows.get(row.integrationId);
    const rowUpdatedAt = row.tokenUpdatedAt?.getTime() ?? 0;
    const currentUpdatedAt = current?.tokenUpdatedAt?.getTime() ?? 0;
    if (!current || rowUpdatedAt >= currentUpdatedAt) {
      latestTokenRows.set(row.integrationId, row);
    }
  }

  // Process tokens in parallel, skipping integrations that fail refresh.
  await Promise.all(
    Array.from(latestTokenRows.values()).map(async (row) => {
      try {
        const validToken = await getValidAccessToken({
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          expiresAt: row.expiresAt,
          integrationId: row.integrationId,
          type: row.type,
        });

        tokens.set(row.type, validToken);
      } catch (error) {
        console.warn(
          `[Token Refresh] Skipping ${row.type} integration ${row.integrationId} due to refresh error:`,
          error,
        );
      }
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
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    })
    .where(eq(customIntegrationCredential.id, credId));

  return newAccessToken;
}

/**
 * Get valid tokens for all custom OAuth integrations, refreshing as needed
 * Returns Map<credentialId, accessToken>
 */
export async function getValidCustomTokens(userId: string): Promise<Map<string, string>> {
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
          if (c.accessToken) {
            tokens.set(c.id, c.accessToken);
          }
          return;
        }

        // Check if needs refresh
        if (c.expiresAt && Date.now() >= c.expiresAt.getTime() - EXPIRY_BUFFER_MS) {
          const newToken = await refreshCustomToken(
            c.id,
            c.accessToken!,
            c.refreshToken,
            oauth,
            c.clientId,
            c.clientSecret,
          );
          tokens.set(c.id, newToken);
        } else if (c.accessToken) {
          tokens.set(c.id, c.accessToken);
        }
      }),
  );

  return tokens;
}

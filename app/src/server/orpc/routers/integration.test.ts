import { beforeEach, describe, expect, it, vi } from "vitest";

function createProcedureStub() {
  const stub: any = {
    input: vi.fn(() => stub),
    output: vi.fn(() => stub),
    handler: vi.fn((fn: any) => fn),
  };
  return stub;
}

const {
  getOAuthConfigMock,
  generateLinkedInAuthUrlMock,
  encryptMock,
  decryptMock,
} = vi.hoisted(() => ({
  getOAuthConfigMock: vi.fn(),
  generateLinkedInAuthUrlMock: vi.fn(),
  encryptMock: vi.fn((value: string) => `enc:${value}`),
  decryptMock: vi.fn((value: string) => value.replace(/^enc:/, "")),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@/server/integrations/unipile", () => ({
  generateLinkedInAuthUrl: generateLinkedInAuthUrlMock,
  deleteUnipileAccount: vi.fn(),
  getUnipileAccount: vi.fn(),
}));

vi.mock("@/server/lib/encryption", () => ({
  encrypt: encryptMock,
  decrypt: decryptMock,
}));

import { integrationRouter } from "./integration";
const integrationRouterAny = integrationRouter as any;

function encodeState(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function createContext() {
  const insertReturningMock = vi.fn();
  const insertOnConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn(() => ({
    returning: insertReturningMock,
    onConflictDoUpdate: insertOnConflictDoUpdateMock,
  }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock, returning: vi.fn().mockResolvedValue([]) }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteWhereMock = vi.fn();
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock, returning: vi.fn().mockResolvedValue([]) }));

  return {
    user: { id: "user-1" },
    db: {
      query: {
        integration: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        customIntegration: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        customIntegrationCredential: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      insertOnConflictDoUpdateMock,
      updateSetMock,
    },
  } as any;
}

describe("integrationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    generateLinkedInAuthUrlMock.mockResolvedValue("https://linkedin.example.com/auth");

    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      authUrl: "https://oauth.example.com/authorize",
      tokenUrl: "https://oauth.example.com/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["scope:read", "scope:write"],
      getUserInfo: vi.fn(async () => ({
        id: "provider-user",
        displayName: "Provider User",
        metadata: { team: "alpha" },
      })),
    });
  });

  it("builds provider-specific auth URL params (slack user_scope, reddit duration, PKCE)", async () => {
    const context = createContext();

    const slack = await integrationRouterAny.getAuthUrl({
      input: { type: "slack", redirectUrl: "https://app.example.com/integrations" },
      context,
    });
    const slackUrl = new URL(slack.authUrl);
    expect(slackUrl.searchParams.get("user_scope")).toBe("scope:read scope:write");
    expect(slackUrl.searchParams.get("scope")).toBeNull();

    const reddit = await integrationRouterAny.getAuthUrl({
      input: { type: "reddit", redirectUrl: "https://app.example.com/integrations" },
      context,
    });
    const redditUrl = new URL(reddit.authUrl);
    expect(redditUrl.searchParams.get("duration")).toBe("permanent");

    const airtable = await integrationRouterAny.getAuthUrl({
      input: { type: "airtable", redirectUrl: "https://app.example.com/integrations" },
      context,
    });
    const airtableUrl = new URL(airtable.authUrl);
    expect(airtableUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(airtableUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("rejects callback with invalid state and user mismatch", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "abc", state: "invalid-state" },
        context,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const state = encodeState({
      userId: "different-user",
      type: "github",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "abc", state },
        context,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates existing integration instead of inserting a new one", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({ id: "integration-existing" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-existing",
      redirectUrl: "/integrations",
    });

    expect(context.db.update).toHaveBeenCalled();
    expect(context.mocks.insertReturningMock).not.toHaveBeenCalled();
  });

  it("inserts a new integration when one does not exist", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "integration-new" }]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-new",
      redirectUrl: "/integrations",
    });
  });

  it("handles custom integration credential and connectivity flow", async () => {
    const context = createContext();

    await integrationRouterAny.setCustomCredentials({
      input: {
        customIntegrationId: "custom-1",
        clientId: "my-client-id",
        clientSecret: "my-client-secret",
        apiKey: "my-api-key",
        displayName: "My Custom API",
      },
      context,
    });

    expect(encryptMock).toHaveBeenCalledWith("my-client-id");
    expect(encryptMock).toHaveBeenCalledWith("my-client-secret");
    expect(encryptMock).toHaveBeenCalledWith("my-api-key");

    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read", "write"],
        pkce: true,
        authStyle: "params",
      },
    });
    context.db.query.customIntegrationCredential.findFirst
      .mockResolvedValueOnce({
        id: "cred-1",
        customIntegrationId: "custom-1",
        clientId: "enc:my-client-id",
      })
      .mockResolvedValueOnce({
        id: "cred-1",
        customIntegrationId: "custom-1",
        clientId: "enc:my-client-id",
        clientSecret: "enc:my-client-secret",
      });

    const authUrlResult = await integrationRouterAny.getCustomAuthUrl({
      input: {
        slug: "my-custom",
        redirectUrl: "https://app.example.com/integrations/custom",
      },
      context,
    });

    const customAuthUrl = new URL(authUrlResult.authUrl);
    expect(customAuthUrl.searchParams.get("client_id")).toBe("my-client-id");
    expect(customAuthUrl.searchParams.get("code_challenge")).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "custom-access-token",
            refresh_token: "custom-refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const customState = encodeState({
      userId: "user-1",
      type: "custom_my-custom",
      redirectUrl: "/integrations/custom",
      codeVerifier: "verifier-123",
    });

    const callbackResult = await integrationRouterAny.handleCustomCallback({
      input: { code: "custom-code", state: customState },
      context,
    });

    expect(callbackResult).toEqual({ success: true, redirectUrl: "/integrations/custom" });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "custom-access-token",
        refreshToken: "custom-refresh-token",
        enabled: true,
      })
    );
  });
});

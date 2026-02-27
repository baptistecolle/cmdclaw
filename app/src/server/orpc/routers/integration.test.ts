import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNIPILE_MISSING_CREDENTIALS_MESSAGE } from "@/lib/integration-errors";
import { mswServer } from "@/test/msw/server";

function createProcedureStub() {
  const stub = {
    input: vi.fn(),
    output: vi.fn(),
    handler: vi.fn((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  getOAuthConfigMock,
  generateLinkedInAuthUrlMock,
  deleteUnipileAccountMock,
  getUnipileAccountMock,
  encryptMock,
  decryptMock,
} = vi.hoisted(() => ({
  getOAuthConfigMock: vi.fn(),
  generateLinkedInAuthUrlMock: vi.fn(),
  deleteUnipileAccountMock: vi.fn(),
  getUnipileAccountMock: vi.fn(),
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
  deleteUnipileAccount: deleteUnipileAccountMock,
  getUnipileAccount: getUnipileAccountMock,
}));

vi.mock("@/server/lib/encryption", () => ({
  encrypt: encryptMock,
  decrypt: decryptMock,
}));

import { integrationRouter } from "./integration";
const integrationRouterAny = integrationRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

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

  const updateReturningMock = vi.fn().mockResolvedValue([]);
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn().mockResolvedValue([]);
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

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
      updateReturningMock,
      deleteWhereMock,
      deleteReturningMock,
    },
  };
}

describe("integrationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    generateLinkedInAuthUrlMock.mockResolvedValue("https://linkedin.example.com/auth");
    deleteUnipileAccountMock.mockResolvedValue(undefined);
    getUnipileAccountMock.mockResolvedValue({
      name: "LinkedIn Profile",
      identifier: "linkedin-profile",
    });

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

  it("lists integrations with public fields", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.integration.findMany.mockResolvedValue([
      {
        id: "integration-1",
        type: "github",
        displayName: "GitHub",
        enabled: true,
        setupRequired: false,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["repo"],
        createdAt: now,
        providerAccountId: "secret-provider-id",
      },
    ]);

    const result = await integrationRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "integration-1",
        type: "github",
        displayName: "GitHub",
        enabled: true,
        setupRequired: false,
        instanceName: null,
        instanceUrl: null,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["repo"],
        createdAt: now,
      },
    ]);
  });

  it("includes Dynamics environment details in integration list", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.integration.findMany.mockResolvedValue([
      {
        id: "integration-dyn-1",
        type: "dynamics",
        displayName: "user@contoso.com",
        enabled: true,
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["offline_access"],
        createdAt: now,
        metadata: {
          pendingInstanceSelection: false,
          instanceName: "Contoso Prod",
          instanceUrl: "https://org123.api.crm4.dynamics.com",
        },
      },
    ]);

    const result = await integrationRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "integration-dyn-1",
        type: "dynamics",
        displayName: "user@contoso.com",
        enabled: true,
        setupRequired: false,
        instanceName: "Contoso Prod",
        instanceUrl: "https://org123.api.crm4.dynamics.com",
        authStatus: "connected",
        authErrorCode: null,
        scopes: ["offline_access"],
        createdAt: now,
      },
    ]);
  });

  it("builds provider-specific auth URL params (slack user_scope, reddit duration, PKCE)", async () => {
    const context = createContext();

    const slack = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "slack",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const slackUrl = new URL(slack.authUrl);
    expect(slackUrl.searchParams.get("user_scope")).toBe("scope:read scope:write");
    expect(slackUrl.searchParams.get("scope")).toBeNull();

    const reddit = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "reddit",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const redditUrl = new URL(reddit.authUrl);
    expect(redditUrl.searchParams.get("duration")).toBe("permanent");

    const airtable = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "airtable",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const airtableUrl = new URL(airtable.authUrl);
    expect(airtableUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(airtableUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds linkedin auth URL via unipile", async () => {
    const context = createContext();

    const result = await integrationRouterAny.getAuthUrl({
      input: {
        type: "linkedin",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    });

    expect(result).toEqual({ authUrl: "https://linkedin.example.com/auth" });
    expect(generateLinkedInAuthUrlMock).toHaveBeenCalledWith(
      "user-1",
      "https://app.example.com/integrations",
    );
  });

  it("returns explicit error when Unipile credentials are missing for linkedin auth", async () => {
    const context = createContext();
    generateLinkedInAuthUrlMock.mockRejectedValueOnce(
      new Error(UNIPILE_MISSING_CREDENTIALS_MESSAGE),
    );

    await expect(
      integrationRouterAny.getAuthUrl({
        input: {
          type: "linkedin",
          redirectUrl: "https://app.example.com/integrations",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: UNIPILE_MISSING_CREDENTIALS_MESSAGE,
    });
  });

  it("adds google and notion-specific auth params", async () => {
    const context = createContext();

    const google = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "gmail",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const googleUrl = new URL(google.authUrl);
    expect(googleUrl.searchParams.get("access_type")).toBe("offline");
    expect(googleUrl.searchParams.get("prompt")).toBe("consent");

    const notion = (await integrationRouterAny.getAuthUrl({
      input: {
        type: "notion",
        redirectUrl: "https://app.example.com/integrations",
      },
      context,
    })) as { authUrl: string };
    const notionUrl = new URL(notion.authUrl);
    expect(notionUrl.searchParams.get("owner")).toBe("user");
  });

  it("rejects callback with invalid state and user mismatch", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "abc", state: "invalid-state" },
        context,
      }),
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
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses basic auth and user-agent headers for reddit callback", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-existing",
    });

    let headers: Headers | undefined;
    let body: URLSearchParams | undefined;
    mswServer.use(
      http.post("https://oauth.example.com/token", async ({ request }) => {
        headers = request.headers;
        body = new URLSearchParams(await request.text());
        return HttpResponse.json({ access_token: "reddit-access" });
      }),
    );

    const state = encodeState({
      userId: "user-1",
      type: "reddit",
      redirectUrl: "/integrations",
      codeVerifier: "pkce-verifier",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(headers?.get("authorization")).toMatch(/^Basic /);
    expect(headers?.get("user-agent")).toContain("cmdclaw-app");
    expect(body?.get("client_id")).toBeNull();
    expect(body?.get("client_secret")).toBeNull();
    expect(body?.get("code_verifier")).toBe("pkce-verifier");
    expect(result).toEqual({
      success: true,
      integrationId: "integration-existing",
      redirectUrl: "/integrations",
    });
  });

  it("throws when token exchange fails", async () => {
    const context = createContext();

    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () => new HttpResponse("bad oauth request", { status: 400 }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "oauth-code", state },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to exchange code for tokens",
    });
  });

  it("throws when slack callback does not include user token", async () => {
    const context = createContext();

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({ access_token: "bot-token" }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/integrations",
    });

    await expect(
      integrationRouterAny.handleCallback({
        input: { code: "oauth-code", state },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("handles slack callback using authed_user access token", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "integration-slack" }]);

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          authed_user: { access_token: "slack-user-token" },
          refresh_token: "slack-refresh",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/integrations",
    });

    const result = await integrationRouterAny.handleCallback({
      input: { code: "oauth-code", state },
      context,
    });

    expect(result).toEqual({
      success: true,
      integrationId: "integration-slack",
      redirectUrl: "/integrations",
    });
  });

  it("updates existing integration instead of inserting a new one", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-existing",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      ),
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

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      ),
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

  it("toggles integration enabled state", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-1",
      type: "github",
      metadata: null,
    });
    context.mocks.updateReturningMock.mockResolvedValueOnce([{ id: "integration-1" }]);

    const result = await integrationRouterAny.toggle({
      input: { id: "integration-1", enabled: false },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      enabled: false,
    });
  });

  it("throws when toggling a missing integration", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.toggle({
        input: { id: "missing", enabled: true },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("disconnects linkedin integration and deletes unipile account", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-linkedin",
      type: "linkedin",
      providerAccountId: "unipile-123",
    });

    const result = await integrationRouterAny.disconnect({
      input: { id: "integration-linkedin" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(deleteUnipileAccountMock).toHaveBeenCalledWith("unipile-123");
    expect(context.mocks.deleteWhereMock).toHaveBeenCalled();
  });

  it("continues disconnect when unipile account deletion fails", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue({
      id: "integration-linkedin",
      type: "linkedin",
      providerAccountId: "unipile-456",
    });
    deleteUnipileAccountMock.mockRejectedValueOnce(new Error("Unipile down"));

    const result = await integrationRouterAny.disconnect({
      input: { id: "integration-linkedin" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when disconnecting a missing integration", async () => {
    const context = createContext();
    context.db.query.integration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.disconnect({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("links linkedin account with upsert and fallback display name", async () => {
    const context = createContext();
    getUnipileAccountMock.mockResolvedValueOnce({
      name: "",
      identifier: "identifier-only",
    });

    const result = await integrationRouterAny.linkLinkedIn({
      input: { accountId: "unipile-account" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "linkedin",
        providerAccountId: "unipile-account",
        displayName: "identifier-only",
      }),
    );
    expect(context.mocks.insertOnConflictDoUpdateMock).toHaveBeenCalled();
  });

  it("throws when linkedin account linking fails", async () => {
    const context = createContext();
    getUnipileAccountMock.mockRejectedValueOnce(new Error("not found"));

    await expect(
      integrationRouterAny.linkLinkedIn({
        input: { accountId: "bad-account" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to link LinkedIn account",
    });
  });

  it("creates custom integration and stores encrypted credentials", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "custom-1", slug: "custom-api" }]);

    const result = await integrationRouterAny.createCustomIntegration({
      input: {
        slug: "custom-api",
        name: "Custom API",
        description: "Custom integration",
        iconUrl: "https://example.com/icon.svg",
        baseUrl: "https://api.example.com",
        authType: "oauth2",
        oauthConfig: {
          authUrl: "https://api.example.com/oauth/authorize",
          tokenUrl: "https://api.example.com/oauth/token",
          scopes: ["read", "write"],
          pkce: true,
          authStyle: "params",
          extraAuthParams: { audience: "users" },
        },
        apiKeyConfig: null,
        cliCode: "console.log('hello')",
        cliInstructions: "Run the command",
        permissions: { readOps: ["users.read"], writeOps: ["users.write"] },
        clientId: "client-id",
        clientSecret: "client-secret",
        apiKey: "api-key",
      },
      context,
    });

    expect(result).toEqual({ id: "custom-1", slug: "custom-api" });
    expect(encryptMock).toHaveBeenCalledWith("client-id");
    expect(encryptMock).toHaveBeenCalledWith("client-secret");
    expect(encryptMock).toHaveBeenCalledWith("api-key");
    expect(context.mocks.insertValuesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customIntegrationId: "custom-1",
        clientId: "enc:client-id",
        clientSecret: "enc:client-secret",
        apiKey: "enc:api-key",
      }),
    );
  });

  it("creates custom integration without creating credentials when none are provided", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);
    context.mocks.insertReturningMock.mockResolvedValue([
      { id: "custom-2", slug: "custom-no-creds" },
    ]);

    const result = await integrationRouterAny.createCustomIntegration({
      input: {
        slug: "custom-no-creds",
        name: "No Credential API",
        description: "No creds required",
        iconUrl: null,
        baseUrl: "https://api.example.com",
        authType: "api_key",
        oauthConfig: null,
        apiKeyConfig: { method: "header", headerName: "x-api-key" },
        cliCode: "",
        cliInstructions: "",
        permissions: { readOps: [], writeOps: [] },
        clientId: null,
        clientSecret: null,
        apiKey: null,
      },
      context,
    });

    expect(result).toEqual({ id: "custom-2", slug: "custom-no-creds" });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate custom integration slug", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "existing",
    });

    await expect(
      integrationRouterAny.createCustomIntegration({
        input: {
          slug: "custom-api",
          name: "Custom API",
          description: "Custom integration",
          iconUrl: null,
          baseUrl: "https://api.example.com",
          authType: "oauth2",
          oauthConfig: null,
          apiKeyConfig: null,
          cliCode: "",
          cliInstructions: "",
          permissions: { readOps: [], writeOps: [] },
          clientId: null,
          clientSecret: null,
          apiKey: null,
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists custom integrations with connection status", async () => {
    const context = createContext();
    context.db.query.customIntegration.findMany.mockResolvedValue([
      {
        id: "custom-1",
        slug: "first",
        name: "First",
        description: "First integration",
        iconUrl: null,
        baseUrl: "https://one.example.com",
        authType: "oauth2",
        isBuiltIn: false,
        communityStatus: null,
        communityPrUrl: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "custom-2",
        slug: "second",
        name: "Second",
        description: "Second integration",
        iconUrl: null,
        baseUrl: "https://two.example.com",
        authType: "api_key",
        isBuiltIn: true,
        communityStatus: "merged",
        communityPrUrl: "https://github.com/org/repo/pull/1",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
    context.db.query.customIntegrationCredential.findMany.mockResolvedValue([
      {
        id: "cred-1",
        customIntegrationId: "custom-1",
        enabled: true,
        displayName: "Connected First",
      },
    ]);

    const result = await integrationRouterAny.listCustomIntegrations({
      context,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "custom-1",
        connected: true,
        enabled: true,
        displayName: "Connected First",
      }),
      expect.objectContaining({
        id: "custom-2",
        connected: false,
        enabled: false,
        displayName: null,
      }),
    ]);
  });

  it("gets custom integration details with credential flags", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      name: "My Custom",
      description: "desc",
      authType: "oauth2",
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: "enc:id",
      clientSecret: "enc:secret",
      apiKey: "enc:key",
      enabled: true,
      displayName: "My Account",
    });

    const result = await integrationRouterAny.getCustomIntegration({
      input: { slug: "my-custom" },
      context,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "custom-1",
        connected: true,
        enabled: true,
        displayName: "My Account",
        hasClientId: true,
        hasClientSecret: true,
        hasApiKey: true,
      }),
    );
  });

  it("throws when custom integration is not found", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.getCustomIntegration({
        input: { slug: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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

    const authUrlResult = (await integrationRouterAny.getCustomAuthUrl({
      input: {
        slug: "my-custom",
        redirectUrl: "https://app.example.com/integrations/custom",
      },
      context,
    })) as { authUrl: string };

    const customAuthUrl = new URL(authUrlResult.authUrl);
    expect(customAuthUrl.searchParams.get("client_id")).toBe("my-client-id");
    expect(customAuthUrl.searchParams.get("code_challenge")).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "custom-access-token",
              refresh_token: "custom-refresh-token",
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
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

    expect(callbackResult).toEqual({
      success: true,
      redirectUrl: "/integrations/custom",
    });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "custom-access-token",
        refreshToken: "custom-refresh-token",
        enabled: true,
      }),
    );
  });

  it("disconnects custom integration credentials", async () => {
    const context = createContext();

    const result = await integrationRouterAny.disconnectCustomIntegration({
      input: { customIntegrationId: "custom-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.deleteWhereMock).toHaveBeenCalled();
  });

  it("toggles custom integration credentials", async () => {
    const context = createContext();
    context.mocks.updateReturningMock.mockResolvedValueOnce([{ id: "cred-1" }]);

    const result = await integrationRouterAny.toggleCustomIntegration({
      input: { customIntegrationId: "custom-1", enabled: false },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when toggling missing custom credentials", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.toggleCustomIntegration({
        input: { customIntegrationId: "missing", enabled: true },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes a custom integration owned by the user", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValueOnce([{ id: "custom-1" }]);

    const result = await integrationRouterAny.deleteCustomIntegration({
      input: { id: "custom-1" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("throws when deleting a missing custom integration", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.deleteCustomIntegration({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects invalid OAuth custom integrations for auth URL", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "api_key",
      oauthConfig: null,
    });

    await expect(
      integrationRouterAny.getCustomAuthUrl({
        input: {
          slug: "my-custom",
          redirectUrl: "https://app.example.com/custom",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects custom auth URL when credentials are missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        pkce: false,
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: null,
    });

    await expect(
      integrationRouterAny.getCustomAuthUrl({
        input: {
          slug: "my-custom",
          redirectUrl: "https://app.example.com/custom",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("adds extra auth params for custom OAuth URL", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      authType: "oauth2",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        pkce: false,
        extraAuthParams: {
          audience: "users",
          approval_prompt: "force",
        },
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
    });

    const result = (await integrationRouterAny.getCustomAuthUrl({
      input: {
        slug: "my-custom",
        redirectUrl: "https://app.example.com/custom",
      },
      context,
    })) as { authUrl: string };

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get("audience")).toBe("users");
    expect(authUrl.searchParams.get("approval_prompt")).toBe("force");
    expect(authUrl.searchParams.get("code_challenge")).toBeNull();
  });

  it("validates state and identity in custom callback", async () => {
    const context = createContext();

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: { code: "code", state: "bad-state" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "someone-else",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws when custom callback integration is missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue(null);

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_missing",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws when custom callback credentials are missing", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      clientId: "enc:client-id",
      clientSecret: null,
    });

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uses header auth style for custom callback token exchange", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        authStyle: "header",
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
      clientSecret: "enc:client-secret",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mswServer.use(
      http.post(/.*/, () => HttpResponse.json({ access_token: "token" }), { once: true }),
    );

    const result = await integrationRouterAny.handleCustomCallback({
      input: {
        code: "code",
        state: encodeState({
          userId: "user-1",
          type: "custom_my-custom",
          redirectUrl: "/custom",
        }),
      },
      context,
    });

    const requestInit = (fetchSpy.mock.calls as unknown[][])[0]?.[1] as RequestInit | undefined;
    const headers = requestInit?.headers as Record<string, string> | undefined;
    const body = requestInit?.body as URLSearchParams | undefined;

    expect(headers?.Authorization).toMatch(/^Basic /);
    expect(body?.get("client_id")).toBeNull();
    expect(body?.get("client_secret")).toBeNull();
    expect(result).toEqual({ success: true, redirectUrl: "/custom" });
    fetchSpy.mockRestore();
  });

  it("throws when custom callback token exchange fails", async () => {
    const context = createContext();
    context.db.query.customIntegration.findFirst.mockResolvedValue({
      id: "custom-1",
      slug: "my-custom",
      oauthConfig: {
        authUrl: "https://custom.example.com/oauth/authorize",
        tokenUrl: "https://custom.example.com/oauth/token",
        scopes: ["read"],
        authStyle: "params",
      },
    });
    context.db.query.customIntegrationCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      customIntegrationId: "custom-1",
      clientId: "enc:client-id",
      clientSecret: "enc:client-secret",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("token exchange failed", { status: 401 }),
    );

    await expect(
      integrationRouterAny.handleCustomCallback({
        input: {
          code: "code",
          state: encodeState({
            userId: "user-1",
            type: "custom_my-custom",
            redirectUrl: "/custom",
          }),
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to exchange code for tokens",
    });
  });
});

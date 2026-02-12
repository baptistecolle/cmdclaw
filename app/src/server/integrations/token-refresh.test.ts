import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateWhereMock,
  updateSetMock,
  updateMock,
  selectWhereMock,
  selectInnerJoinMock,
  selectFromMock,
  selectMock,
  findManyMock,
  dbMock,
  getOAuthConfigMock,
  decryptMock,
} = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const selectWhereMock = vi.fn();
  const selectInnerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectFromMock = vi.fn(() => ({ innerJoin: selectInnerJoinMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));
  const findManyMock = vi.fn();
  const decryptMock = vi.fn((value: string) => value);

  const dbMock = {
    update: updateMock,
    select: selectMock,
    query: {
      customIntegrationCredential: {
        findMany: findManyMock,
      },
    },
  };

  const getOAuthConfigMock = vi.fn();

  return {
    updateWhereMock,
    updateSetMock,
    updateMock,
    selectWhereMock,
    selectInnerJoinMock,
    selectFromMock,
    selectMock,
    findManyMock,
    dbMock,
    getOAuthConfigMock,
    decryptMock,
  };
});

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@/server/lib/encryption", () => ({
  decrypt: decryptMock,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(() => ({ kind: "eq" })),
    and: vi.fn(() => ({ kind: "and" })),
  };
});

import {
  getValidAccessToken,
  getValidTokensForUser,
  getValidCustomTokens,
} from "./token-refresh";

function mockFetchOk(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

describe("token-refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00.000Z"));
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());

    updateWhereMock.mockResolvedValue(undefined);
    selectWhereMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([]);
    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenUrl: "https://oauth.example.com/token",
    });
  });

  it("returns current token when refresh is not needed", async () => {
    const token = await getValidAccessToken({
      accessToken: "current-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      integrationId: "int-1",
      type: "github",
    });

    expect(token).toBe("current-token");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns current token when expiry is not set", async () => {
    const token = await getValidAccessToken({
      accessToken: "current-token",
      refreshToken: "refresh-token",
      expiresAt: null,
      integrationId: "int-1",
      type: "github",
    });

    expect(token).toBe("current-token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes at the expiry buffer edge", async () => {
    mockFetchOk({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    });

    const token = await getValidAccessToken({
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      integrationId: "int-2",
      type: "github",
    });

    expect(token).toBe("new-access-token");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, options] = fetchMock.mock.calls[0]!;
    const body = options?.body as URLSearchParams;

    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");

    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      }),
    );
  });

  it("uses provider-specific refresh headers for notion, airtable, and reddit", async () => {
    mockFetchOk({ access_token: "new-token" });

    await getValidAccessToken({
      accessToken: "old-notion",
      refreshToken: "refresh-notion",
      expiresAt: new Date(Date.now() - 1),
      integrationId: "int-notion",
      type: "notion",
    });

    await getValidAccessToken({
      accessToken: "old-airtable",
      refreshToken: "refresh-airtable",
      expiresAt: new Date(Date.now() - 1),
      integrationId: "int-airtable",
      type: "airtable",
    });

    await getValidAccessToken({
      accessToken: "old-reddit",
      refreshToken: "refresh-reddit",
      expiresAt: new Date(Date.now() - 1),
      integrationId: "int-reddit",
      type: "reddit",
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    for (const [index, provider] of [
      "notion",
      "airtable",
      "reddit",
    ].entries()) {
      const [, options] = fetchMock.mock.calls[index]!;
      const headers = options?.headers as Record<string, string>;
      const body = options?.body as URLSearchParams;

      expect(headers.Authorization).toMatch(/^Basic /);
      expect(body.get("client_id")).toBeNull();
      expect(body.get("client_secret")).toBeNull();

      if (provider === "reddit") {
        expect(headers["User-Agent"]).toContain("bap-app:v1.0.0");
      }
    }
  });

  it("falls back to the existing token when refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("oauth failed", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const token = await getValidAccessToken({
      accessToken: "existing-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000),
      integrationId: "int-3",
      type: "github",
    });

    expect(token).toBe("existing-token");
  });

  it("falls back to existing token when refresh token is missing", async () => {
    const token = await getValidAccessToken({
      accessToken: "existing-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() - 1000),
      integrationId: "int-4",
      type: "github",
    });

    expect(token).toBe("existing-token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to existing token when provider response is missing access token", async () => {
    mockFetchOk({ refresh_token: "new-refresh-token", expires_in: 3600 });

    const token = await getValidAccessToken({
      accessToken: "existing-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000),
      integrationId: "int-5",
      type: "github",
    });

    expect(token).toBe("existing-token");
  });

  it("returns tokens only for enabled integrations", async () => {
    selectWhereMock.mockResolvedValue([
      {
        type: "slack",
        accessToken: "slack-token",
        refreshToken: "slack-refresh",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        integrationId: "slack-int",
        enabled: true,
      },
      {
        type: "github",
        accessToken: "github-token",
        refreshToken: "github-refresh",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        integrationId: "github-int",
        enabled: false,
      },
      {
        type: "notion",
        accessToken: null,
        refreshToken: "notion-refresh",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        integrationId: "notion-int",
        enabled: true,
      },
    ]);

    const tokens = await getValidTokensForUser("user-1");

    expect(tokens.size).toBe(1);
    expect(tokens.get("slack")).toBe("slack-token");
    expect(tokens.has("github")).toBe(false);
    expect(tokens.has("notion")).toBe(false);
  });

  it("returns current custom oauth token when not expiring soon", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "cred-future",
        accessToken: "future-token",
        refreshToken: "future-refresh",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        clientId: "enc-client-id",
        clientSecret: "enc-client-secret",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: {
            tokenUrl: "https://custom.example.com/token",
          },
        },
      },
      {
        id: "cred-api-key",
        accessToken: "api-key-token",
        refreshToken: null,
        expiresAt: null,
        clientId: null,
        clientSecret: null,
        customIntegration: {
          authType: "api_key",
          oauthConfig: null,
        },
      },
    ]);

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.size).toBe(1);
    expect(tokens.get("cred-future")).toBe("future-token");
    expect(tokens.has("cred-api-key")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes expiring custom oauth token with params auth", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "cred-expired",
        accessToken: "old-custom-token",
        refreshToken: "old-custom-refresh",
        expiresAt: new Date(Date.now() - 1000),
        clientId: "enc-client-id",
        clientSecret: "enc-client-secret",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: {
            tokenUrl: "https://custom.example.com/token",
            authStyle: "params",
          },
        },
      },
    ]);
    mockFetchOk({
      access_token: "new-custom-token",
      expires_in: 1800,
    });

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-expired")).toBe("new-custom-token");
    expect(decryptMock).toHaveBeenCalledWith("enc-client-id");
    expect(decryptMock).toHaveBeenCalledWith("enc-client-secret");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, options] = fetchMock.mock.calls[0]!;
    const headers = options?.headers as Record<string, string>;
    const body = options?.body as URLSearchParams;

    expect(headers.Authorization).toBeUndefined();
    expect(body.get("client_id")).toBe("enc-client-id");
    expect(body.get("client_secret")).toBe("enc-client-secret");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-custom-token",
        refreshToken: "old-custom-refresh",
      }),
    );
  });

  it("refreshes expiring custom oauth token with header auth", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "cred-header",
        accessToken: "old-header-token",
        refreshToken: "old-header-refresh",
        expiresAt: new Date(Date.now() - 1000),
        clientId: "enc-client-id-header",
        clientSecret: "enc-client-secret-header",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: {
            tokenUrl: "https://custom.example.com/token",
            authStyle: "header",
          },
        },
      },
    ]);
    mockFetchOk({
      access_token: "new-header-token",
      refresh_token: "new-header-refresh",
      expires_in: 3600,
    });

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-header")).toBe("new-header-token");

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, options] = fetchMock.mock.calls[0]!;
    const headers = options?.headers as Record<string, string>;
    const body = options?.body as URLSearchParams;

    expect(headers.Authorization).toMatch(/^Basic /);
    expect(body.get("client_id")).toBeNull();
    expect(body.get("client_secret")).toBeNull();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-header-token",
        refreshToken: "new-header-refresh",
      }),
    );
  });

  it("falls back to stored custom token when custom refresh fails", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "cred-fail",
        accessToken: "existing-custom-token",
        refreshToken: "refresh-custom-token",
        expiresAt: new Date(Date.now() - 1000),
        clientId: "enc-client-id",
        clientSecret: "enc-client-secret",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: {
            tokenUrl: "https://custom.example.com/token",
          },
        },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("invalid_grant", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-fail")).toBe("existing-custom-token");
  });

  it("keeps custom token when oauth metadata is incomplete", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "cred-no-refresh",
        accessToken: "existing-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() - 1000),
        clientId: "enc-client-id",
        clientSecret: "enc-client-secret",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: {
            tokenUrl: "https://custom.example.com/token",
          },
        },
      },
      {
        id: "cred-no-oauth-config",
        accessToken: "existing-token-2",
        refreshToken: "refresh-token-2",
        expiresAt: new Date(Date.now() - 1000),
        clientId: "enc-client-id-2",
        clientSecret: "enc-client-secret-2",
        customIntegration: {
          authType: "oauth2",
          oauthConfig: null,
        },
      },
    ]);

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-no-refresh")).toBe("existing-token");
    expect(tokens.get("cred-no-oauth-config")).toBe("existing-token-2");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

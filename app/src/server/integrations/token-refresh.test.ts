import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "@/test/msw/server";

const {
  updateMock,
  updateSetMock,
  updateWhereMock,
  deleteWhereMock,
  executeMock,
  selectWhereMock,
  findManyMock,
  integrationTokenFindFirstMock,
  dbMock,
  getOAuthConfigMock,
  decryptMock,
} = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const deleteWhereMock = vi.fn();
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
  const executeMock = vi.fn();

  const selectWhereMock = vi.fn();
  const selectInnerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectFromMock = vi.fn(() => ({ innerJoin: selectInnerJoinMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));
  const findManyMock = vi.fn();
  const integrationTokenFindFirstMock = vi.fn();
  const decryptMock = vi.fn((value: string) => value);

  const txMock = {
    update: updateMock,
    delete: deleteMock,
    execute: executeMock,
    query: {
      integrationToken: {
        findFirst: integrationTokenFindFirstMock,
      },
    },
  };

  const dbMock = {
    update: updateMock,
    delete: deleteMock,
    execute: executeMock,
    select: selectMock,
    transaction: vi.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) => await fn(txMock)),
    query: {
      integrationToken: {
        findFirst: integrationTokenFindFirstMock,
      },
      customIntegrationCredential: {
        findMany: findManyMock,
      },
    },
  };

  const getOAuthConfigMock = vi.fn();

  return {
    updateMock,
    updateSetMock,
    updateWhereMock,
    deleteWhereMock,
    executeMock,
    selectWhereMock,
    findManyMock,
    integrationTokenFindFirstMock,
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

import { getValidAccessToken, getValidTokensForUser, getValidCustomTokens } from "./token-refresh";

let fetchSpy: ReturnType<typeof vi.spyOn>;

function mockTokenResponse(payload: Parameters<typeof HttpResponse.json>[0], status = 200) {
  mswServer.use(
    http.post("https://oauth.example.com/token", () => HttpResponse.json(payload, { status })),
  );
}

describe("token-refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00.000Z"));
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");

    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    executeMock.mockResolvedValue(undefined);
    selectWhereMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([]);
    integrationTokenFindFirstMock.mockResolvedValue({
      accessToken: "db-current-token",
      refreshToken: "db-refresh-token",
      expiresAt: new Date(Date.now() - 1000),
    });
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
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes at the expiry buffer edge", async () => {
    let capturedBody: URLSearchParams | undefined;
    let capturedMethod: string | undefined;
    const capturedHeaders: Record<string, string> = {};

    mswServer.use(
      http.post("https://oauth.example.com/token", async ({ request }) => {
        capturedMethod = request.method;
        for (const [key, value] of request.headers.entries()) {
          capturedHeaders[key] = value;
        }
        capturedBody = new URLSearchParams(await request.text());

        return HttpResponse.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }),
    );

    const token = await getValidAccessToken({
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      integrationId: "int-2",
      type: "github",
    });

    expect(token).toBe("new-access-token");
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(capturedBody?.get("grant_type")).toBe("refresh_token");
    expect(capturedBody?.get("client_id")).toBe("client-id");
    expect(capturedBody?.get("client_secret")).toBe("client-secret");
    expect(executeMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      }),
    );
  });

  it("uses provider-specific refresh headers for notion, airtable, and reddit", async () => {
    const captured: Array<{ headers: Headers; body: URLSearchParams }> = [];
    mswServer.use(
      http.post("https://oauth.example.com/token", async ({ request }) => {
        captured.push({
          headers: request.headers,
          body: new URLSearchParams(await request.text()),
        });
        return HttpResponse.json({ access_token: "new-token" });
      }),
    );

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

    for (const [index] of ["notion", "airtable", "reddit"].entries()) {
      const request = captured[index];
      expect(request).toBeDefined();
      expect(request!.headers.get("authorization")).toMatch(/^Basic /);
      expect(request!.body.get("client_id")).toBeNull();
      expect(request!.body.get("client_secret")).toBeNull();
    }

    const redditRequest = captured[2];
    expect(redditRequest).toBeDefined();
    expect(redditRequest!.headers.get("user-agent")).toContain("cmdclaw-app:v1.0.0");
  });

  it("throws when refresh fails", async () => {
    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () =>
          new HttpResponse("oauth failed", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    await expect(
      getValidAccessToken({
        accessToken: "existing-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 1000),
        integrationId: "int-3",
        type: "github",
      }),
    ).rejects.toThrow("Failed to refresh github token: oauth failed");
  });

  it("disables integration and clears tokens on definitive auth failure", async () => {
    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () =>
          new HttpResponse(
            JSON.stringify({ error: "invalid_grant", error_description: "revoked" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );

    await expect(
      getValidAccessToken({
        accessToken: "existing-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 1000),
        integrationId: "int-definitive",
        type: "airtable",
      }),
    ).rejects.toThrow("Failed to refresh airtable token");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        authStatus: "reauth_required",
        authErrorCode: "invalid_grant",
      }),
    );
    expect(deleteWhereMock).toHaveBeenCalledOnce();
  });

  it("keeps integration enabled on transient refresh failure", async () => {
    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () =>
          new HttpResponse("service unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    await expect(
      getValidAccessToken({
        accessToken: "existing-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 1000),
        integrationId: "int-transient",
        type: "github",
      }),
    ).rejects.toThrow("Failed to refresh github token: service unavailable");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authStatus: "transient_error",
      }),
    );
    expect(updateSetMock).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it("throws when refresh token is missing", async () => {
    await expect(
      getValidAccessToken({
        accessToken: "existing-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() - 1000),
        integrationId: "int-4",
        type: "github",
      }),
    ).rejects.toThrow("No refresh token available for github integration");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when provider response is missing access token", async () => {
    mockTokenResponse({ refresh_token: "new-refresh-token", expires_in: 3600 });

    await expect(
      getValidAccessToken({
        accessToken: "existing-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() - 1000),
        integrationId: "int-5",
        type: "github",
      }),
    ).rejects.toThrow("No access token in refresh response for github");
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
    expect(fetchSpy).not.toHaveBeenCalled();
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
    let capturedHeaders: Headers | undefined;
    let capturedBody: URLSearchParams | undefined;

    mswServer.use(
      http.post("https://custom.example.com/token", async ({ request }) => {
        capturedHeaders = request.headers;
        capturedBody = new URLSearchParams(await request.text());
        return HttpResponse.json({
          access_token: "new-custom-token",
          expires_in: 1800,
        });
      }),
    );

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-expired")).toBe("new-custom-token");
    expect(decryptMock).toHaveBeenCalledWith("enc-client-id");
    expect(decryptMock).toHaveBeenCalledWith("enc-client-secret");
    expect(capturedHeaders?.get("authorization")).toBeNull();
    expect(capturedBody?.get("client_id")).toBe("enc-client-id");
    expect(capturedBody?.get("client_secret")).toBe("enc-client-secret");
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
    let capturedHeaders: Headers | undefined;
    let capturedBody: URLSearchParams | undefined;

    mswServer.use(
      http.post("https://custom.example.com/token", async ({ request }) => {
        capturedHeaders = request.headers;
        capturedBody = new URLSearchParams(await request.text());
        return HttpResponse.json({
          access_token: "new-header-token",
          refresh_token: "new-header-refresh",
          expires_in: 3600,
        });
      }),
    );

    const tokens = await getValidCustomTokens("user-1");

    expect(tokens.get("cred-header")).toBe("new-header-token");
    expect(capturedHeaders?.get("authorization")).toMatch(/^Basic /);
    expect(capturedBody?.get("client_id")).toBeNull();
    expect(capturedBody?.get("client_secret")).toBeNull();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-header-token",
        refreshToken: "new-header-refresh",
      }),
    );
  });

  it("throws when custom refresh fails", async () => {
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
    mswServer.use(
      http.post(
        "https://custom.example.com/token",
        () =>
          new HttpResponse("invalid_grant", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    await expect(getValidCustomTokens("user-1")).rejects.toThrow(
      "Failed to refresh custom token: invalid_grant",
    );
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

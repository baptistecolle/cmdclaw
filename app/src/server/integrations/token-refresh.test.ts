import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateWhereMock,
  updateSetMock,
  updateMock,
  selectWhereMock,
  selectInnerJoinMock,
  selectFromMock,
  selectMock,
  dbMock,
  getOAuthConfigMock,
} = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const selectWhereMock = vi.fn();
  const selectInnerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectFromMock = vi.fn(() => ({ innerJoin: selectInnerJoinMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const dbMock = {
    update: updateMock,
    select: selectMock,
    query: {
      customIntegrationCredential: {
        findMany: vi.fn(),
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
    dbMock,
    getOAuthConfigMock,
  };
});

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

vi.mock("@/server/lib/encryption", () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(() => ({ kind: "eq" })),
    and: vi.fn(() => ({ kind: "and" })),
  };
});

import { getValidAccessToken, getValidTokensForUser } from "./token-refresh";

function mockFetchOk(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
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
      })
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

    for (const [index, provider] of ["notion", "airtable", "reddit"].entries()) {
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
      vi.fn(async () =>
        new Response("oauth failed", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        })
      )
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
});

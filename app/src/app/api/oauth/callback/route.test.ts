import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  getOAuthConfigMock,
  integrationFindFirstMock,
  updateWhereMock,
  updateSetMock,
  updateMock,
  deleteWhereMock,
  deleteMock,
  insertReturningMock,
  insertValuesMock,
  insertMock,
  dbMock,
} = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const getOAuthConfigMock = vi.fn();

  const integrationFindFirstMock = vi.fn();

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteWhereMock = vi.fn();
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const dbMock = {
    query: {
      integration: {
        findFirst: integrationFindFirstMock,
      },
    },
    update: updateMock,
    delete: deleteMock,
    insert: insertMock,
  };

  return {
    getSessionMock,
    getOAuthConfigMock,
    integrationFindFirstMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
    deleteWhereMock,
    deleteMock,
    insertReturningMock,
    insertValuesMock,
    insertMock,
    dbMock,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/oauth/config", () => ({
  getOAuthConfig: getOAuthConfigMock,
}));

import { GET } from "./route";

function encodeState(state: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function getLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("GET /api/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    integrationFindFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([{ id: "integration-1" }]);
    deleteWhereMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());

    getOAuthConfigMock.mockReturnValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenUrl: "https://oauth.example.com/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["scope:one"],
      getUserInfo: vi.fn(async () => ({
        id: "provider-user",
        displayName: "Provider User",
        metadata: { team: "alpha" },
      })),
    });
  });

  it("redirects with missing_params when code/state are missing", async () => {
    const request = new NextRequest("https://app.example.com/api/oauth/callback");

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?error=missing_params");
  });

  it("redirects to login when session is unauthorized", async () => {
    getSessionMock.mockResolvedValue(null);

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${encodeState({ userId: "user-1", type: "github", redirectUrl: "/integrations" })}`
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/login?error=unauthorized");
  });

  it("redirects with invalid_state when state cannot be parsed", async () => {
    const request = new NextRequest(
      "https://app.example.com/api/oauth/callback?code=abc&state=not-base64-json"
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?error=invalid_state");
  });

  it("redirects with user_mismatch when callback state user does not match session", async () => {
    const state = encodeState({
      userId: "another-user",
      type: "github",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?error=user_mismatch");
  });

  it("redirects with token_exchange_failed when token exchange fails", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "github",
      redirectUrl: "/integrations",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("bad exchange", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?error=token_exchange_failed");
  });

  it("parses Slack authed_user tokens", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/settings/integrations",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authed_user: { access_token: "xoxp-user-token", refresh_token: "refresh" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/settings/integrations?success=true");

    const tokenInsertCall = (insertValuesMock.mock.calls as any[]).find(
      (call) => call[0] && typeof call[0] === "object" && "accessToken" in call[0]
    );
    expect(tokenInsertCall?.[0]).toEqual(
      expect.objectContaining({
        accessToken: "xoxp-user-token",
        refreshToken: "refresh",
      })
    );
  });

  it("merges Salesforce instance_url into metadata", async () => {
    const getUserInfo = vi.fn(async () => ({
      id: "sf-user",
      displayName: "Salesforce User",
      metadata: { org: "acme" },
    }));

    getOAuthConfigMock.mockReturnValue({
      clientId: "sf-client",
      clientSecret: "sf-secret",
      tokenUrl: "https://login.salesforce.com/services/oauth2/token",
      redirectUri: "https://app.example.com/api/oauth/callback",
      scopes: ["api"],
      getUserInfo,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "sf-access",
            refresh_token: "sf-refresh",
            instance_url: "https://acme.my.salesforce.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    const state = encodeState({
      userId: "user-1",
      type: "salesforce",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?success=true");

    const integrationInsertCall = (insertValuesMock.mock.calls as any[]).find(
      (call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]
    );

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        metadata: {
          org: "acme",
          instanceUrl: "https://acme.my.salesforce.com",
        },
      })
    );
  });
});

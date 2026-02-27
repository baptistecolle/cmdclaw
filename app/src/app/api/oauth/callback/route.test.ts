import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mswServer } from "@/test/msw/server";

const {
  getSessionMock,
  getOAuthConfigMock,
  fetchDynamicsInstancesMock,
  submitAuthResultMock,
  integrationFindFirstMock,
  updateWhereMock,
  deleteWhereMock,
  insertReturningMock,
  insertValuesMock,
  dbMock,
} = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const getOAuthConfigMock = vi.fn();
  const fetchDynamicsInstancesMock = vi.fn();
  const submitAuthResultMock = vi.fn();

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
    fetchDynamicsInstancesMock,
    submitAuthResultMock,
    integrationFindFirstMock,
    updateWhereMock,
    deleteWhereMock,
    insertReturningMock,
    insertValuesMock,
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

vi.mock("@/server/integrations/dynamics", () => ({
  fetchDynamicsInstances: fetchDynamicsInstancesMock,
}));

vi.mock("@/server/services/generation-manager", () => ({
  generationManager: {
    submitAuthResult: submitAuthResultMock,
  },
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
    fetchDynamicsInstancesMock.mockResolvedValue([
      {
        id: "env-1",
        friendlyName: "Prod",
        instanceUrl: "https://acme.crm.dynamics.com",
        apiUrl: "https://acme.crm.dynamics.com/api/data/v9.2",
      },
    ]);
    submitAuthResultMock.mockResolvedValue(true);
    integrationFindFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([{ id: "integration-1" }]);
    deleteWhereMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);

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
      `https://app.example.com/api/oauth/callback?code=abc&state=${encodeState({ userId: "user-1", type: "github", redirectUrl: "/integrations" })}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/login?error=unauthorized");
  });

  it("redirects with invalid_state when state cannot be parsed", async () => {
    const request = new NextRequest(
      "https://app.example.com/api/oauth/callback?code=abc&state=not-base64-json",
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
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
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

    mswServer.use(
      http.post(
        "https://oauth.example.com/token",
        () =>
          new HttpResponse("bad exchange", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/integrations?error=token_exchange_failed",
    );
  });

  it("parses Slack authed_user tokens", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "slack",
      redirectUrl: "/settings/integrations",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          authed_user: {
            access_token: "xoxp-user-token",
            refresh_token: "refresh",
          },
        }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/settings/integrations?success=true",
    );

    const tokenInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "accessToken" in call[0]);
    expect(tokenInsertCall?.[0]).toEqual(
      expect.objectContaining({
        accessToken: "xoxp-user-token",
        refreshToken: "refresh",
      }),
    );
  });

  it("preserves existing redirect query params when appending success", async () => {
    const state = encodeState({
      userId: "user-1",
      type: "google_sheets",
      redirectUrl: "/chat/conv-1?auth_complete=google_sheets&generation_id=gen-1",
    });

    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "sheet-token",
          refresh_token: "sheet-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);
    const location = getLocation(response);

    expect(location).toContain("https://app.example.com/chat/conv-1?");
    expect(location).toContain("auth_complete=google_sheets");
    expect(location).toContain("generation_id=gen-1");
    expect(location).toContain("success=true");
    expect(submitAuthResultMock).toHaveBeenCalledWith("gen-1", "google_sheets", true, "user-1");
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

    mswServer.use(
      http.post("https://login.salesforce.com/services/oauth2/token", () =>
        HttpResponse.json({
          access_token: "sf-access",
          refresh_token: "sf-refresh",
          instance_url: "https://acme.my.salesforce.com",
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "salesforce",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?success=true");

    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        metadata: {
          org: "acme",
          instanceUrl: "https://acme.my.salesforce.com",
        },
      }),
    );
  });

  it("redirects dynamics callback to environment selection and stores pending metadata", async () => {
    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "dyn-access",
          refresh_token: "dyn-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "dynamics",
      redirectUrl: "/integrations",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe("https://app.example.com/integrations?dynamics_select=true");
    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        metadata: expect.objectContaining({
          pendingInstanceSelection: true,
        }),
      }),
    );
    expect(submitAuthResultMock).not.toHaveBeenCalled();
  });

  it("completes dynamics instance-scoped callback and enables integration", async () => {
    mswServer.use(
      http.post("https://oauth.example.com/token", () =>
        HttpResponse.json({
          access_token: "dyn-instance-access",
          refresh_token: "dyn-instance-refresh",
          expires_in: 3600,
        }),
      ),
    );

    const state = encodeState({
      userId: "user-1",
      type: "dynamics",
      redirectUrl: "/integrations?auth_complete=dynamics&generation_id=gen-1",
      dynamicsInstanceUrl: "https://org123.api.crm4.dynamics.com",
      dynamicsInstanceName: "Contoso Prod",
    });

    const request = new NextRequest(
      `https://app.example.com/api/oauth/callback?code=abc&state=${state}`,
    );

    const response = await GET(request);

    expect(getLocation(response)).toBe(
      "https://app.example.com/integrations?auth_complete=dynamics&generation_id=gen-1&success=true",
    );
    expect(fetchDynamicsInstancesMock).not.toHaveBeenCalled();
    const integrationInsertCall = (
      insertValuesMock.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).find((call) => call[0] && typeof call[0] === "object" && "providerAccountId" in call[0]);

    expect(integrationInsertCall?.[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        scopes: expect.arrayContaining(["https://org123.api.crm4.dynamics.com/user_impersonation"]),
        metadata: expect.objectContaining({
          pendingInstanceSelection: false,
          instanceUrl: "https://org123.api.crm4.dynamics.com",
          instanceName: "Contoso Prod",
        }),
      }),
    );
    expect(submitAuthResultMock).toHaveBeenCalledWith("gen-1", "dynamics", true, "user-1");
  });
});

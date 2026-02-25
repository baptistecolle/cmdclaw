import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, findFirstMock, updateWhereMock, submitAuthResultMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const findFirstMock = vi.fn();
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const submitAuthResultMock = vi.fn();

  return {
    getSessionMock,
    findFirstMock,
    updateWhereMock,
    submitAuthResultMock,
    dbMock: {
      query: {
        integration: {
          findFirst: findFirstMock,
        },
      },
      update: updateMock,
    },
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
  db: {
    query: {
      integration: {
        findFirst: findFirstMock,
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: updateWhereMock })),
    })),
  },
}));

vi.mock("@/server/services/generation-manager", () => ({
  generationManager: {
    submitAuthResult: submitAuthResultMock,
  },
}));

import { GET, POST } from "./route";

describe("Dynamics pending selection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findFirstMock.mockResolvedValue({
      id: "integration-1",
      metadata: {
        pendingInstanceSelection: true,
        availableInstances: [
          {
            id: "env-1",
            friendlyName: "Prod",
            instanceUrl: "https://acme.crm.dynamics.com",
            apiUrl: "https://acme.crm.dynamics.com/api/data/v9.2",
          },
        ],
      },
    });
    updateWhereMock.mockResolvedValue(undefined);
    submitAuthResultMock.mockResolvedValue(true);
  });

  it("returns unauthorized when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await GET(new Request("https://app.example.com/api/oauth/dynamics/pending"));

    expect(response.status).toBe(401);
  });

  it("returns pending instances", async () => {
    const response = await GET(new Request("https://app.example.com/api/oauth/dynamics/pending"));
    const payload = (await response.json()) as { instances: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.instances).toHaveLength(1);
    expect(payload.instances[0]?.id).toBe("env-1");
  });

  it("completes selection and resumes auth when generation is provided", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/oauth/dynamics/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceUrl: "https://acme.crm.dynamics.com",
          generationId: "gen-1",
          integration: "dynamics",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(submitAuthResultMock).toHaveBeenCalledWith("gen-1", "dynamics", true, "user-1");
  });
});

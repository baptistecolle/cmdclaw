import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { generationFindFirstMock, conversationFindFirstMock, dbMock, generationManagerMock } =
  vi.hoisted(() => {
    const generationFindFirstMock = vi.fn();
    const conversationFindFirstMock = vi.fn();

    const dbMock = {
      query: {
        generation: {
          findFirst: generationFindFirstMock,
        },
        conversation: {
          findFirst: conversationFindFirstMock,
        },
      },
    };

    const generationManagerMock = {
      startGeneration: vi.fn(),
      subscribeToGeneration: vi.fn(),
      cancelGeneration: vi.fn(),
      submitApproval: vi.fn(),
      submitAuthResult: vi.fn(),
      getGenerationStatus: vi.fn(),
      getGenerationForConversation: vi.fn(),
    };

    return {
      generationFindFirstMock,
      conversationFindFirstMock,
      dbMock,
      generationManagerMock,
    };
  });

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/services/generation-manager", () => ({
  generationManager: generationManagerMock,
}));

vi.mock("@/server/utils/observability", () => ({
  logServerEvent: vi.fn(),
}));

import { generationRouter } from "./generation";

const context = { user: { id: "user-1" } };
const generationRouterAny = generationRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

describe("generationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationManagerMock.cancelGeneration.mockResolvedValue(true);
    generationManagerMock.submitApproval.mockResolvedValue(true);
    generationManagerMock.submitAuthResult.mockResolvedValue(true);
    generationManagerMock.getGenerationStatus.mockResolvedValue({
      status: "running",
      contentParts: [],
      pendingApproval: null,
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });

  it("enforces generation ownership in getGenerationStatus", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      conversation: { userId: "another-user" },
    });

    await expect(
      generationRouterAny.getGenerationStatus({
        input: { generationId: "gen-1" },
        context,
      }),
    ).rejects.toThrow("Access denied");
  });

  it("enforces conversation ownership in getActiveGeneration", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      userId: "another-user",
      generationStatus: "idle",
      currentGenerationId: null,
    });

    await expect(
      generationRouterAny.getActiveGeneration({
        input: { conversationId: "conv-1" },
        context,
      }),
    ).rejects.toThrow("Access denied");
  });

  it("returns active generation from conversation durable state", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      generationStatus: "generating",
      currentGenerationId: "gen-db",
    });
    generationFindFirstMock.mockResolvedValue({
      startedAt: null,
      errorMessage: null,
    });

    const result = await generationRouterAny.getActiveGeneration({
      input: { conversationId: "conv-1" },
      context,
    });

    expect(result).toEqual({
      generationId: "gen-db",
      startedAt: null,
      errorMessage: null,
      status: "generating",
    });
  });

  it("returns persisted error message for errored active generation", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      generationStatus: "error",
      currentGenerationId: "gen-db",
    });
    generationFindFirstMock.mockResolvedValue({
      startedAt: new Date("2026-02-25T07:40:22.751Z"),
      errorMessage: "401 insufficient permissions",
    });

    const result = await generationRouterAny.getActiveGeneration({
      input: { conversationId: "conv-1" },
      context,
    });

    expect(result).toEqual({
      generationId: "gen-db",
      startedAt: "2026-02-25T07:40:22.751Z",
      errorMessage: "401 insufficient permissions",
      status: "error",
    });
  });

  it("passes cancel, approval, and auth calls through to generationManager", async () => {
    const cancelResult = await generationRouterAny.cancelGeneration({
      input: { generationId: "gen-1" },
      context,
    });
    const approvalResult = await generationRouterAny.submitApproval({
      input: {
        generationId: "gen-1",
        toolUseId: "tool-1",
        decision: "approve",
      },
      context,
    });
    const authResult = await generationRouterAny.submitAuthResult({
      input: { generationId: "gen-1", integration: "slack", success: true },
      context,
    });

    expect(cancelResult).toEqual({ success: true });
    expect(approvalResult).toEqual({ success: true });
    expect(authResult).toEqual({ success: true });

    expect(generationManagerMock.cancelGeneration).toHaveBeenCalledWith("gen-1", "user-1");
    expect(generationManagerMock.submitApproval).toHaveBeenCalledWith(
      "gen-1",
      "tool-1",
      "approve",
      "user-1",
      undefined,
    );
    expect(generationManagerMock.submitAuthResult).toHaveBeenCalledWith(
      "gen-1",
      "slack",
      true,
      "user-1",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  workflowFindFirstMock,
  workflowRunFindManyMock,
  workflowRunFindFirstMock,
  insertValuesMock,
  insertMock,
  updateWhereMock,
  updateSetMock,
  updateMock,
  dbMock,
  startWorkflowGenerationMock,
} = vi.hoisted(() => {
  const workflowFindFirstMock = vi.fn();
  const workflowRunFindManyMock = vi.fn();
  const workflowRunFindFirstMock = vi.fn();

  const insertValuesMock = vi.fn();
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const dbMock = {
    query: {
      workflow: {
        findFirst: workflowFindFirstMock,
      },
      workflowRun: {
        findMany: workflowRunFindManyMock,
        findFirst: workflowRunFindFirstMock,
      },
    },
    insert: insertMock,
    update: updateMock,
  };

  const startWorkflowGenerationMock = vi.fn();

  return {
    workflowFindFirstMock,
    workflowRunFindManyMock,
    workflowRunFindFirstMock,
    insertValuesMock,
    insertMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
    dbMock,
    startWorkflowGenerationMock,
  };
});

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/services/generation-manager", () => ({
  generationManager: {
    startWorkflowGeneration: startWorkflowGenerationMock,
  },
}));

import { triggerWorkflowRun } from "./workflow-service";

describe("triggerWorkflowRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00.000Z"));
    vi.clearAllMocks();

    workflowFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      status: "on",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-crm"],
      prompt: "Do the workflow",
      promptDo: "Do this",
      promptDont: "Do not do that",
    });

    workflowRunFindManyMock.mockResolvedValue([]);
    workflowRunFindFirstMock.mockResolvedValue(null);

    insertValuesMock.mockImplementation((values: unknown) => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: "run-1",
          workflowId: "wf-1",
          status: "running",
          startedAt: new Date("2026-02-12T12:00:00.000Z"),
          triggerPayload: values,
        },
      ]),
    }));

    updateWhereMock.mockResolvedValue(undefined);

    startWorkflowGenerationMock.mockResolvedValue({
      generationId: "gen-1",
      conversationId: "conv-1",
    });
  });

  it("throws NOT_FOUND when workflow is missing", async () => {
    workflowFindFirstMock.mockResolvedValue(null);

    await expect(
      triggerWorkflowRun({ workflowId: "missing", triggerPayload: {} })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws BAD_REQUEST when workflow is turned off", async () => {
    workflowFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      status: "off",
      autoApprove: true,
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      prompt: "",
      promptDo: null,
      promptDont: null,
    });

    await expect(
      triggerWorkflowRun({ workflowId: "wf-1", triggerPayload: {} })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("blocks non-admin users when an active run exists", async () => {
    workflowRunFindFirstMock.mockResolvedValue({
      id: "run-active",
      status: "running",
      startedAt: new Date(),
    });

    await expect(
      triggerWorkflowRun({
        workflowId: "wf-1",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "member",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows admin users to trigger despite an active run", async () => {
    workflowRunFindFirstMock.mockResolvedValue({
      id: "run-active",
      status: "running",
      startedAt: new Date(),
    });

    const result = await triggerWorkflowRun({
      workflowId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(result).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });

    expect(startWorkflowGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "run-1",
        userId: "user-1",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: ["custom-crm"],
      })
    );
  });

  it("marks the run as error and records an error event when generation start fails", async () => {
    startWorkflowGenerationMock.mockRejectedValue(new Error("start failed"));

    await expect(
      triggerWorkflowRun({
        workflowId: "wf-1",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "admin",
      })
    ).rejects.toThrow("start failed");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "start failed",
      })
    );

    const errorEventCall = insertValuesMock.mock.calls.find(
      (call) =>
        call[0] &&
        typeof call[0] === "object" &&
        "type" in (call[0] as Record<string, unknown>) &&
        (call[0] as Record<string, unknown>).type === "error"
    );

    expect(errorEventCall?.[0]).toEqual(
      expect.objectContaining({
        workflowRunId: "run-1",
        type: "error",
        payload: expect.objectContaining({ stage: "start_generation" }),
      })
    );
  });

  it("reconciles stale orphan and terminal runs before starting a new run", async () => {
    workflowRunFindManyMock.mockResolvedValue([
      {
        id: "run-orphan",
        status: "running",
        startedAt: new Date(Date.now() - 3 * 60 * 1000),
        finishedAt: null,
        errorMessage: null,
        generation: null,
      },
      {
        id: "run-terminal",
        status: "awaiting_approval",
        startedAt: new Date(Date.now() - 60 * 1000),
        finishedAt: null,
        errorMessage: null,
        generation: {
          id: "gen-terminal",
          conversationId: "conv-terminal",
          status: "completed",
          startedAt: new Date(Date.now() - 120 * 1000),
          completedAt: new Date(Date.now() - 30 * 1000),
          contentParts: [],
          pendingApproval: null,
          pendingAuth: null,
          errorMessage: null,
        },
      },
    ]);

    await triggerWorkflowRun({
      workflowId: "wf-1",
      triggerPayload: { source: "scheduler" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "Workflow run failed before generation could start.",
      })
    );

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
      })
    );
  });
});

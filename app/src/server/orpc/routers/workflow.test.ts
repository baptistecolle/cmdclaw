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
  triggerWorkflowRunMock,
  syncWorkflowScheduleJobMock,
  removeWorkflowScheduleJobMock,
  generateWorkflowNameMock,
} = vi.hoisted(() => ({
  triggerWorkflowRunMock: vi.fn(),
  syncWorkflowScheduleJobMock: vi.fn(),
  removeWorkflowScheduleJobMock: vi.fn(),
  generateWorkflowNameMock: vi.fn(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@/server/services/workflow-service", () => ({
  triggerWorkflowRun: triggerWorkflowRunMock,
}));

vi.mock("@/server/services/workflow-scheduler", () => ({
  syncWorkflowScheduleJob: syncWorkflowScheduleJobMock,
  removeWorkflowScheduleJob: removeWorkflowScheduleJobMock,
}));

vi.mock("@/server/utils/generate-workflow-name", () => ({
  generateWorkflowName: generateWorkflowNameMock,
}));

import { workflowRouter } from "./workflow";
const workflowRouterAny = workflowRouter as any;

function createContext() {
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const context: any = {
    user: { id: "user-1" },
    db: {
      query: {
        workflow: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        workflowRun: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        workflowRunEvent: {
          findMany: vi.fn(),
        },
        generation: {
          findFirst: vi.fn(),
        },
        user: {
          findFirst: vi.fn(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    },
    mocks: {
      insertReturningMock,
      updateReturningMock,
      deleteReturningMock,
    },
  };

  return context;
}

describe("workflowRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateWorkflowNameMock.mockResolvedValue("Generated Workflow Name");
    syncWorkflowScheduleJobMock.mockResolvedValue(undefined);
    removeWorkflowScheduleJobMock.mockResolvedValue(undefined);
    triggerWorkflowRunMock.mockResolvedValue({
      workflowId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });
  });

  it("creates a workflow and syncs schedule on happy path", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        name: "Generated Workflow Name",
        status: "on",
        triggerType: "schedule",
      },
    ]);

    const result = await workflowRouterAny.create({
      input: {
        triggerType: "schedule",
        prompt: "Daily task",
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: {
          type: "daily",
          time: "09:30",
          timezone: "UTC",
        },
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-1",
      name: "Generated Workflow Name",
      status: "on",
    });
    expect(syncWorkflowScheduleJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wf-1" })
    );
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during create", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        name: "Generated Workflow Name",
        status: "on",
        triggerType: "schedule",
      },
    ]);
    syncWorkflowScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      workflowRouterAny.create({
        input: {
          triggerType: "schedule",
          prompt: "Daily task",
          autoApprove: true,
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
          schedule: {
            type: "daily",
            time: "09:30",
            timezone: "UTC",
          },
        },
        context,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("updates a workflow on happy path", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Old Name",
      status: "on",
      triggerType: "manual",
      prompt: "Old prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "off",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await workflowRouterAny.update({
      input: {
        id: "wf-1",
        name: "Renamed Workflow",
        status: "off",
      },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("returns NOT_FOUND when updating a missing workflow", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue(null);

    await expect(
      workflowRouterAny.update({
        input: {
          id: "wf-missing",
          name: "Name",
        },
        context,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during update", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "schedule",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "schedule",
        schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      },
    ]);
    syncWorkflowScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      workflowRouterAny.update({
        input: {
          id: "wf-1",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
        },
        context,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("deletes a workflow on happy path", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);

    const result = await workflowRouterAny.delete({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(removeWorkflowScheduleJobMock).toHaveBeenCalledWith("wf-1");
  });

  it("returns NOT_FOUND when deleting a missing workflow", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([]);

    await expect(
      workflowRouterAny.delete({
        input: { id: "wf-missing" },
        context,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forwards trigger payload and user role to triggerWorkflowRun", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });

    const result = await workflowRouterAny.trigger({
      input: { id: "wf-1", payload: { source: "manual" } },
      context,
    });

    expect(result).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });

    expect(triggerWorkflowRunMock).toHaveBeenCalledWith({
      workflowId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

function createProcedureStub() {
  const stub: unknown = {
    input: vi.fn(() => stub),
    output: vi.fn(() => stub),
    handler: vi.fn((fn: unknown) => fn),
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
const workflowRouterAny = workflowRouter as unknown;

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

  const context: unknown = {
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
      insertValuesMock,
      updateSetMock,
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
      expect.objectContaining({ id: "wf-1" }),
    );
  });

  it("lists workflows with run summaries and source classification", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    const startedAt = new Date("2026-02-11T09:30:00.000Z");
    const secondStartedAt = new Date("2026-02-10T09:30:00.000Z");

    context.db.query.workflow.findMany.mockResolvedValue([
      {
        id: "wf-1",
        name: "Daily Workflow",
        status: "on",
        autoApprove: true,
        triggerType: "schedule",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: { type: "daily", time: "09:30", timezone: "UTC" },
        updatedAt: now,
      },
      {
        id: "wf-2",
        name: "Manual Workflow",
        status: "off",
        autoApprove: false,
        triggerType: "manual",
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: [],
        schedule: null,
        updatedAt: now,
      },
    ]);
    context.db.query.workflowRun.findMany
      .mockResolvedValueOnce([
        {
          id: "run-1",
          status: "success",
          startedAt,
          triggerPayload: { event: "schedule" },
        },
        {
          id: "run-2",
          status: "failed",
          startedAt: secondStartedAt,
          triggerPayload: {},
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await workflowRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "wf-1",
        name: "Daily Workflow",
        status: "on",
        autoApprove: true,
        triggerType: "schedule",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: { type: "daily", time: "09:30", timezone: "UTC" },
        updatedAt: now,
        lastRunStatus: "success",
        lastRunAt: startedAt,
        recentRuns: [
          { id: "run-1", status: "success", startedAt, source: "trigger" },
          {
            id: "run-2",
            status: "failed",
            startedAt: secondStartedAt,
            source: "manual",
          },
        ],
      },
      {
        id: "wf-2",
        name: "Manual Workflow",
        status: "off",
        autoApprove: false,
        triggerType: "manual",
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: [],
        schedule: null,
        updatedAt: now,
        lastRunStatus: null,
        lastRunAt: null,
        recentRuns: [],
      },
    ]);
  });

  it("gets a workflow with mapped runs", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      autoApprove: true,
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: "Do this",
      promptDont: "Don't do this",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
    });
    context.db.query.workflowRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);

    const result = await workflowRouterAny.get({
      input: { id: "wf-1" },
      context,
    });
    const getRunsArgs =
      context.db.query.workflowRun.findMany.mock.calls[0]?.[0];
    const getRunsOrderBy = getRunsArgs.orderBy(
      { startedAt: "started-col" },
      { desc: (value: unknown) => `d:${value}` },
    );

    expect(result).toEqual({
      id: "wf-1",
      name: "Workflow",
      status: "on",
      autoApprove: true,
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: "Do this",
      promptDont: "Don't do this",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
      runs: [
        {
          id: "run-1",
          status: "success",
          startedAt: now,
          finishedAt: now,
          errorMessage: null,
        },
      ],
    });
    expect(getRunsOrderBy).toEqual(["d:started-col"]);
  });

  it("returns NOT_FOUND when getting a missing workflow", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue(null);

    await expect(
      workflowRouterAny.get({
        input: { id: "wf-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses provided workflow name without generation", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-2",
        name: "Explicit Name",
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = await workflowRouterAny.create({
      input: {
        name: "  Explicit Name  ",
        triggerType: "manual",
        prompt: "Prompt text",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-2",
      name: "Explicit Name",
      status: "on",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Explicit Name" }),
    );
    expect(generateWorkflowNameMock).not.toHaveBeenCalled();
    expect(syncWorkflowScheduleJobMock).not.toHaveBeenCalled();
  });

  it("falls back to first prompt sentence when generated name is empty", async () => {
    const context = createContext();
    generateWorkflowNameMock.mockResolvedValueOnce(null);
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-3",
        name: "First sentence for fallback",
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = await workflowRouterAny.create({
      input: {
        triggerType: "manual",
        prompt: "First sentence for fallback. second sentence",
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(result.name).toBe("First sentence for fallback");
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "First sentence for fallback" }),
    );
  });

  it("falls back to New Workflow when prompt has no leading sentence text", async () => {
    const context = createContext();
    generateWorkflowNameMock.mockResolvedValueOnce(null);
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-4",
        name: "New Workflow",
        status: "on",
        triggerType: "manual",
      },
    ]);

    await workflowRouterAny.create({
      input: {
        triggerType: "manual",
        prompt: "... \n!",
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Workflow" }),
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
      }),
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
      }),
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
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("returns NOT_FOUND when update returning payload is empty", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([]);

    await expect(
      workflowRouterAny.update({
        input: { id: "wf-1", name: "Renamed" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not sync scheduler when update changes only non-schedule fields", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
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
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await workflowRouterAny.update({
      input: { id: "wf-1", name: "Renamed" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(syncWorkflowScheduleJobMock).not.toHaveBeenCalled();
  });

  it("updates allowed integration fields when provided", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
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
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await workflowRouterAny.update({
      input: {
        id: "wf-1",
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      }),
    );
  });

  it("sets empty workflow name when updating with blank name and blank prompt", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "   ",
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
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await workflowRouterAny.update({
      input: { id: "wf-1", name: "   " },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "" }),
    );
  });

  it("falls back to first prompt sentence when update name generation is empty", async () => {
    const context = createContext();
    generateWorkflowNameMock.mockResolvedValueOnce(null);
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
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
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await workflowRouterAny.update({
      input: {
        id: "wf-1",
        name: "   ",
        prompt: "Summary sentence. another sentence",
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Summary sentence" }),
    );
  });

  it("falls back to New Workflow when update prompt has no leading sentence text", async () => {
    const context = createContext();
    generateWorkflowNameMock.mockResolvedValueOnce(null);
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Workflow",
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
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
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await workflowRouterAny.update({
      input: { id: "wf-1", name: "   ", prompt: "... \n!" },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Workflow" }),
    );
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
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns INTERNAL_SERVER_ERROR when scheduler cleanup fails during delete", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);
    removeWorkflowScheduleJobMock.mockRejectedValueOnce(
      new Error("queue unavailable"),
    );

    await expect(
      workflowRouterAny.delete({
        input: { id: "wf-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
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

  it("defaults trigger payload to empty object when omitted", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue(null);

    await workflowRouterAny.trigger({
      input: { id: "wf-1" },
      context,
    });

    expect(triggerWorkflowRunMock).toHaveBeenCalledWith({
      workflowId: "wf-1",
      triggerPayload: {},
      userId: "user-1",
      userRole: null,
    });
  });

  it("returns NOT_FOUND when getting a missing run", async () => {
    const context = createContext();
    context.db.query.workflowRun.findFirst.mockResolvedValue(null);

    await expect(
      workflowRouterAny.getRun({
        input: { id: "run-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when run exists but workflow is not accessible", async () => {
    const context = createContext();
    context.db.query.workflowRun.findFirst.mockResolvedValue({
      id: "run-1",
      workflowId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.workflow.findFirst.mockResolvedValue(null);

    await expect(
      workflowRouterAny.getRun({
        input: { id: "run-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gets run details with ordered events and conversation id", async () => {
    const context = createContext();
    const createdAt = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.workflowRun.findFirst.mockResolvedValue({
      id: "run-1",
      workflowId: "wf-1",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
    });
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
    });
    context.db.query.workflowRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        type: "started",
        payload: { ok: true },
        createdAt,
      },
    ]);
    context.db.query.generation.findFirst.mockResolvedValue({
      conversationId: "conv-1",
    });

    const result = await workflowRouterAny.getRun({
      input: { id: "run-1" },
      context,
    });
    const eventArgs =
      context.db.query.workflowRunEvent.findMany.mock.calls[0]?.[0];
    const eventsOrderBy = eventArgs.orderBy(
      { createdAt: "created-col" },
      { asc: (value: unknown) => `a:${value}` },
    );

    expect(result).toEqual({
      id: "run-1",
      workflowId: "wf-1",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      conversationId: "conv-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
      events: [
        {
          id: "evt-1",
          type: "started",
          payload: { ok: true },
          createdAt,
        },
      ],
    });
    expect(eventsOrderBy).toEqual(["a:created-col"]);
  });

  it("sets null conversation id when run has no generation", async () => {
    const context = createContext();
    context.db.query.workflowRun.findFirst.mockResolvedValue({
      id: "run-2",
      workflowId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
    });
    context.db.query.workflowRunEvent.findMany.mockResolvedValue([]);

    const result = await workflowRouterAny.getRun({
      input: { id: "run-2" },
      context,
    });

    expect(result.conversationId).toBeNull();
    expect(context.db.query.generation.findFirst).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when listing runs for missing workflow", async () => {
    const context = createContext();
    context.db.query.workflow.findFirst.mockResolvedValue(null);

    await expect(
      workflowRouterAny.listRuns({
        input: { workflowId: "wf-missing", limit: 10 },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists workflow runs with public fields", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.workflow.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
    });
    context.db.query.workflowRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);

    const result = await workflowRouterAny.listRuns({
      input: { workflowId: "wf-1", limit: 10 },
      context,
    });
    const listRunsArgs =
      context.db.query.workflowRun.findMany.mock.calls[0]?.[0];
    const listRunsOrderBy = listRunsArgs.orderBy(
      { startedAt: "started-col" },
      { desc: (value: unknown) => `d:${value}` },
    );

    expect(result).toEqual([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);
    expect(listRunsOrderBy).toEqual(["d:started-col"]);
  });
});

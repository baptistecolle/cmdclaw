import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyMock,
  removeJobSchedulerMock,
  upsertJobSchedulerMock,
  getQueueMock,
  queueMock,
  dbMock,
} = vi.hoisted(() => {
  const findManyMock = vi.fn();
  const removeJobSchedulerMock = vi.fn();
  const upsertJobSchedulerMock = vi.fn();
  const queueMock = {
    removeJobScheduler: removeJobSchedulerMock,
    upsertJobScheduler: upsertJobSchedulerMock,
  };
  const getQueueMock = vi.fn(() => queueMock);
  const dbMock = {
    query: {
      workflow: {
        findMany: findManyMock,
      },
    },
  };

  return {
    findManyMock,
    removeJobSchedulerMock,
    upsertJobSchedulerMock,
    getQueueMock,
    queueMock,
    dbMock,
  };
});

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/queues", () => ({
  SCHEDULED_WORKFLOW_JOB_NAME: "workflow:scheduled-trigger",
  getQueue: getQueueMock,
}));

import {
  getWorkflowSchedulerId,
  isWorkflowSchedulable,
  reconcileScheduledWorkflowJobs,
  removeWorkflowScheduleJob,
  syncWorkflowScheduleJob,
  upsertWorkflowScheduleJob,
} from "./workflow-scheduler";

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wf-1",
    triggerType: "schedule",
    status: "on",
    schedule: { type: "interval", intervalMinutes: 10 },
    ...overrides,
  } as any;
}

describe("workflow-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueMock.mockReturnValue(queueMock);
    findManyMock.mockResolvedValue([]);
    removeJobSchedulerMock.mockResolvedValue(undefined);
    upsertJobSchedulerMock.mockResolvedValue(undefined);
  });

  it("builds scheduler ids from workflow ids", () => {
    expect(getWorkflowSchedulerId("wf-123")).toBe("workflow:wf-123");
  });

  it("detects whether a workflow row is schedulable", () => {
    expect(isWorkflowSchedulable(createRow())).toBe(true);
    expect(isWorkflowSchedulable(createRow({ status: "off" }))).toBe(false);
    expect(isWorkflowSchedulable(createRow({ triggerType: "manual" }))).toBe(false);
    expect(isWorkflowSchedulable(createRow({ schedule: { type: "daily" } }))).toBe(false);
  });

  it("removes scheduler jobs by workflow id", async () => {
    await removeWorkflowScheduleJob("wf-remove");

    expect(getQueueMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-remove");
  });

  it("upserts interval schedules with millisecond repeat intervals", async () => {
    await upsertWorkflowScheduleJob(
      createRow({
        id: "wf-interval",
        schedule: { type: "interval", intervalMinutes: 15 },
      })
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "workflow:wf-interval",
      { every: 15 * 60 * 1000 },
      {
        name: "workflow:scheduled-trigger",
        data: {
          source: "schedule",
          workflowId: "wf-interval",
          scheduleType: "interval",
        },
      }
    );
  });

  it("upserts daily schedules with UTC timezone by default", async () => {
    await upsertWorkflowScheduleJob(
      createRow({
        id: "wf-daily",
        schedule: { type: "daily", time: "09:05" },
      })
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "workflow:wf-daily",
      { pattern: "5 9 * * *", tz: "UTC" },
      {
        name: "workflow:scheduled-trigger",
        data: {
          source: "schedule",
          workflowId: "wf-daily",
          scheduleType: "daily",
        },
      }
    );
  });

  it("upserts weekly schedules with sorted unique weekdays", async () => {
    await upsertWorkflowScheduleJob(
      createRow({
        id: "wf-weekly",
        schedule: {
          type: "weekly",
          time: "16:45",
          daysOfWeek: [5, 1, 5, 3],
          timezone: "America/New_York",
        },
      })
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "workflow:wf-weekly",
      { pattern: "45 16 * * 1,3,5", tz: "America/New_York" },
      {
        name: "workflow:scheduled-trigger",
        data: {
          source: "schedule",
          workflowId: "wf-weekly",
          scheduleType: "weekly",
        },
      }
    );
  });

  it("upserts monthly schedules with explicit day-of-month", async () => {
    await upsertWorkflowScheduleJob(
      createRow({
        id: "wf-monthly",
        schedule: {
          type: "monthly",
          time: "08:30",
          dayOfMonth: 21,
          timezone: "Europe/Paris",
        },
      })
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "workflow:wf-monthly",
      { pattern: "30 8 21 * *", tz: "Europe/Paris" },
      {
        name: "workflow:scheduled-trigger",
        data: {
          source: "schedule",
          workflowId: "wf-monthly",
          scheduleType: "monthly",
        },
      }
    );
  });

  it("throws when schedule payload is invalid", async () => {
    await expect(
      upsertWorkflowScheduleJob(
        createRow({
          id: "wf-invalid",
          schedule: { unexpected: true },
        })
      )
    ).rejects.toThrow('Workflow "wf-invalid" has invalid schedule payload');

    expect(upsertJobSchedulerMock).not.toHaveBeenCalled();
  });

  it("throws when schedule time is not numeric", async () => {
    await expect(
      upsertWorkflowScheduleJob(
        createRow({
          id: "wf-invalid-time",
          schedule: { type: "daily", time: "ab:30" },
        })
      )
    ).rejects.toThrow('Invalid schedule time "ab:30"');
  });

  it("throws when schedule time is outside the valid range", async () => {
    await expect(
      upsertWorkflowScheduleJob(
        createRow({
          id: "wf-invalid-time-range",
          schedule: { type: "daily", time: "24:00" },
        })
      )
    ).rejects.toThrow('Invalid schedule time "24:00"');
  });

  it("syncs schedulable rows by upserting jobs", async () => {
    await syncWorkflowScheduleJob(
      createRow({
        id: "wf-sync",
        schedule: { type: "daily", time: "11:00", timezone: "UTC" },
      })
    );

    expect(upsertJobSchedulerMock).toHaveBeenCalledOnce();
    expect(removeJobSchedulerMock).not.toHaveBeenCalled();
  });

  it("syncs unschedulable rows by removing jobs", async () => {
    await syncWorkflowScheduleJob(
      createRow({
        id: "wf-sync-off",
        status: "off",
      })
    );

    expect(removeJobSchedulerMock).toHaveBeenCalledWith("workflow:wf-sync-off");
    expect(upsertJobSchedulerMock).not.toHaveBeenCalled();
  });

  it("reconciles workflows and tracks sync failures", async () => {
    findManyMock.mockResolvedValue([
      createRow({
        id: "wf-success",
        schedule: { type: "interval", intervalMinutes: 5 },
      }),
      createRow({
        id: "wf-fail",
        schedule: { type: "daily", time: "99:00" },
      }),
    ]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await reconcileScheduledWorkflowJobs();

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      "[workflow-scheduler] failed to reconcile workflow wf-fail",
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });
});

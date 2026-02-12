import type { RepeatOptions } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { workflow } from "@/server/db/schema";
import { SCHEDULED_WORKFLOW_JOB_NAME, getQueue } from "@/server/queues";

type WorkflowSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

type WorkflowScheduleRow = Pick<
  typeof workflow.$inferSelect,
  "id" | "triggerType" | "status" | "schedule"
>;

function parseTime(time: string): { hour: number; minute: number } {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid schedule time "${time}"`);
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid schedule time "${time}"`);
  }

  return { hour, minute };
}

function parseWorkflowSchedule(schedule: unknown): WorkflowSchedule | null {
  if (!schedule || typeof schedule !== "object") {return null;}
  const value = schedule as Record<string, unknown>;

  if (value.type === "interval" && typeof value.intervalMinutes === "number") {
    return { type: "interval", intervalMinutes: value.intervalMinutes };
  }

  if (
    value.type === "daily" &&
    typeof value.time === "string" &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return { type: "daily", time: value.time, timezone: value.timezone };
  }

  if (
    value.type === "weekly" &&
    typeof value.time === "string" &&
    Array.isArray(value.daysOfWeek) &&
    value.daysOfWeek.every((day) => typeof day === "number") &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return {
      type: "weekly",
      time: value.time,
      daysOfWeek: value.daysOfWeek as number[],
      timezone: value.timezone,
    };
  }

  if (
    value.type === "monthly" &&
    typeof value.time === "string" &&
    typeof value.dayOfMonth === "number" &&
    (value.timezone === undefined || typeof value.timezone === "string")
  ) {
    return {
      type: "monthly",
      time: value.time,
      dayOfMonth: value.dayOfMonth,
      timezone: value.timezone,
    };
  }

  return null;
}

export function getWorkflowSchedulerId(workflowId: string): string {
  return `workflow:${workflowId}`;
}

export function isWorkflowSchedulable(row: WorkflowScheduleRow): boolean {
  return (
    row.triggerType === "schedule" &&
    row.status === "on" &&
    parseWorkflowSchedule(row.schedule) !== null
  );
}

function buildRepeatOptions(schedule: WorkflowSchedule): Omit<RepeatOptions, "key"> {
  if (schedule.type === "interval") {
    return { every: schedule.intervalMinutes * 60 * 1000 };
  }

  const { hour, minute } = parseTime(schedule.time);
  const tz = schedule.timezone ?? "UTC";

  if (schedule.type === "daily") {
    return { pattern: `${minute} ${hour} * * *`, tz };
  }

  if (schedule.type === "weekly") {
    const days = [...new Set(schedule.daysOfWeek)].toSorted((a, b) => a - b).join(",");
    return { pattern: `${minute} ${hour} * * ${days}`, tz };
  }

  return { pattern: `${minute} ${hour} ${schedule.dayOfMonth} * *`, tz };
}

export async function removeWorkflowScheduleJob(workflowId: string): Promise<void> {
  const queue = getQueue();
  await queue.removeJobScheduler(getWorkflowSchedulerId(workflowId));
}

export async function upsertWorkflowScheduleJob(row: WorkflowScheduleRow): Promise<void> {
  const schedule = parseWorkflowSchedule(row.schedule);
  if (!schedule) {
    throw new Error(`Workflow "${row.id}" has invalid schedule payload`);
  }

  const queue = getQueue();
  await queue.upsertJobScheduler(getWorkflowSchedulerId(row.id), buildRepeatOptions(schedule), {
    name: SCHEDULED_WORKFLOW_JOB_NAME,
    data: {
      source: "schedule",
      workflowId: row.id,
      scheduleType: schedule.type,
    },
  });
}

export async function syncWorkflowScheduleJob(row: WorkflowScheduleRow): Promise<void> {
  if (isWorkflowSchedulable(row)) {
    await upsertWorkflowScheduleJob(row);
    return;
  }

  await removeWorkflowScheduleJob(row.id);
}

export async function reconcileScheduledWorkflowJobs(): Promise<{
  synced: number;
  failed: number;
}> {
  const rows = await db.query.workflow.findMany({
    where: and(eq(workflow.status, "on"), eq(workflow.triggerType, "schedule")),
    columns: {
      id: true,
      status: true,
      triggerType: true,
      schedule: true,
    },
  });

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await syncWorkflowScheduleJob(row);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error(`[workflow-scheduler] failed to reconcile workflow ${row.id}`, error);
    }
  }

  return { synced, failed };
}

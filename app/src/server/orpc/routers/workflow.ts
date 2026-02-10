import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { generation, user, workflow, workflowRun, workflowRunEvent } from "@/server/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

const integrationTypeSchema = z.enum([
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "reddit",
  "twitter",
]);

const triggerTypeSchema = z.string().min(1).max(128);

// Schedule configuration schema
const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    intervalMinutes: z.number().min(60).max(10080), // min 1 hour, max 1 week in minutes
  }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/), // HH:MM format
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    daysOfWeek: z.array(z.number().min(0).max(6)).min(1), // 0=Sunday, 6=Saturday
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    dayOfMonth: z.number().min(1).max(31),
    timezone: z.string().default("UTC"),
  }),
]);

const list = protectedProcedure.handler(async ({ context }) => {
  const workflows = await context.db.query.workflow.findMany({
    where: eq(workflow.ownerId, context.user.id),
    orderBy: (wf, { desc }) => [desc(wf.updatedAt)],
  });

  const items = await Promise.all(
    workflows.map(async (wf) => {
      const runs = await context.db.query.workflowRun.findMany({
        where: eq(workflowRun.workflowId, wf.id),
        orderBy: (run, { desc }) => [desc(run.startedAt)],
        limit: 20,
      });
      const lastRun = runs[0];

      return {
        id: wf.id,
        name: wf.name,
        status: wf.status,
        autoApprove: wf.autoApprove,
        triggerType: wf.triggerType,
        allowedIntegrations: wf.allowedIntegrations,
        allowedCustomIntegrations: wf.allowedCustomIntegrations,
        schedule: wf.schedule,
        updatedAt: wf.updatedAt,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.startedAt ?? null,
        recentRuns: runs.map((run) => {
          const payload =
            run.triggerPayload && typeof run.triggerPayload === "object"
              ? (run.triggerPayload as Record<string, unknown>)
              : null;
          const source = payload && Object.keys(payload).length > 0 ? "trigger" : "manual";

          return {
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            source,
          };
        }),
      };
    })
  );

  return items;
});

const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const wf = await context.db.query.workflow.findFirst({
      where: and(eq(workflow.id, input.id), eq(workflow.ownerId, context.user.id)),
    });

    if (!wf) {
      throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
    }

    const runs = await context.db.query.workflowRun.findMany({
      where: eq(workflowRun.workflowId, wf.id),
      orderBy: (run, { desc }) => [desc(run.startedAt)],
      limit: 20,
    });

    return {
      id: wf.id,
      name: wf.name,
      status: wf.status,
      autoApprove: wf.autoApprove,
      triggerType: wf.triggerType,
      prompt: wf.prompt,
      promptDo: wf.promptDo,
      promptDont: wf.promptDont,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      schedule: wf.schedule,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorMessage: run.errorMessage,
      })),
    };
  });

const create = protectedProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      triggerType: triggerTypeSchema,
      prompt: z.string().min(1).max(20000),
      promptDo: z.string().max(2000).optional(),
      promptDont: z.string().max(2000).optional(),
      autoApprove: z.boolean().optional(),
      allowedIntegrations: z.array(integrationTypeSchema).default([]),
      allowedCustomIntegrations: z.array(z.string()).default([]),
      schedule: scheduleSchema.nullish(),
    })
  )
  .handler(async ({ input, context }) => {
    const [created] = await context.db
      .insert(workflow)
      .values({
        name: input.name,
        ownerId: context.user.id,
        status: "on",
        triggerType: input.triggerType,
        prompt: input.prompt,
        promptDo: input.promptDo,
        promptDont: input.promptDont,
        autoApprove: input.autoApprove ?? true,
        allowedIntegrations: input.allowedIntegrations,
        allowedCustomIntegrations: input.allowedCustomIntegrations,
        schedule: input.schedule ?? null,
      })
      .returning();

    return {
      id: created.id,
      name: created.name,
      status: created.status,
    };
  });

const update = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(128).optional(),
      status: z.enum(["on", "off"]).optional(),
      triggerType: triggerTypeSchema.optional(),
      prompt: z.string().min(1).max(20000).optional(),
      promptDo: z.string().max(2000).nullish(),
      promptDont: z.string().max(2000).nullish(),
      autoApprove: z.boolean().optional(),
      allowedIntegrations: z.array(integrationTypeSchema).optional(),
      allowedCustomIntegrations: z.array(z.string()).optional(),
      schedule: scheduleSchema.nullish(),
    })
  )
  .handler(async ({ input, context }) => {
    const updates: Partial<typeof workflow.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.status !== undefined) updates.status = input.status;
    if (input.triggerType !== undefined) updates.triggerType = input.triggerType;
    if (input.prompt !== undefined) updates.prompt = input.prompt;
    if (input.promptDo !== undefined) updates.promptDo = input.promptDo ?? null;
    if (input.promptDont !== undefined) updates.promptDont = input.promptDont ?? null;
    if (input.autoApprove !== undefined) updates.autoApprove = input.autoApprove;
    if (input.allowedIntegrations !== undefined) {
      updates.allowedIntegrations = input.allowedIntegrations;
    }
    if (input.allowedCustomIntegrations !== undefined) {
      updates.allowedCustomIntegrations = input.allowedCustomIntegrations;
    }
    if (input.schedule !== undefined) {
      updates.schedule = input.schedule ?? null;
    }

    const result = await context.db
      .update(workflow)
      .set(updates)
      .where(and(eq(workflow.id, input.id), eq(workflow.ownerId, context.user.id)))
      .returning({ id: workflow.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
    }

    return { success: true };
  });

const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .delete(workflow)
      .where(and(eq(workflow.id, input.id), eq(workflow.ownerId, context.user.id)))
      .returning({ id: workflow.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
    }

    return { success: true };
  });

const trigger = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      payload: z.unknown().optional(),
    })
  )
  .handler(async ({ input, context }) => {
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    return triggerWorkflowRun({
      workflowId: input.id,
      triggerPayload: input.payload ?? {},
      userId: context.user.id,
      userRole: dbUser?.role ?? null,
    });
  });

const getRun = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const run = await context.db.query.workflowRun.findFirst({
      where: eq(workflowRun.id, input.id),
    });

    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }

    const wf = await context.db.query.workflow.findFirst({
      where: and(eq(workflow.id, run.workflowId), eq(workflow.ownerId, context.user.id)),
    });

    if (!wf) {
      throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
    }

    const events = await context.db.query.workflowRunEvent.findMany({
      where: eq(workflowRunEvent.workflowRunId, run.id),
      orderBy: (evt, { asc }) => [asc(evt.createdAt)],
    });
    const gen = run.generationId
      ? await context.db.query.generation.findFirst({
          where: eq(generation.id, run.generationId),
          columns: {
            conversationId: true,
          },
        })
      : null;

    return {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      triggerPayload: run.triggerPayload,
      generationId: run.generationId,
      conversationId: gen?.conversationId ?? null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      events: events.map((evt) => ({
        id: evt.id,
        type: evt.type,
        payload: evt.payload,
        createdAt: evt.createdAt,
      })),
    };
  });

const listRuns = protectedProcedure
  .input(
    z.object({
      workflowId: z.string(),
      limit: z.number().min(1).max(50).default(20),
    })
  )
  .handler(async ({ input, context }) => {
    const wf = await context.db.query.workflow.findFirst({
      where: and(eq(workflow.id, input.workflowId), eq(workflow.ownerId, context.user.id)),
    });

    if (!wf) {
      throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
    }

    const runs = await context.db.query.workflowRun.findMany({
      where: eq(workflowRun.workflowId, wf.id),
      orderBy: (run, { desc }) => [desc(run.startedAt)],
      limit: input.limit,
    });

    return runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
    }));
  });

export const workflowRouter = {
  list,
  get,
  create,
  update,
  delete: del,
  trigger,
  getRun,
  listRuns,
};

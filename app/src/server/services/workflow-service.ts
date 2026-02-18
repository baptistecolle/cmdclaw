import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { IntegrationType } from "@/server/oauth/config";
import { resolveDefaultOpencodeFreeModel } from "@/lib/zen-models";
import { db } from "@/server/db/client";
import {
  conversation,
  generation,
  workflow,
  workflowRun,
  workflowRunEvent,
} from "@/server/db/schema";
import { generationManager } from "@/server/services/generation-manager";

const ACTIVE_WORKFLOW_RUN_STATUSES = ["running", "awaiting_approval", "awaiting_auth"] as const;
const TERMINAL_GENERATION_STATUSES = ["completed", "cancelled", "error"] as const;
const ORPHAN_RUN_GRACE_MS = 2 * 60 * 1000;
const WORKFLOW_PREPARING_TIMEOUT_MS = (() => {
  const seconds = Number(process.env.WORKFLOW_PREPARING_TIMEOUT_SECONDS ?? "300");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5 * 60 * 1000;
  }
  return Math.floor(seconds * 1000);
})();

async function resolveWorkflowDefaultModel(): Promise<string> {
  return resolveDefaultOpencodeFreeModel(process.env.BAP_CHAT_MODEL);
}

function mapGenerationStatusToWorkflowRunStatus(
  status: (typeof TERMINAL_GENERATION_STATUSES)[number],
): "completed" | "cancelled" | "error" {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "error";
}

async function reconcileStaleWorkflowRunsForWorkflow(workflowId: string): Promise<void> {
  const candidateRuns = await db.query.workflowRun.findMany({
    where: and(
      eq(workflowRun.workflowId, workflowId),
      inArray(workflowRun.status, [...ACTIVE_WORKFLOW_RUN_STATUSES]),
    ),
    with: {
      generation: {
        columns: {
          id: true,
          conversationId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          contentParts: true,
          pendingApproval: true,
          pendingAuth: true,
          errorMessage: true,
        },
      },
    },
    limit: 20,
  });

  const updates = candidateRuns.map(async (run) => {
    const gen = run.generation;
    if (!gen) {
      const isLikelyOrphan =
        run.status === "running" && Date.now() - run.startedAt.getTime() > ORPHAN_RUN_GRACE_MS;
      if (!isLikelyOrphan) {
        return;
      }

      await db
        .update(workflowRun)
        .set({
          status: "error",
          finishedAt: run.finishedAt ?? new Date(),
          errorMessage: run.errorMessage ?? "Workflow run failed before generation could start.",
        })
        .where(eq(workflowRun.id, run.id));

      return;
    }

    if (
      !TERMINAL_GENERATION_STATUSES.includes(
        gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number],
      )
    ) {
      const isPreparingTimeout =
        run.status === "running" &&
        gen.status === "running" &&
        Date.now() - gen.startedAt.getTime() > WORKFLOW_PREPARING_TIMEOUT_MS &&
        (gen.contentParts?.length ?? 0) === 0 &&
        !gen.pendingApproval &&
        !gen.pendingAuth;

      if (isPreparingTimeout) {
        const errorMessage = "Workflow run timed out while preparing agent.";

        await db
          .update(generation)
          .set({
            status: "error",
            completedAt: new Date(),
            errorMessage,
          })
          .where(eq(generation.id, gen.id));

        await db
          .update(conversation)
          .set({ generationStatus: "error" })
          .where(eq(conversation.id, gen.conversationId));

        await db
          .update(workflowRun)
          .set({
            status: "error",
            finishedAt: run.finishedAt ?? new Date(),
            errorMessage,
          })
          .where(eq(workflowRun.id, run.id));

        return;
      }

      return;
    }

    const mappedStatus = mapGenerationStatusToWorkflowRunStatus(
      gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number],
    );

    await db
      .update(workflowRun)
      .set({
        status: mappedStatus,
        finishedAt: run.finishedAt ?? gen.completedAt ?? new Date(),
        errorMessage: run.errorMessage ?? gen.errorMessage ?? null,
      })
      .where(eq(workflowRun.id, run.id));
  });

  await Promise.all(updates);
}

export async function triggerWorkflowRun(params: {
  workflowId: string;
  triggerPayload: unknown;
  userId?: string;
  userRole?: string | null;
}): Promise<{
  workflowId: string;
  runId: string;
  generationId: string;
  conversationId: string;
}> {
  const wf = await db.query.workflow.findFirst({
    where: params.userId
      ? and(eq(workflow.id, params.workflowId), eq(workflow.ownerId, params.userId))
      : eq(workflow.id, params.workflowId),
  });

  if (!wf) {
    throw new ORPCError("NOT_FOUND", { message: "Workflow not found" });
  }

  if (wf.status !== "on") {
    throw new ORPCError("BAD_REQUEST", { message: "Workflow is turned off" });
  }

  // Defensive reconciliation for runs that were left active while their generation already ended.
  // This avoids permanently blocking future triggers for the workflow.
  await reconcileStaleWorkflowRunsForWorkflow(wf.id);

  const activeRun = await db.query.workflowRun.findFirst({
    where: and(
      eq(workflowRun.workflowId, wf.id),
      inArray(workflowRun.status, [...ACTIVE_WORKFLOW_RUN_STATUSES]),
    ),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
  });

  if (params.userRole !== "admin" && activeRun) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Workflow already has an active run",
    });
  }

  const [run] = await db
    .insert(workflowRun)
    .values({
      workflowId: wf.id,
      status: "running",
      triggerPayload: params.triggerPayload,
    })
    .returning();

  await db.insert(workflowRunEvent).values({
    workflowRunId: run.id,
    type: "trigger",
    payload: params.triggerPayload ?? {},
  });

  const payloadText = JSON.stringify(params.triggerPayload ?? {}, null, 2);
  const workflowSections = [
    wf.prompt?.trim() ? `## Workflow Instructions\n${wf.prompt}` : null,
    wf.promptDo?.trim() ? `## Do\n${wf.promptDo}` : null,
    wf.promptDont?.trim() ? `## Don't\n${wf.promptDont}` : null,
    `## Trigger Payload\n${payloadText}`,
  ].filter(Boolean);
  const userContent = workflowSections.join("\n\n");

  const allowedIntegrations = (wf.allowedIntegrations ?? []) as IntegrationType[];
  const allowedCustomIntegrations = Array.isArray(wf.allowedCustomIntegrations)
    ? wf.allowedCustomIntegrations.filter((value): value is string => typeof value === "string")
    : [];

  let generationId: string;
  let conversationId: string;
  try {
    const workflowModel = await resolveWorkflowDefaultModel();
    const startResult = await generationManager.startWorkflowGeneration({
      workflowRunId: run.id,
      content: userContent,
      model: workflowModel,
      userId: wf.ownerId,
      autoApprove: wf.autoApprove,
      allowedIntegrations,
      allowedCustomIntegrations,
    });

    generationId = startResult.generationId;
    conversationId = startResult.conversationId;

    await db.update(workflowRun).set({ generationId }).where(eq(workflowRun.id, run.id));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start workflow generation";

    await db
      .update(workflowRun)
      .set({
        status: "error",
        finishedAt: new Date(),
        errorMessage,
      })
      .where(eq(workflowRun.id, run.id));

    await db.insert(workflowRunEvent).values({
      workflowRunId: run.id,
      type: "error",
      payload: { message: errorMessage, stage: "start_generation" },
    });

    throw error;
  }

  return {
    workflowId: wf.id,
    runId: run.id,
    generationId: generationId!,
    conversationId: conversationId!,
  };
}

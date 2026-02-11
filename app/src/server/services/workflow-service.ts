import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { generation, workflow, workflowRun, workflowRunEvent } from "@/server/db/schema";
import { generationManager } from "@/server/services/generation-manager";
import type { IntegrationType } from "@/server/oauth/config";

const ACTIVE_WORKFLOW_RUN_STATUSES = ["running", "awaiting_approval", "awaiting_auth"] as const;
const TERMINAL_GENERATION_STATUSES = ["completed", "cancelled", "error"] as const;

function mapGenerationStatusToWorkflowRunStatus(
  status: (typeof TERMINAL_GENERATION_STATUSES)[number]
): "completed" | "cancelled" | "error" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "error";
}

async function reconcileStaleWorkflowRunsForWorkflow(workflowId: string): Promise<void> {
  const candidateRuns = await db.query.workflowRun.findMany({
    where: and(
      eq(workflowRun.workflowId, workflowId),
      inArray(workflowRun.status, [...ACTIVE_WORKFLOW_RUN_STATUSES])
    ),
    with: {
      generation: {
        columns: {
          id: true,
          status: true,
          completedAt: true,
          errorMessage: true,
        },
      },
    },
    limit: 20,
  });

  for (const run of candidateRuns) {
    const gen = run.generation;
    if (!gen) continue;

    if (!TERMINAL_GENERATION_STATUSES.includes(gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number])) {
      continue;
    }

    const mappedStatus = mapGenerationStatusToWorkflowRunStatus(
      gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number]
    );

    await db
      .update(workflowRun)
      .set({
        status: mappedStatus,
        finishedAt: run.finishedAt ?? gen.completedAt ?? new Date(),
        errorMessage: run.errorMessage ?? gen.errorMessage ?? null,
      })
      .where(eq(workflowRun.id, run.id));
  }
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
      inArray(workflowRun.status, [...ACTIVE_WORKFLOW_RUN_STATUSES])
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
  const userContent = `Workflow trigger received.\n\n<trigger_payload>\n${payloadText}\n</trigger_payload>`;

  const allowedIntegrations = (wf.allowedIntegrations ?? []) as IntegrationType[];

  const { generationId, conversationId } = await generationManager.startWorkflowGeneration({
    workflowRunId: run.id,
    content: userContent,
    userId: wf.ownerId,
    autoApprove: wf.autoApprove,
    allowedIntegrations,
    allowedCustomIntegrations: (wf as any).allowedCustomIntegrations ?? [],
    workflowPrompt: wf.prompt,
    workflowPromptDo: wf.promptDo,
    workflowPromptDont: wf.promptDont,
    triggerPayload: params.triggerPayload,
  });

  await db
    .update(workflowRun)
    .set({ generationId })
    .where(eq(workflowRun.id, run.id));

  return {
    workflowId: wf.id,
    runId: run.id,
    generationId,
    conversationId,
  };
}

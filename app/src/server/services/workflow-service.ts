import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { workflow, workflowRun, workflowRunEvent } from "@/server/db/schema";
import { generationManager } from "@/server/services/generation-manager";
import type { IntegrationType } from "@/server/oauth/config";

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function triggerWorkflowRun(params: {
  workflowId: string;
  triggerPayload: unknown;
  userId?: string;
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

  const lastRun = await db.query.workflowRun.findFirst({
    where: eq(workflowRun.workflowId, wf.id),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
  });

  if (lastRun && lastRun.startedAt) {
    const now = Date.now();
    if (now - new Date(lastRun.startedAt).getTime() < ONE_HOUR_MS) {
      throw new ORPCError("BAD_REQUEST", { message: "Workflow is rate limited (1 run per hour)" });
    }
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
    allowedIntegrations,
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

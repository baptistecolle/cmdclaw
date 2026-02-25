import { Queue, QueueEvents, Worker, type ConnectionOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@/lib/email-forwarding";
import { buildRedisOptions } from "@/server/redis/connection-options";
import { processForwardedEmailEvent } from "@/server/services/workflow-email-forwarding";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

const rawQueueName = process.env.BULLMQ_QUEUE_NAME ?? "cmdclaw-default";
export const queueName = rawQueueName.replaceAll(":", "-");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const SCHEDULED_WORKFLOW_JOB_NAME = "workflow:scheduled-trigger";
export const GMAIL_WORKFLOW_JOB_NAME = "workflow:gmail-trigger";
export const X_DM_WORKFLOW_JOB_NAME = "workflow:x-dm-trigger";
export const EMAIL_FORWARDED_WORKFLOW_JOB_NAME = "workflow:email-forwarded-trigger";
export const CHAT_GENERATION_JOB_NAME = "generation:chat-run";
export const WORKFLOW_GENERATION_JOB_NAME = "generation:workflow-run";
export const GENERATION_APPROVAL_TIMEOUT_JOB_NAME = "generation:approval-timeout";
export const GENERATION_AUTH_TIMEOUT_JOB_NAME = "generation:auth-timeout";
export const GENERATION_PREPARING_STUCK_CHECK_JOB_NAME = "generation:preparing-stuck-check";
export const GENERATION_STALE_REAPER_JOB_NAME = "generation:stale-reaper";
export const SLACK_EVENT_JOB_NAME = "slack:event-callback";

export function buildQueueJobId(parts: Array<string | number | null | undefined>): string {
  const joined = parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part.length > 0)
    .join("-");
  const normalized = joined.replaceAll(":", "-").replaceAll(/\s+/g, "-").replaceAll(/-+/g, "-");
  return normalized.length > 0 ? normalized : "job";
}

type JobPayload = Record<string, unknown> & { workflowId?: string };
type JobHandler = Processor<JobPayload, unknown, string>;

function isActiveWorkflowRunConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };

  return (
    maybeError.code === "BAD_REQUEST" &&
    maybeError.status === 400 &&
    typeof maybeError.message === "string" &&
    maybeError.message.includes("Workflow already has an active run")
  );
}

const handlers: Record<string, JobHandler> = {
  [SCHEDULED_WORKFLOW_JOB_NAME]: async (job) => {
    const workflowId = job.data?.workflowId;
    if (!workflowId || typeof workflowId !== "string") {
      throw new Error(`Missing workflowId in scheduled job "${job.id}"`);
    }

    const scheduleType =
      typeof job.data?.scheduleType === "string" ? job.data.scheduleType : "unknown";

    return triggerWorkflowRun({
      workflowId,
      triggerPayload: {
        source: "schedule",
        workflowId,
        scheduleType,
        scheduledFor: new Date().toISOString(),
      },
    });
  },
  [GMAIL_WORKFLOW_JOB_NAME]: async (job) => {
    const workflowId = job.data?.workflowId;
    if (!workflowId || typeof workflowId !== "string") {
      throw new Error(`Missing workflowId in gmail job "${job.id}"`);
    }

    try {
      return await triggerWorkflowRun({
        workflowId,
        triggerPayload: job.data?.triggerPayload ?? {},
      });
    } catch (error) {
      if (isActiveWorkflowRunConflict(error)) {
        console.warn(
          `[worker] skipped gmail workflow trigger because run is already active for workflow ${workflowId}`,
        );
        return;
      }
      throw error;
    }
  },
  [X_DM_WORKFLOW_JOB_NAME]: async (job) => {
    const workflowId = job.data?.workflowId;
    if (!workflowId || typeof workflowId !== "string") {
      throw new Error(`Missing workflowId in x dm job "${job.id}"`);
    }

    try {
      return await triggerWorkflowRun({
        workflowId,
        triggerPayload: job.data?.triggerPayload ?? {},
      });
    } catch (error) {
      if (isActiveWorkflowRunConflict(error)) {
        console.warn(
          `[worker] skipped x dm workflow trigger because run is already active for workflow ${workflowId}`,
        );
        return;
      }
      throw error;
    }
  },
  [EMAIL_FORWARDED_WORKFLOW_JOB_NAME]: async (job) => {
    try {
      await processForwardedEmailEvent(
        job.data as Parameters<typeof processForwardedEmailEvent>[0],
      );
    } catch (error) {
      if (isActiveWorkflowRunConflict(error)) {
        console.warn(
          `[worker] skipped forwarded email trigger because run is already active (source: ${EMAIL_FORWARDED_TRIGGER_TYPE})`,
        );
        return;
      }
      throw error;
    }
  },
  [CHAT_GENERATION_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in chat generation job "${job.id}"`);
    }

    const { generationManager } = await import("@/server/services/generation-manager");
    await generationManager.runQueuedGeneration(generationId);
  },
  [WORKFLOW_GENERATION_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in workflow generation job "${job.id}"`);
    }

    const { generationManager } = await import("@/server/services/generation-manager");
    await generationManager.runQueuedGeneration(generationId);
  },
  [GENERATION_APPROVAL_TIMEOUT_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in approval timeout job "${job.id}"`);
    }

    const { generationManager } = await import("@/server/services/generation-manager");
    await generationManager.processGenerationTimeout(generationId, "approval");
  },
  [GENERATION_AUTH_TIMEOUT_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in auth timeout job "${job.id}"`);
    }

    const { generationManager } = await import("@/server/services/generation-manager");
    await generationManager.processGenerationTimeout(generationId, "auth");
  },
  [GENERATION_PREPARING_STUCK_CHECK_JOB_NAME]: async (job) => {
    const generationId = job.data?.generationId;
    if (!generationId || typeof generationId !== "string") {
      throw new Error(`Missing generationId in preparing-stuck-check job "${job.id}"`);
    }

    const { generationManager } = await import("@/server/services/generation-manager");
    await generationManager.processPreparingStuckCheck(generationId);
  },
  [GENERATION_STALE_REAPER_JOB_NAME]: async () => {
    const { generationManager } = await import("@/server/services/generation-manager");
    const summary = await generationManager.reapStaleGenerations();
    if (summary.stale > 0) {
      console.warn(
        `[worker] stale generation reaper finalized ${summary.stale} generation(s) (${summary.finalizedRunningAsError} as error, ${summary.finalizedOtherAsCancelled} as cancelled)`,
      );
    }
  },
  [SLACK_EVENT_JOB_NAME]: async (job) => {
    const payload = job.data?.payload;
    if (!payload || typeof payload !== "object") {
      throw new Error(`Missing payload in slack event job "${job.id}"`);
    }
    const { handleSlackEvent } = await import("@/server/services/slack-bot");
    await handleSlackEvent(payload as Parameters<typeof handleSlackEvent>[0]);
  },
};

const processor: Processor<JobPayload, unknown, string> = async (job) => {
  const handler = handlers[job.name];

  if (!handler) {
    throw new Error(`No handler registered for job "${job.name}"`);
  }

  return handler(job);
};

let queue: Queue<JobPayload, unknown, string> | null = null;
let queueConnection: IORedis | null = null;

function createRedisConnection(): IORedis {
  return new IORedis(buildRedisOptions(redisUrl, redisOptions));
}

export const getQueue = (): Queue<JobPayload, unknown, string> => {
  if (!queue) {
    queueConnection = createRedisConnection();
    queue = new Queue<JobPayload, unknown, string>(queueName, {
      connection: queueConnection as unknown as ConnectionOptions,
    });
  }

  return queue!;
};

export const startQueues = () => {
  const workerConnection = createRedisConnection();
  const queueEventsConnection = createRedisConnection();

  const worker = new Worker(queueName, processor, {
    connection: workerConnection as unknown as ConnectionOptions,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? "5"),
  });

  const queueEvents = new QueueEvents(queueName, {
    connection: queueEventsConnection as unknown as ConnectionOptions,
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`[worker] job ${jobId} failed: ${failedReason}`);
  });

  worker.on("error", (error) => {
    console.error("[worker] unhandled error", error);
  });

  worker.on("failed", (job, error) => {
    const id = job?.id ?? "unknown";
    console.error(`[worker] job ${id} failed in processor`, error);
  });

  queueEvents.on("error", (error) => {
    console.error("[worker] queue events error", error);
  });

  return {
    worker,
    queueEvents,
    workerConnection,
    queueEventsConnection,
    queueName,
    redisUrl,
  };
};

async function closeRedisConnection(connection: IORedis): Promise<void> {
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}

export const stopQueues = async (
  worker: Worker,
  queueEvents: QueueEvents,
  workerConnection: IORedis,
  queueEventsConnection: IORedis,
) => {
  const closers: Promise<unknown>[] = [worker.close(), queueEvents.close()];
  if (queue) {
    closers.push(queue.close());
    if (queueConnection) {
      closers.push(closeRedisConnection(queueConnection));
      queueConnection = null;
    }
    queue = null;
  }
  closers.push(closeRedisConnection(workerConnection));
  closers.push(closeRedisConnection(queueEventsConnection));
  await Promise.allSettled(closers);
};

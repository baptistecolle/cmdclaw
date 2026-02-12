import {
  Queue,
  QueueEvents,
  Worker,
  type ConnectionOptions,
  type Processor,
} from "bullmq";
import IORedis from "ioredis";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

const rawQueueName = process.env.BULLMQ_QUEUE_NAME ?? "bap-default";
export const queueName = rawQueueName.replaceAll(":", "-");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const SCHEDULED_WORKFLOW_JOB_NAME = "workflow:scheduled-trigger";
export const GMAIL_WORKFLOW_JOB_NAME = "workflow:gmail-trigger";
export const X_DM_WORKFLOW_JOB_NAME = "workflow:x-dm-trigger";

type JobPayload = Record<string, unknown> & { workflowId?: string };
type JobHandler = Processor<JobPayload, unknown, string>;

function isActiveWorkflowRunConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

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
      typeof job.data?.scheduleType === "string"
        ? job.data.scheduleType
        : "unknown";

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
  return new IORedis(redisUrl, redisOptions);
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

  queueEvents.on("completed", ({ jobId }) => {
    console.log(`[worker] job ${jobId} completed`);
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

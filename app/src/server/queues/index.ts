import { Queue, QueueEvents, Worker, type Processor } from "bullmq";
import IORedis from "ioredis";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

const rawQueueName = process.env.BULLMQ_QUEUE_NAME ?? "bap-default";
export const queueName = rawQueueName.replaceAll(":", "-");
export const redisUrl = process.env.BULLMQ_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
const redisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false } as const;

export const SCHEDULED_WORKFLOW_JOB_NAME = "workflow:scheduled-trigger";

type JobPayload = Record<string, unknown> & { workflowId?: string };
type JobHandler = Processor<JobPayload, unknown, string>;

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
};

const processor: Processor<JobPayload, unknown, string> = async (job) => {
  const handler = handlers[job.name];

  if (!handler) {
    throw new Error(`No handler registered for job "${job.name}"`);
  }

  return handler(job);
};

let queue: Queue<JobPayload, unknown, string> | null = null;

function createRedisConnection(): IORedis {
  // Cast to any due to ioredis version mismatch with bullmq's bundled version
  return new IORedis(redisUrl, redisOptions) as any;
}

export const getQueue = (): Queue<JobPayload, unknown, string> => {
  if (!queue) {
    queue = new Queue<JobPayload, unknown, string>(queueName, {
      connection: createRedisConnection() as any,
    });
  }

  return queue;
};

export const startQueues = () => {
  const connection = createRedisConnection() as any;

  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? "5"),
  });

  const queueEvents = new QueueEvents(queueName, {
    connection: createRedisConnection() as any,
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

  return { worker, queueEvents, queueName, redisUrl };
};

export const stopQueues = async (worker: Worker, queueEvents: QueueEvents) => {
  const closers: Promise<unknown>[] = [worker.close(), queueEvents.close()];
  if (queue) {
    closers.push(queue.close());
    queue = null;
  }
  await Promise.allSettled(closers);
};

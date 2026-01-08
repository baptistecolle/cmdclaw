import { QueueEvents, Worker, type Processor } from "bullmq";
import IORedis from "ioredis";

const queueName = process.env.BULLMQ_QUEUE_NAME ?? "viralpilot:default";
const redisUrl = process.env.BULLMQ_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
const redisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false };

type JobPayload = Record<string, unknown>;
type JobHandler = Processor<JobPayload, unknown, string>;

const handlers: Record<string, JobHandler> = {
  "example:log": async (job) => {
    const payload = JSON.stringify(job.data ?? {});
    console.log(`[worker] received example:log job ${job.id} with payload ${payload}`);
    return { receivedAt: new Date().toISOString() };
  },
};

const processor: Processor<JobPayload, unknown, string> = async (job) => {
  const handler = handlers[job.name];

  if (!handler) {
    throw new Error(`No handler registered for job "${job.name}"`);
  }

  return handler(job);
};

export const startQueues = () => {
  const connection = new IORedis(redisUrl, redisOptions);

  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? "5"),
  });

  const queueEvents = new QueueEvents(queueName, {
    connection: new IORedis(redisUrl, redisOptions),
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
  await Promise.allSettled([worker.close(), queueEvents.close()]);
};

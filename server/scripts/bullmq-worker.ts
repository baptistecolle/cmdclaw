import { startQueues, stopQueues } from "../src/server/queues";

const { worker, queueEvents, queueName, redisUrl } = startQueues();

const shutdown = async () => {
  console.log("[worker] shutting down...");
  await stopQueues(worker, queueEvents);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[worker] listening on "${queueName}" with redis "${redisUrl}"`);

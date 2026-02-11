import { startQueues, stopQueues } from "../src/server/queues";
import { reconcileScheduledWorkflowJobs } from "../src/server/services/workflow-scheduler";

const { worker, queueEvents, queueName, redisUrl } = startQueues();

const shutdown = async () => {
  console.log("[worker] shutting down...");
  await stopQueues(worker, queueEvents);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[worker] listening on "${queueName}" with redis "${redisUrl}"`);

void (async () => {
  try {
    const { synced, failed } = await reconcileScheduledWorkflowJobs();
    console.log(`[worker] reconciled scheduled workflows: ${synced} synced, ${failed} failed`);
  } catch (error) {
    console.error("[worker] failed to reconcile scheduled workflows", error);
  }
})();

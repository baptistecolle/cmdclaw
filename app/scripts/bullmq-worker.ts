import { startQueues, stopQueues } from "../src/server/queues";
import { closePool } from "../src/server/db/client";
import { reconcileScheduledWorkflowJobs } from "../src/server/services/workflow-scheduler";
import { startGmailWorkflowWatcher } from "../src/server/services/workflow-gmail-watcher";
import { startXDmWorkflowWatcher } from "../src/server/services/workflow-x-dm-watcher";

const {
  worker,
  queueEvents,
  workerConnection,
  queueEventsConnection,
  queueName,
  redisUrl,
} = startQueues();
const stopGmailWatcher = startGmailWorkflowWatcher();
const stopXDmWatcher = startXDmWorkflowWatcher();
let shutdownPromise: Promise<void> | null = null;

const shutdown = async () => {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    console.log("[worker] shutting down...");

    stopGmailWatcher();
    stopXDmWatcher();
    await Promise.allSettled([
      stopQueues(worker, queueEvents, workerConnection, queueEventsConnection),
      closePool(),
    ]);
  })();

  return shutdownPromise;
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

console.log(`[worker] listening on "${queueName}" with redis "${redisUrl}"`);

void (async () => {
  try {
    const { synced, failed } = await reconcileScheduledWorkflowJobs();
    console.log(
      `[worker] reconciled scheduled workflows: ${synced} synced, ${failed} failed`,
    );
  } catch (error) {
    console.error("[worker] failed to reconcile scheduled workflows", error);
  }
})();

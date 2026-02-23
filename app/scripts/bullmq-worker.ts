import { closePool } from "../src/server/db/client";
import {
  buildQueueJobId,
  GENERATION_STALE_REAPER_JOB_NAME,
  getQueue,
  startQueues,
  stopQueues,
} from "../src/server/queues";
import { startGmailWorkflowWatcher } from "../src/server/services/workflow-gmail-watcher";
import { reconcileScheduledWorkflowJobs } from "../src/server/services/workflow-scheduler";
import { startXDmWorkflowWatcher } from "../src/server/services/workflow-x-dm-watcher";

const { worker, queueEvents, workerConnection, queueEventsConnection, queueName, redisUrl } =
  startQueues();
const stopGmailWatcher = startGmailWorkflowWatcher();
const stopXDmWatcher = startXDmWorkflowWatcher();
const staleReaperIntervalMs = 10 * 60 * 1000;
let staleReaperInterval: ReturnType<typeof setInterval> | null = null;
let shutdownPromise: Promise<void> | null = null;

async function enqueueStaleGenerationReaperJob(): Promise<void> {
  const queue = getQueue();
  await queue.add(
    GENERATION_STALE_REAPER_JOB_NAME,
    {},
    {
      jobId: buildQueueJobId([GENERATION_STALE_REAPER_JOB_NAME, Date.now()]),
      removeOnComplete: true,
      removeOnFail: 200,
    },
  );
}

const shutdown = async () => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log("[worker] shutting down...");

    stopGmailWatcher();
    stopXDmWatcher();
    if (staleReaperInterval) {
      clearInterval(staleReaperInterval);
      staleReaperInterval = null;
    }
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
    console.log(`[worker] reconciled scheduled workflows: ${synced} synced, ${failed} failed`);
  } catch (error) {
    console.error("[worker] failed to reconcile scheduled workflows", error);
  }

  try {
    await enqueueStaleGenerationReaperJob();
  } catch (error) {
    console.error("[worker] failed to enqueue stale generation reaper job", error);
  }

  staleReaperInterval = setInterval(() => {
    void enqueueStaleGenerationReaperJob().catch((error) => {
      console.error("[worker] failed to enqueue stale generation reaper job", error);
    });
  }, staleReaperIntervalMs);
})();

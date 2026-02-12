import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integration, integrationToken, workflow, workflowRun } from "@/server/db/schema";
import { getValidAccessToken } from "@/server/integrations/token-refresh";
import { X_DM_WORKFLOW_JOB_NAME, getQueue } from "@/server/queues";

const X_DM_TRIGGER_TYPE = "twitter.new_dm";
const X_DM_EVENT_TYPE = "MessageCreate";
const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
const X_DM_LIST_LIMIT = 50;

type WatchableWorkflow = {
  workflowId: string;
  integrationId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
};

type XDmListResponse = {
  data?: Array<{
    id?: string;
    text?: string;
    event_type?: string;
    sender_id?: string;
    dm_conversation_id?: string;
    created_at?: string;
  }>;
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
      name?: string;
    }>;
  };
};

type XDmSummary = {
  id: string;
  text: string;
  senderId: string;
  senderUsername: string | null;
  conversationId: string | null;
  createdAt: string | null;
};

function getPollIntervalMs(): number {
  const raw = Number(process.env.X_DM_WATCHER_INTERVAL_SECONDS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.floor(raw * 1000);
}

function hasRequiredScopes(scopes: string[] | null): boolean {
  if (!scopes || scopes.length === 0) {
    return false;
  }
  return scopes.includes("dm.read") && scopes.includes("users.read");
}

function isTokenAuthError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  return (
    message.includes("invalid_grant") ||
    message.includes("UNAUTHENTICATED") ||
    message.includes("Invalid Credentials") ||
    message.includes("401")
  );
}

async function listWatchableWorkflows(): Promise<WatchableWorkflow[]> {
  const rows = await db
    .select({
      workflowId: workflow.id,
      integrationId: integration.id,
      accountId: integration.providerAccountId,
      accessToken: integrationToken.accessToken,
      refreshToken: integrationToken.refreshToken,
      expiresAt: integrationToken.expiresAt,
      scopes: integration.scopes,
    })
    .from(workflow)
    .innerJoin(
      integration,
      and(
        eq(integration.userId, workflow.ownerId),
        eq(integration.type, "twitter"),
        eq(integration.enabled, true),
      ),
    )
    .innerJoin(integrationToken, eq(integrationToken.integrationId, integration.id))
    .where(and(eq(workflow.status, "on"), eq(workflow.triggerType, X_DM_TRIGGER_TYPE)));

  return rows.flatMap((row) => {
    if (typeof row.accountId !== "string" || row.accountId.length === 0) {
      return [];
    }
    return [
      {
        workflowId: row.workflowId,
        integrationId: row.integrationId,
        accountId: row.accountId,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt,
        scopes: row.scopes,
      },
    ];
  });
}

async function getWorkflowLastProcessedEventId(workflowId: string): Promise<string | null> {
  const result = await db
    .select({
      maxEventId: sql<
        string | null
      >`max(((${workflowRun.triggerPayload} ->> 'xDmEventId')::bigint)::text)`,
    })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.workflowId, workflowId),
        sql`${workflowRun.triggerPayload} ->> 'source' = ${X_DM_TRIGGER_TYPE}`,
      ),
    );

  return result[0]?.maxEventId ?? null;
}

async function hasRunForXDmEvent(workflowId: string, eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowRun.id })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.workflowId, workflowId),
        sql`${workflowRun.triggerPayload} ->> 'xDmEventId' = ${eventId}`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function listRecentXDmEvents(accessToken: string): Promise<XDmSummary[]> {
  const url = new URL("https://api.x.com/2/dm_events");
  url.searchParams.set("max_results", String(X_DM_LIST_LIMIT));
  url.searchParams.set("event_types", X_DM_EVENT_TYPE);
  url.searchParams.set(
    "dm_event.fields",
    "id,text,event_type,sender_id,dm_conversation_id,created_at",
  );
  url.searchParams.set("expansions", "sender_id");
  url.searchParams.set("user.fields", "id,username,name");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`X DM list request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as XDmListResponse;
  const usersById = new Map(
    (data.includes?.users ?? [])
      .filter((user): user is { id: string; username?: string; name?: string } => !!user.id)
      .map((user) => [user.id, user]),
  );

  const events: XDmSummary[] = [];
  for (const item of data.data ?? []) {
    if (!item.id || !item.sender_id || typeof item.text !== "string") {
      continue;
    }
    const sender = usersById.get(item.sender_id);
    events.push({
      id: item.id,
      text: item.text,
      senderId: item.sender_id,
      senderUsername: sender?.username ?? sender?.name ?? null,
      conversationId: item.dm_conversation_id ?? null,
      createdAt: item.created_at ?? null,
    });
  }

  return events;
}

function compareEventId(a: string, b: string): number {
  try {
    const aValue = BigInt(a);
    const bValue = BigInt(b);
    if (aValue === bValue) {
      return 0;
    }
    return aValue > bValue ? 1 : -1;
  } catch {
    return a.localeCompare(b);
  }
}

async function triggerWorkflowFromXDm(workflowId: string, dm: XDmSummary): Promise<void> {
  const queue = getQueue();
  await queue.add(
    X_DM_WORKFLOW_JOB_NAME,
    {
      workflowId,
      triggerPayload: {
        source: X_DM_TRIGGER_TYPE,
        workflowId,
        xDmEventId: dm.id,
        xDmConversationId: dm.conversationId,
        xDmSenderId: dm.senderId,
        xDmSenderUsername: dm.senderUsername,
        text: dm.text,
        createdAt: dm.createdAt,
        watchedAt: new Date().toISOString(),
      },
    },
    {
      jobId: `workflow-x-dm-${workflowId}-${dm.id}`,
      attempts: 20,
      backoff: {
        type: "exponential",
        delay: 10_000,
      },
      removeOnComplete: true,
    },
  );
}

export async function pollXDmWorkflowTriggers(): Promise<{
  checked: number;
  enqueued: number;
}> {
  const watchable = await listWatchableWorkflows();
  if (watchable.length === 0) {
    return { checked: 0, enqueued: 0 };
  }

  const tokenCache = new Map<string, string>();
  let checked = 0;
  let enqueued = 0;

  await watchable.reduce<Promise<void>>(async (prev, item) => {
    await prev;
    checked += 1;

    if (!hasRequiredScopes(item.scopes)) {
      console.warn(
        `[workflow-x-dm-watcher] workflow ${item.workflowId} skipped: connected X integration is missing dm.read/users.read scope`,
      );
      return;
    }

    try {
      let accessToken = tokenCache.get(item.integrationId);
      if (!accessToken) {
        accessToken = await getValidAccessToken({
          accessToken: item.accessToken,
          refreshToken: item.refreshToken,
          expiresAt: item.expiresAt,
          integrationId: item.integrationId,
          type: "twitter",
        });
        tokenCache.set(item.integrationId, accessToken);
      }

      const lastProcessedEventId = await getWorkflowLastProcessedEventId(item.workflowId);
      const events = await listRecentXDmEvents(accessToken);
      if (events.length === 0) {
        return;
      }

      const incoming = events
        .filter((event) => event.senderId !== item.accountId)
        .filter((event) =>
          lastProcessedEventId ? compareEventId(event.id, lastProcessedEventId) > 0 : true,
        )
        .toSorted((a, b) => compareEventId(a.id, b.id));

      const enqueuedCount = await Promise.all(
        incoming.map(async (event) => {
          const alreadyHandled = await hasRunForXDmEvent(item.workflowId, event.id);
          if (alreadyHandled) {
            return 0;
          }

          try {
            await triggerWorkflowFromXDm(item.workflowId, event);
            return 1;
          } catch (error) {
            console.error(
              `[workflow-x-dm-watcher] failed to trigger workflow ${item.workflowId} for dm ${event.id}`,
              error,
            );
            return 0;
          }
        }),
      );

      enqueued += enqueuedCount.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      if (isTokenAuthError(error)) {
        console.warn(
          `[workflow-x-dm-watcher] auth error for workflow ${item.workflowId}; reconnect X integration may be required`,
        );
      }
      console.error(`[workflow-x-dm-watcher] failed for workflow ${item.workflowId}`, error);
    }
  }, Promise.resolve());

  return { checked, enqueued };
}

export function startXDmWorkflowWatcher(): () => void {
  const intervalMs = getPollIntervalMs();
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }
    isRunning = true;

    try {
      const { checked, enqueued } = await pollXDmWorkflowTriggers();
      if (checked > 0) {
        console.log(
          `[workflow-x-dm-watcher] checked ${checked} workflow(s), enqueued ${enqueued} run(s)`,
        );
      }
    } catch (error) {
      console.error("[workflow-x-dm-watcher] poll failed", error);
    } finally {
      isRunning = false;
    }
  };

  void run();
  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  return () => clearInterval(interval);
}

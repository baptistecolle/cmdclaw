import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integration, integrationToken, workflow, workflowRun } from "@/server/db/schema";
import { getValidAccessToken } from "@/server/integrations/token-refresh";
import { GMAIL_WORKFLOW_JOB_NAME, getQueue } from "@/server/queues";

const GMAIL_TRIGGER_TYPE = "gmail.new_email";
const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_LOOKBACK_SECONDS = 120;
const GMAIL_LIST_LIMIT = 10;

type WatchableWorkflow = {
  workflowId: string;
  integrationId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
};

type GmailMessageSummary = {
  id: string;
  threadId: string | null;
  internalDateMs: number;
  snippet: string;
  subject: string | null;
  from: string | null;
  date: string | null;
};

function getPollIntervalMs(): number {
  const raw = Number(process.env.GMAIL_WATCHER_INTERVAL_SECONDS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.floor(raw * 1000);
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  headerName: string,
): string | null {
  const item = headers?.find((header) => header.name?.toLowerCase() === headerName.toLowerCase());
  return item?.value ?? null;
}

function isGmailAuthError(error: unknown): boolean {
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

async function disableBrokenGmailIntegration(integrationId: string, reason: string): Promise<void> {
  await db
    .update(integration)
    .set({
      enabled: false,
      updatedAt: new Date(),
    })
    .where(eq(integration.id, integrationId));

  console.warn(
    `[workflow-gmail-watcher] disabled gmail integration ${integrationId} due to auth failure (${reason}); reconnect required`,
  );
}

async function listWatchableWorkflows(): Promise<WatchableWorkflow[]> {
  const rows = await db
    .select({
      workflowId: workflow.id,
      integrationId: integration.id,
      accessToken: integrationToken.accessToken,
      refreshToken: integrationToken.refreshToken,
      expiresAt: integrationToken.expiresAt,
    })
    .from(workflow)
    .innerJoin(
      integration,
      and(
        eq(integration.userId, workflow.ownerId),
        eq(integration.type, "gmail"),
        eq(integration.enabled, true),
      ),
    )
    .innerJoin(integrationToken, eq(integrationToken.integrationId, integration.id))
    .where(and(eq(workflow.status, "on"), eq(workflow.triggerType, GMAIL_TRIGGER_TYPE)));

  return rows;
}

async function getWorkflowLastProcessedInternalDate(workflowId: string): Promise<number | null> {
  const result = await db
    .select({
      maxInternalDate: sql<
        string | null
      >`max(((${workflowRun.triggerPayload} ->> 'gmailInternalDate')::bigint)::text)`,
    })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.workflowId, workflowId),
        sql`${workflowRun.triggerPayload} ->> 'source' = ${GMAIL_TRIGGER_TYPE}`,
      ),
    );

  const value = result[0]?.maxInternalDate;
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function hasRunForGmailMessage(workflowId: string, gmailMessageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowRun.id })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.workflowId, workflowId),
        sql`${workflowRun.triggerPayload} ->> 'gmailMessageId' = ${gmailMessageId}`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function listRecentGmailMessages(
  accessToken: string,
  afterSeconds: number,
): Promise<string[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(GMAIL_LIST_LIMIT));
  url.searchParams.set("q", `after:${afterSeconds}`);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail list request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as GmailListResponse;
  return (data.messages ?? []).map((message) => message.id);
}

async function getGmailMessageSummary(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageSummary | null> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.set("metadataHeaders", "Subject");
  url.searchParams.set("metadataHeaders", "From");
  url.searchParams.set("metadataHeaders", "Date");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail get request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as GmailMessageResponse;
  const internalDateMs = Number.parseInt(data.internalDate ?? "", 10);
  if (!Number.isFinite(internalDateMs)) {
    return null;
  }

  return {
    id: data.id,
    threadId: data.threadId ?? null,
    internalDateMs,
    snippet: data.snippet ?? "",
    subject: getHeaderValue(data.payload?.headers, "Subject"),
    from: getHeaderValue(data.payload?.headers, "From"),
    date: getHeaderValue(data.payload?.headers, "Date"),
  };
}

async function triggerWorkflowFromGmailMessage(
  workflowId: string,
  message: GmailMessageSummary,
): Promise<void> {
  const queue = getQueue();
  await queue.add(
    GMAIL_WORKFLOW_JOB_NAME,
    {
      workflowId,
      triggerPayload: {
        source: GMAIL_TRIGGER_TYPE,
        workflowId,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        gmailInternalDate: message.internalDateMs,
        from: message.from,
        subject: message.subject,
        date: message.date,
        snippet: message.snippet,
        watchedAt: new Date().toISOString(),
      },
    },
    {
      jobId: `workflow-gmail-${workflowId}-${message.id}`,
      attempts: 20,
      backoff: {
        type: "exponential",
        delay: 10_000,
      },
      removeOnComplete: true,
    },
  );
}

export async function pollGmailWorkflowTriggers(): Promise<{
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

  for (const item of watchable) {
    checked += 1;

    try {
      let accessToken = tokenCache.get(item.integrationId);
      if (!accessToken) {
        accessToken = await getValidAccessToken({
          accessToken: item.accessToken,
          refreshToken: item.refreshToken,
          expiresAt: item.expiresAt,
          integrationId: item.integrationId,
          type: "gmail",
        });
        tokenCache.set(item.integrationId, accessToken);
      }

      const lastProcessed = await getWorkflowLastProcessedInternalDate(item.workflowId);
      const fallbackStart = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_SECONDS;
      const afterSeconds = Math.max(
        0,
        Math.floor(((lastProcessed ?? fallbackStart * 1000) - 60 * 1000) / 1000),
      );

      const messageIds = await listRecentGmailMessages(accessToken, afterSeconds);
      if (messageIds.length === 0) {
        continue;
      }

      const messages: GmailMessageSummary[] = [];
      for (const messageId of messageIds) {
        try {
          const summary = await getGmailMessageSummary(accessToken, messageId);
          if (summary) {
            messages.push(summary);
          }
        } catch (error) {
          console.error(
            `[workflow-gmail-watcher] failed to fetch message ${messageId} for workflow ${item.workflowId}`,
            error,
          );
        }
      }

      messages.sort((a, b) => a.internalDateMs - b.internalDateMs);

      for (const message of messages) {
        if (lastProcessed !== null && message.internalDateMs <= lastProcessed) {
          continue;
        }

        const alreadyHandled = await hasRunForGmailMessage(item.workflowId, message.id);
        if (alreadyHandled) {
          continue;
        }

        try {
          await triggerWorkflowFromGmailMessage(item.workflowId, message);
          enqueued += 1;
        } catch (error) {
          console.error(
            `[workflow-gmail-watcher] failed to trigger workflow ${item.workflowId} for message ${message.id}`,
            error,
          );
        }
      }
    } catch (error) {
      if (isGmailAuthError(error)) {
        try {
          await disableBrokenGmailIntegration(
            item.integrationId,
            error instanceof Error ? error.message : "auth_error",
          );
        } catch (disableError) {
          console.error(
            `[workflow-gmail-watcher] failed to disable broken gmail integration ${item.integrationId}`,
            disableError,
          );
        }
      }
      console.error(`[workflow-gmail-watcher] failed for workflow ${item.workflowId}`, error);
    }
  }

  return { checked, enqueued };
}

export function startGmailWorkflowWatcher(): () => void {
  const intervalMs = getPollIntervalMs();
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }
    isRunning = true;

    try {
      const { checked, enqueued } = await pollGmailWorkflowTriggers();
      if (checked > 0) {
        console.log(
          `[workflow-gmail-watcher] checked ${checked} workflow(s), enqueued ${enqueued} run(s)`,
        );
      }
    } catch (error) {
      console.error("[workflow-gmail-watcher] poll failed", error);
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

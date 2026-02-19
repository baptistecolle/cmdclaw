import { and, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { env } from "@/env";
import {
  EMAIL_FORWARDED_TRIGGER_TYPE,
  extractEmailAddress,
  parseForwardingTargetFromEmail,
} from "@/lib/email-forwarding";
import { db } from "@/server/db/client";
import { user, workflow, workflowEmailAlias, workflowRun } from "@/server/db/schema";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

const RESEND_EMAIL_RECEIVED_EVENT = "email.received";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type ResendEmailReceivedEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    message_id?: string;
    subject?: string;
    attachments?: Array<unknown>;
  };
};

export type ForwardedEmailQueuePayload = {
  webhookId?: string;
  event: ResendEmailReceivedEvent;
};

function getReceivingDomain(): string | null {
  const value = env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase();
  return value && value.length > 0 ? value : null;
}

function extractRecipientEmails(to: string[] | undefined): string[] {
  if (!Array.isArray(to)) {
    return [];
  }

  return to
    .map((entry) => extractEmailAddress(entry))
    .filter((email): email is string => typeof email === "string");
}

async function hasRunForEmailId(workflowId: string, emailId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowRun.id })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.workflowId, workflowId),
        sql`${workflowRun.triggerPayload} ->> 'emailId' = ${emailId}`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function resolveWorkflowForUserAlias(userId: string): Promise<string | null> {
  const owner = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      defaultForwardedWorkflowId: true,
    },
  });

  if (!owner) {
    return null;
  }

  if (owner.defaultForwardedWorkflowId) {
    const selected = await db.query.workflow.findFirst({
      where: and(
        eq(workflow.id, owner.defaultForwardedWorkflowId),
        eq(workflow.ownerId, owner.id),
        eq(workflow.status, "on"),
        eq(workflow.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
      ),
      columns: { id: true },
    });

    if (selected) {
      return selected.id;
    }
  }

  const candidates = await db.query.workflow.findMany({
    where: and(
      eq(workflow.ownerId, owner.id),
      eq(workflow.status, "on"),
      eq(workflow.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
    ),
    columns: { id: true },
  });

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0].id;
}

async function resolveTargetWorkflow(params: {
  recipients: string[];
  receivingDomain: string;
}): Promise<{ workflowId: string; routingMode: "workflow_alias" | "user_alias" } | null> {
  const aliasTargets = new Set<string>();
  const userTargets = new Set<string>();

  for (const recipient of params.recipients) {
    const target = parseForwardingTargetFromEmail(recipient, params.receivingDomain);
    if (!target) {
      continue;
    }

    if (target.kind === "workflow_alias") {
      aliasTargets.add(target.localPart);
      continue;
    }

    userTargets.add(target.id);
  }

  const aliasMatches = await Promise.all(
    [...aliasTargets].map(async (localPart) => {
      const row = await db
        .select({ workflowId: workflowEmailAlias.workflowId })
        .from(workflowEmailAlias)
        .innerJoin(workflow, eq(workflow.id, workflowEmailAlias.workflowId))
        .where(
          and(
            eq(workflowEmailAlias.localPart, localPart),
            eq(workflowEmailAlias.domain, params.receivingDomain),
            eq(workflowEmailAlias.status, "active"),
            eq(workflow.status, "on"),
            eq(workflow.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
          ),
        )
        .limit(1);

      return row[0]?.workflowId ?? null;
    }),
  );

  const resolvedWorkflow = aliasMatches.find((id): id is string => typeof id === "string");
  if (resolvedWorkflow) {
    return { workflowId: resolvedWorkflow, routingMode: "workflow_alias" };
  }

  const userMatches = await Promise.all(
    [...userTargets].map(async (userId) => {
      return resolveWorkflowForUserAlias(userId);
    }),
  );
  const resolvedFromUserAlias = userMatches.find((id): id is string => typeof id === "string");
  if (resolvedFromUserAlias) {
    return { workflowId: resolvedFromUserAlias, routingMode: "user_alias" };
  }

  return null;
}

async function isAuthorizedSender(workflowId: string, senderEmail: string): Promise<boolean> {
  const row = await db
    .select({ ownerEmail: user.email })
    .from(workflow)
    .innerJoin(user, eq(user.id, workflow.ownerId))
    .where(eq(workflow.id, workflowId))
    .limit(1);

  const ownerEmail = row[0]?.ownerEmail?.toLowerCase();
  return typeof ownerEmail === "string" && ownerEmail === senderEmail.toLowerCase();
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!Array.isArray(headers)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }

    const key =
      "name" in header && typeof (header as { name?: unknown }).name === "string"
        ? (header as { name: string }).name.toLowerCase()
        : null;
    const value =
      "value" in header && typeof (header as { value?: unknown }).value === "string"
        ? (header as { value: string }).value
        : null;

    if (!key || value === null) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function getReceivedEmailContent(emailId: string): Promise<{
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachmentCount: number;
}> {
  if (!resend) {
    throw new Error("Missing RESEND_API_KEY for receiving emails");
  }

  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error) {
    throw new Error(error.message || "Failed to fetch received email body");
  }

  const text = typeof data?.text === "string" ? data.text : null;
  const html = typeof data?.html === "string" ? data.html : null;
  const headers = normalizeHeaders(data?.headers);
  const attachmentCount = Array.isArray(data?.attachments) ? data.attachments.length : 0;

  return { text, html, headers, attachmentCount };
}

export async function processForwardedEmailEvent(
  payload: ForwardedEmailQueuePayload,
): Promise<void> {
  if (payload.event.type !== RESEND_EMAIL_RECEIVED_EVENT) {
    return;
  }

  const emailId = payload.event.data?.email_id;
  if (!emailId) {
    return;
  }

  const receivingDomain = getReceivingDomain();
  if (!receivingDomain) {
    console.error("[workflow-email-forwarding] missing RESEND_RECEIVING_DOMAIN");
    return;
  }

  const recipients = extractRecipientEmails(payload.event.data?.to);
  if (recipients.length === 0) {
    return;
  }

  const sender = extractEmailAddress(payload.event.data?.from);
  if (!sender) {
    return;
  }

  const target = await resolveTargetWorkflow({ recipients, receivingDomain });
  if (!target) {
    return;
  }

  const senderAuthorized = await isAuthorizedSender(target.workflowId, sender);
  if (!senderAuthorized) {
    return;
  }

  const alreadyHandled = await hasRunForEmailId(target.workflowId, emailId);
  if (alreadyHandled) {
    return;
  }

  const content = await getReceivedEmailContent(emailId);

  await triggerWorkflowRun({
    workflowId: target.workflowId,
    triggerPayload: {
      source: EMAIL_FORWARDED_TRIGGER_TYPE,
      routingMode: target.routingMode,
      workflowId: target.workflowId,
      emailId,
      messageId: payload.event.data?.message_id ?? null,
      from: sender,
      to: recipients,
      subject: payload.event.data?.subject ?? null,
      createdAt:
        payload.event.data?.created_at ?? payload.event.created_at ?? new Date().toISOString(),
      text: content.text,
      html: content.html,
      headers: content.headers,
      attachmentCount: content.attachmentCount,
      resendWebhookId: payload.webhookId ?? null,
    },
  });
}

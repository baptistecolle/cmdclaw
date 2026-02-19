import { NextResponse } from "next/server";
import { Resend } from "resend";
import { env } from "@/env";
import { buildQueueJobId, EMAIL_FORWARDED_WORKFLOW_JOB_NAME, getQueue } from "@/server/queues";
import { type ResendEmailReceivedEvent } from "@/server/services/workflow-email-forwarding";

export const runtime = "nodejs";

const resend = new Resend(env.RESEND_API_KEY ?? "re_placeholder");

export async function POST(request: Request) {
  const payload = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";

  if (!env.RESEND_WEBHOOK_SECRET) {
    console.error("[resend-webhook] missing RESEND_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 400 });
  }

  let event: ResendEmailReceivedEvent;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    }) as ResendEmailReceivedEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    if (event.type !== "email.received") {
      return NextResponse.json({ ok: true });
    }

    const emailId = event.data?.email_id;
    if (emailId) {
      const queue = getQueue();
      await queue.add(
        EMAIL_FORWARDED_WORKFLOW_JOB_NAME,
        {
          webhookId: svixId,
          event,
        },
        {
          jobId: buildQueueJobId([EMAIL_FORWARDED_WORKFLOW_JOB_NAME, svixId || emailId]),
          attempts: 20,
          backoff: {
            type: "exponential",
            delay: 30_000,
          },
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
    }
  } catch (error) {
    console.error("[resend-webhook] failed to enqueue", error);
    return NextResponse.json({ error: "Failed to enqueue event" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}

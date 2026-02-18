import { NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack-signature";
import { buildQueueJobId, SLACK_EVENT_JOB_NAME, getQueue } from "@/server/queues";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  // Verify request authenticity
  if (!verifySlackSignature(body, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle Slack URL verification challenge
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Acknowledge immediately (Slack requires response within 3s)
  if (payload.type === "event_callback") {
    const eventId = typeof payload.event_id === "string" ? payload.event_id : undefined;
    if (!eventId) {
      return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
    }

    try {
      const queue = getQueue();
      await queue.add(
        SLACK_EVENT_JOB_NAME,
        { payload, eventId },
        {
          jobId: buildQueueJobId([SLACK_EVENT_JOB_NAME, eventId]),
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
    } catch (err) {
      console.error("[slack-events] Failed to enqueue event:", err);
      return NextResponse.json({ error: "Failed to enqueue event" }, { status: 503 });
    }
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack-signature";
import { handleSlackEvent } from "@/server/services/slack-bot";

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
    // Fire-and-forget async processing
    handleSlackEvent(payload).catch((err) => {
      console.error("[slack-events] Error processing event:", err);
    });
  }

  return NextResponse.json({ ok: true });
}

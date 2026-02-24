import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { slackUserLink } from "@/server/db/schema";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slackUserId = url.searchParams.get("slackUserId");
  const slackTeamId = url.searchParams.get("slackTeamId");

  if (!slackUserId || !slackTeamId) {
    return NextResponse.json({ error: "Missing slackUserId or slackTeamId" }, { status: 400 });
  }

  // Require authenticated session
  const sessionData = await auth.api.getSession({
    headers: await headers(),
  });

  if (!sessionData?.session) {
    // Redirect to login with return URL
    const appUrl = url.origin;
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    return NextResponse.redirect(`${appUrl}/login?redirect=${returnUrl}`);
  }

  const userId = sessionData.session.userId;

  // Create link (upsert - ignore if already exists)
  await db
    .insert(slackUserLink)
    .values({
      slackTeamId,
      slackUserId,
      userId,
    })
    .onConflictDoUpdate({
      target: [slackUserLink.slackTeamId, slackUserLink.slackUserId],
      set: { userId },
    });

  return new NextResponse(
    `<!DOCTYPE html>
<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center">
<h1>Account linked!</h1>
<p>You can now use @cmdclaw in Slack. Head back to your workspace and try it out.</p>
</div>
</body></html>`,
    {
      headers: { "Content-Type": "text/html" },
    },
  );
}

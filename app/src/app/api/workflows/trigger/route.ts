import { NextResponse } from "next/server";
import { env } from "@/env";
import { triggerWorkflowRun } from "@/server/services/workflow-service";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = env.CMDCLAW_SERVER_SECRET ? `Bearer ${env.CMDCLAW_SERVER_SECRET}` : "";

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const workflowId = body?.workflowId;
    const payload = body?.payload ?? {};

    if (!workflowId || typeof workflowId !== "string") {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    const result = await triggerWorkflowRun({
      workflowId,
      triggerPayload: payload,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Workflow trigger error:", error);
    return NextResponse.json({ error: "Failed to trigger workflow" }, { status: 500 });
  }
}

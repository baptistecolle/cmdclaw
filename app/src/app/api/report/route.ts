import { auth } from "@/lib/auth";
import { env } from "@/env";

export const runtime = "nodejs";

type ReportPayload = {
  message?: string;
};

async function postSlackMessage(text: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: env.REPORT_SLACK_CHANNEL_ID,
      text,
    }),
  });

  return response.json() as Promise<{ ok: boolean; error?: string }>;
}

async function slackApiFormData(method: string, formData: FormData) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: formData,
  });

  return response.json() as Promise<{
    ok: boolean;
    error?: string;
    upload_url?: string;
    file_id?: string;
  }>;
}

async function uploadAttachmentToSlack(file: File, initialComment: string) {
  const buffer = Buffer.from(await file.arrayBuffer());

  const getUploadData = new FormData();
  getUploadData.append("filename", file.name || "attachment");
  getUploadData.append("length", buffer.length.toString());

  const uploadUrlResult = await slackApiFormData(
    "files.getUploadURLExternal",
    getUploadData
  );
  if (!uploadUrlResult.ok || !uploadUrlResult.upload_url || !uploadUrlResult.file_id) {
    return {
      ok: false,
      error: uploadUrlResult.error ?? "Could not get Slack upload URL",
    };
  }

  const uploadResponse = await fetch(uploadUrlResult.upload_url, {
    method: "POST",
    body: buffer,
  });

  if (!uploadResponse.ok) {
    return { ok: false, error: "Could not upload attachment bytes to Slack" };
  }

  const completeResponse = await fetch(
    "https://slack.com/api/files.completeUploadExternal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [{ id: uploadUrlResult.file_id, title: file.name || "attachment" }],
        channel_id: env.REPORT_SLACK_CHANNEL_ID,
        initial_comment: initialComment,
      }),
    }
  );

  return completeResponse.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function POST(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.SLACK_BOT_TOKEN || !env.REPORT_SLACK_CHANNEL_ID) {
    return Response.json(
      { error: "Slack reporting is not configured" },
      { status: 500 }
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let message = "";
  let attachment: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const rawMessage = formData.get("message");
    message = typeof rawMessage === "string" ? rawMessage.trim() : "";
    const rawAttachment = formData.get("attachment");
    attachment = rawAttachment instanceof File ? rawAttachment : null;
  } else {
    let payload: ReportPayload;
    try {
      payload = (await request.json()) as ReportPayload;
    } catch {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }
    message = payload.message?.trim() ?? "";
  }

  if (!message) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const reportText = [
    ":beetle: *Bug Report*",
    `*Reported by:* ${sessionData.user.email ?? "unknown"}`,
    `*Submitted at:* ${new Date().toISOString()}`,
    "",
    "*Details:*",
    message,
  ].join("\n");

  const slackResult = attachment
    ? await uploadAttachmentToSlack(attachment, reportText)
    : await postSlackMessage(reportText);

  if (!slackResult.ok) {
    return Response.json(
      { error: slackResult.error ?? "Failed to send report to Slack" },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
}

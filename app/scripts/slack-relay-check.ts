import { parseArgs } from "node:util";

type RelayProbeResult = {
  status: number;
  contentType: string;
  bodyText: string;
};

function resolveRelayUrl(): string | undefined {
  const explicit = process.env.SLACK_BOT_RELAY_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    return undefined;
  }
  return `${appUrl.replace(/\/$/, "")}/api/internal/slack/post-as-bot`;
}

function summarizeBody(bodyText: string): string {
  const cleaned = bodyText.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 240) {
    return cleaned;
  }
  return `${cleaned.slice(0, 240)}...`;
}

async function callRelay(
  relayUrl: string,
  relaySecret: string | undefined,
  payload: Record<string, unknown>,
): Promise<RelayProbeResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (relaySecret) {
    headers.Authorization = `Bearer ${relaySecret}`;
  }

  const response = await fetch(relayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") ?? "unknown";
  const bodyText = await response.text();

  return {
    status: response.status,
    contentType,
    bodyText,
  };
}

function printDiagnosis(result: RelayProbeResult): void {
  const bodySummary = summarizeBody(result.bodyText);
  console.log(`status: ${result.status}`);
  console.log(`content-type: ${result.contentType}`);
  console.log(`body: ${bodySummary}`);

  if (/public url not available/i.test(result.bodyText)) {
    console.log(
      "\ndiagnosis: Relay URL points to a public tunnel that is currently unavailable (not your Slack auth/scopes).",
    );
    return;
  }

  if (result.contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(result.bodyText) as { ok?: boolean; error?: string };
      if (result.status === 401 && parsed.error?.toLowerCase().includes("unauthorized")) {
        console.log(
          "\ndiagnosis: Relay endpoint is reachable, but relay secret is missing or mismatched.",
        );
        return;
      }
      if (result.status === 400 && parsed.error?.includes("channel and text are required")) {
        console.log("\ndiagnosis: Relay endpoint is reachable and authorized.");
        return;
      }
      if (result.status >= 500) {
        console.log("\ndiagnosis: Relay endpoint is reachable but server-side relay failed.");
        return;
      }
    } catch {
      // Keep generic diagnosis below.
    }
  }

  if (result.status >= 500) {
    console.log("\ndiagnosis: Upstream server error while calling relay.");
    return;
  }

  console.log("\ndiagnosis: Received non-standard response; inspect raw body above.");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      channel: { type: "string", short: "c" },
      text: { type: "string", short: "t" },
      thread: { type: "string" },
      conversationId: { type: "string" },
    },
  });

  const relayUrl = resolveRelayUrl();
  if (!relayUrl) {
    console.error("Missing relay URL. Set SLACK_BOT_RELAY_URL or APP_URL.");
    process.exit(1);
  }

  const relaySecret = process.env.SLACK_BOT_RELAY_SECRET?.trim();
  if (!relaySecret) {
    console.warn("Warning: SLACK_BOT_RELAY_SECRET is not set; auth probe may return 401.");
  }

  console.log(`relay-url: ${relayUrl}`);
  console.log(`relay-secret: ${relaySecret ? "present" : "missing"}`);

  const shouldSend = !!values.channel && !!values.text;
  const payload: Record<string, unknown> = shouldSend
    ? {
        channel: values.channel,
        text: values.text,
        ...(values.thread ? { threadTs: values.thread } : {}),
        ...(values.conversationId ? { conversationId: values.conversationId } : {}),
      }
    : {};

  if (!shouldSend) {
    console.log("mode: safe probe (no Slack message will be sent)");
  } else {
    console.log("mode: relay send (will attempt to post to Slack)");
  }

  const result = await callRelay(relayUrl, relaySecret, payload);
  printDiagnosis(result);
}

main().catch((error) => {
  console.error("relay check failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { parseArgs } from "util";

const CLI_ARGS = process.argv.slice(2);
const IS_HELP_REQUEST = CLI_ARGS.includes("--help") || CLI_ARGS.includes("-h");
const TOKEN = process.env.OUTLOOK_ACCESS_TOKEN;
if (!TOKEN && !IS_HELP_REQUEST) {
  console.error("Error: OUTLOOK_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const baseHeaders: Record<string, string> = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const { positionals, values } = parseArgs({
  args: CLI_ARGS,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "10" },
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    cc: { type: "string" },
  },
});

const [command, ...args] = positionals;

function parseLimit(): number {
  const parsed = Number.parseInt(values.limit ?? "10", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --limit. Expected a positive integer.");
  }
  return Math.min(parsed, 50);
}

function sanitizeSearchQuery(query: string): string {
  return query.replace(/"/g, '\\"');
}

function sanitizeFilterLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function mapMessage(message: {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
}) {
  const from = message.from?.emailAddress;
  return {
    id: message.id,
    subject: message.subject ?? "",
    from: from?.address ?? from?.name ?? "",
    date: message.receivedDateTime ?? "",
    snippet: message.bodyPreview ?? "",
    isRead: message.isRead ?? false,
  };
}

async function graphRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init?.headers ? (init.headers as Record<string, string>) : {}),
    },
  });
}

async function listEmails() {
  const top = parseLimit();
  const params = new URLSearchParams({
    $top: String(top),
    $select: "id,subject,from,receivedDateTime,bodyPreview,isRead",
    $orderby: "receivedDateTime desc",
  });

  const headers: Record<string, string> = {};
  if (values.query) {
    params.set("$search", `"${sanitizeSearchQuery(values.query)}"`);
    headers.ConsistencyLevel = "eventual";
  }

  const res = await graphRequest(`/me/messages?${params.toString()}`, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      bodyPreview?: string;
      receivedDateTime?: string;
      isRead?: boolean;
      from?: { emailAddress?: { address?: string; name?: string } };
    }>;
  };

  const items = (payload.value ?? []).map(mapMessage);
  if (items.length === 0) {
    console.log("No emails found.");
    return;
  }

  console.log(JSON.stringify(items, null, 2));
}

async function getEmail(messageId: string) {
  if (!messageId) {
    throw new Error("Required: outlook-mail get <messageId>");
  }

  const params = new URLSearchParams({
    $select:
      "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,isRead,internetMessageId",
  });

  const res = await graphRequest(`/me/messages/${encodeURIComponent(messageId)}?${params}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const email = (await res.json()) as {
    id?: string;
    subject?: string;
    receivedDateTime?: string;
    isRead?: boolean;
    bodyPreview?: string;
    body?: { content?: string };
    from?: { emailAddress?: { address?: string; name?: string } };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  };

  console.log(
    JSON.stringify(
      {
        id: email.id,
        subject: email.subject ?? "",
        from: email.from?.emailAddress?.address ?? email.from?.emailAddress?.name ?? "",
        to: (email.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
        cc: (email.ccRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
        date: email.receivedDateTime ?? "",
        isRead: email.isRead ?? false,
        snippet: email.bodyPreview ?? "",
        body: (email.body?.content ?? "").slice(0, 10000),
      },
      null,
      2,
    ),
  );
}

async function countUnread() {
  parseLimit();
  const params = new URLSearchParams({
    $top: "1",
    $count: "true",
    $select: "id",
  });

  if (values.query) {
    params.set(
      "$filter",
      `isRead eq false and contains(subject,'${sanitizeFilterLiteral(values.query)}')`,
    );
  } else {
    params.set("$filter", "isRead eq false");
  }

  const res = await graphRequest(`/me/messages?${params.toString()}`, {
    headers: { ConsistencyLevel: "eventual" },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    "@odata.count"?: number;
  };

  console.log(`Unread emails: ${payload["@odata.count"] ?? 0}`);
}

async function sendEmail() {
  if (!values.to || !values.subject || !values.body) {
    console.error("Required: --to, --subject, --body");
    process.exit(1);
  }

  const message = {
    subject: values.subject,
    body: {
      contentType: "Text",
      content: values.body,
    },
    toRecipients: [
      {
        emailAddress: { address: values.to },
      },
    ],
    ...(values.cc
      ? {
          ccRecipients: [
            {
              emailAddress: { address: values.cc },
            },
          ],
        }
      : {}),
  };

  const res = await graphRequest("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  console.log("Email sent.");
}

function showHelp() {
  console.log(`Outlook Mail CLI - Commands:
  list [-q query] [-l limit]         List emails
  get <messageId>                    Get email content
  unread [-q query] [-l limit]       Count unread emails
  send --to <email> --subject <subject> --body <body> [--cc <email>]

Options:
  -h, --help                         Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "list":
        await listEmails();
        break;
      case "get":
        await getEmail(args[0]);
        break;
      case "unread":
        await countUnread();
        break;
      case "send":
        await sendEmail();
        break;
      default:
        showHelp();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();

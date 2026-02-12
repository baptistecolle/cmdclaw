// @ts-nocheck
import { parseArgs } from "util";

const TOKEN = process.env.GMAIL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: GMAIL_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
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

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id?: string;
  snippet?: string;
  payload?: GmailPart;
};

async function listEmails() {
  const params = new URLSearchParams({ maxResults: values.limit || "10" });
  if (values.query) params.set("q", values.query);

  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers,
  });
  if (!listRes.ok) throw new Error(await listRes.text());

  const { messages = [] } = (await listRes.json()) as { messages?: Array<{ id: string }> };
  if (messages.length === 0) return console.log("No emails found.");

  const details = await Promise.all(
    messages.slice(0, 20).map(async (msg: { id: string }) => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers },
      );
      return res.ok ? res.json() : null;
    }),
  );

  const emails = details.filter(Boolean).map((e) => {
    const msg = e as GmailMessage;
    const getHeader = (name: string) =>
      msg.payload?.headers?.find((h) => h.name === name)?.value || "";
    return {
      id: msg.id,
      subject: getHeader("Subject"),
      from: getHeader("From"),
      date: getHeader("Date"),
      snippet: msg.snippet,
    };
  });

  console.log(JSON.stringify(emails, null, 2));
}

async function getEmail(messageId: string) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers },
  );
  if (!res.ok) throw new Error(await res.text());

  const email = (await res.json()) as GmailMessage;
  const getHeader = (name: string) =>
    email.payload?.headers?.find((h) => h.name === name)?.value || "";

  const extractBody = (part: GmailPart): string => {
    if (part.body?.data) return Buffer.from(part.body.data, "base64").toString("utf-8");
    if (part.parts) {
      for (const p of part.parts) if (p.mimeType === "text/plain") return extractBody(p);
      for (const p of part.parts) {
        const r = extractBody(p);
        if (r) return r;
      }
    }
    return "";
  };

  console.log(
    JSON.stringify(
      {
        id: email.id,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        body: extractBody(email.payload).slice(0, 10000),
      },
      null,
      2,
    ),
  );
}

async function countUnread() {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=1`,
    { headers },
  );
  if (!res.ok) throw new Error(await res.text());
  const { resultSizeEstimate = 0 } = (await res.json()) as { resultSizeEstimate?: number };
  console.log(`Unread emails: ${resultSizeEstimate}`);
}

async function sendEmail() {
  if (!values.to || !values.subject || !values.body) {
    console.error("Required: --to, --subject, --body");
    process.exit(1);
  }

  const emailLines = [
    `To: ${values.to}`,
    values.cc ? `Cc: ${values.cc}` : "",
    `Subject: ${values.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    values.body,
  ]
    .filter(Boolean)
    .join("\r\n");

  const raw = Buffer.from(emailLines).toString("base64url");
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) throw new Error(await res.text());
  const { id } = (await res.json()) as { id?: string };
  console.log(`Email sent. Message ID: ${id}`);
}

function showHelp() {
  console.log(`Google Gmail CLI - Commands:
  list [-q query] [-l limit]  List emails
  get <messageId>             Get email content
  unread                      Count unread emails
  send --to <email> --subject <subject> --body <body> [--cc <email>]

Options:
  -h, --help                  Show this help message`);
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
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();

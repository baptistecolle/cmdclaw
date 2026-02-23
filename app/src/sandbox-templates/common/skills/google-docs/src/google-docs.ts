import { parseArgs } from "util";

const TOKEN = process.env.GOOGLE_DOCS_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: GOOGLE_DOCS_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const DOCS_URL = "https://docs.googleapis.com/v1/documents";
const DRIVE_URL = "https://www.googleapis.com/drive/v3";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    title: { type: "string", short: "t" },
    content: { type: "string", short: "c" },
    text: { type: "string" },
    limit: { type: "string", short: "l", default: "10" },
  },
});

const [command, ...args] = positionals;

type DocContentElement = {
  paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocContentElement[] }> }> };
  sectionBreak?: Record<string, unknown>;
  endIndex?: number;
};

function extractTextFromContent(content: DocContentElement[]): string {
  const textParts: string[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const paragraphText =
        element.paragraph.elements?.map((el) => el.textRun?.content || "").join("") || "";
      textParts.push(paragraphText);
    } else if (element.table) {
      for (const row of element.table.tableRows || []) {
        const rowTexts: string[] = [];
        for (const cell of row.tableCells || []) {
          const cellText = extractTextFromContent(cell.content || []).trim();
          rowTexts.push(cellText);
        }
        textParts.push(rowTexts.join(" | "));
      }
    } else if (element.sectionBreak) {
      textParts.push("---");
    }
  }

  return textParts.join("");
}

async function getDocument(documentId: string) {
  const res = await fetch(`${DOCS_URL}/${documentId}`, { headers });
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const doc = (await res.json()) as {
    documentId?: string;
    title?: string;
    revisionId?: string;
    body?: { content?: DocContentElement[] };
  };
  const text = extractTextFromContent(doc.body?.content || []);

  console.log(
    JSON.stringify(
      {
        documentId: doc.documentId,
        title: doc.title,
        content: text.slice(0, 50000),
        revisionId: doc.revisionId,
      },
      null,
      2,
    ),
  );
}

async function createDocument() {
  if (!values.title) {
    console.error("Required: --title <title>");
    process.exit(1);
  }

  const res = await fetch(DOCS_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: values.title }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
  const doc = (await res.json()) as { documentId?: string };

  // If content provided, add it
  if (values.content) {
    const updateRes = await fetch(`${DOCS_URL}/${doc.documentId}:batchUpdate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: values.content,
            },
          },
        ],
      }),
    });
    if (!updateRes.ok) {
      throw new Error(await updateRes.text());
    }
  }

  console.log(`Document created: https://docs.google.com/document/d/${doc.documentId}/edit`);
}

async function appendText(documentId: string) {
  if (!values.text) {
    console.error("Required: --text <text>");
    process.exit(1);
  }

  // Get document to find end index
  const getRes = await fetch(`${DOCS_URL}/${documentId}`, { headers });
  if (!getRes.ok) {
    throw new Error(await getRes.text());
  }
  const doc = (await getRes.json()) as { body?: { content?: DocContentElement[] } };

  const endIndex = doc.body?.content?.slice(-1)?.[0]?.endIndex || 1;
  const insertIndex = Math.max(1, endIndex - 1);

  const res = await fetch(`${DOCS_URL}/${documentId}:batchUpdate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: insertIndex },
            text: "\n" + values.text,
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
  console.log("Text appended successfully.");
}

async function listDocuments() {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.document'",
    pageSize: values.limit || "10",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,modifiedTime,webViewLink)",
  });

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const { files = [] } = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string; webViewLink?: string }>;
  };
  const docs = files.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(docs, null, 2));
}

async function searchDocuments() {
  const query = args[0];
  if (!query) {
    console.error("Required: search <query>");
    process.exit(1);
  }

  const params = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.document' and fullText contains '${query.replace(/'/g, "\\'")}'`,
    pageSize: values.limit || "10",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,modifiedTime,webViewLink)",
  });

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const { files = [] } = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string; webViewLink?: string }>;
  };
  const docs = files.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(docs, null, 2));
}

function showHelp() {
  console.log(`Google Docs CLI - Commands:
  get <documentId>                              Get document content
  create --title <title> [--content <text>]     Create a new document
  append <documentId> --text <text>             Append text to document
  list [-l limit]                               List recent documents
  search <query> [-l limit]                     Search documents by content

Example: gdocs get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

Options:
  -h, --help                                    Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "get":
        await getDocument(args[0]);
        break;
      case "create":
        await createDocument();
        break;
      case "append":
        await appendText(args[0]);
        break;
      case "list":
        await listDocuments();
        break;
      case "search":
        await searchDocuments();
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

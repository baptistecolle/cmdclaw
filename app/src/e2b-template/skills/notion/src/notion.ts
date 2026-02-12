// @ts-nocheck
import { parseArgs } from "util";

const TOKEN = process.env.NOTION_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: NOTION_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "10" },
    parent: { type: "string", short: "p" },
    title: { type: "string", short: "t" },
    content: { type: "string", short: "c" },
    type: { type: "string" },
  },
});

const [command, ...args] = positionals;

async function search() {
  const body: Record<string, unknown> = {
    query: values.query || "",
    page_size: parseInt(values.limit || "10"),
  };
  if (values.type === "page" || values.type === "database") {
    body.filter = { value: values.type, property: "object" };
  }

  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());

  const { results } = await res.json();
  const items = results.map((item: Record<string, unknown>) => ({
    id: item.id,
    type: item.object,
    title:
      item.object === "page"
        ? item.properties?.title?.title?.[0]?.plain_text ||
          item.properties?.Name?.title?.[0]?.plain_text ||
          "Untitled"
        : item.title?.[0]?.plain_text || "Untitled",
    url: item.url,
  }));

  console.log(JSON.stringify(items, null, 2));
}

async function getPage(pageId: string) {
  const [pageRes, blocksRes] = await Promise.all([
    fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers }),
    fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
      headers,
    }),
  ]);

  if (!pageRes.ok) throw new Error(await pageRes.text());
  const page = await pageRes.json();
  const blocks = blocksRes.ok ? (await blocksRes.json()).results : [];

  const content = blocks.map((b: Record<string, unknown>) => ({
    type: b.type,
    text: b[b.type]?.rich_text?.map((t: Record<string, unknown>) => t.plain_text).join("") || "",
  }));

  console.log(
    JSON.stringify({ id: page.id, url: page.url, properties: page.properties, content }, null, 2),
  );
}

async function createPage() {
  if (!values.parent || !values.title) {
    console.error(
      "Required: --parent <id> --title <title> [--content <text>] [--type page|database]",
    );
    process.exit(1);
  }

  const parentType = values.type === "database" ? "database_id" : "page_id";
  const properties =
    values.type === "database"
      ? { Name: { title: [{ text: { content: values.title } }] } }
      : { title: { title: [{ text: { content: values.title } }] } };

  const children = values.content
    ? values.content.split("\\n").map((line) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: line } }] },
      }))
    : [];

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { [parentType]: values.parent },
      properties,
      children,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const page = await res.json();
  console.log(`Page created: ${page.url}`);
}

async function appendContent(pageId: string) {
  if (!values.content) {
    console.error("Required: --content <text>");
    process.exit(1);
  }

  const children = values.content.split("\\n").map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: line } }] },
  }));

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ children }),
  });

  if (!res.ok) throw new Error(await res.text());
  console.log("Content appended successfully.");
}

async function listDatabases() {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      filter: { value: "database", property: "object" },
      page_size: 100,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const { results } = await res.json();

  const dbs = results.map((db: Record<string, unknown>) => ({
    id: db.id,
    title: db.title?.[0]?.plain_text || "Untitled",
    url: db.url,
    properties: Object.keys(db.properties || {}),
  }));

  console.log(JSON.stringify(dbs, null, 2));
}

async function queryDatabase(databaseId: string) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ page_size: parseInt(values.limit || "10") }),
  });

  if (!res.ok) throw new Error(await res.text());
  const { results } = await res.json();

  const entries = results.map((page: Record<string, unknown>) => {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(page.properties)) {
      const p = value as unknown;
      if (p.title) props[key] = p.title?.[0]?.plain_text || "";
      else if (p.rich_text) props[key] = p.rich_text?.[0]?.plain_text || "";
      else if (p.number !== undefined) props[key] = p.number;
      else if (p.select) props[key] = p.select?.name || "";
      else if (p.date) props[key] = p.date?.start || "";
      else if (p.checkbox !== undefined) props[key] = p.checkbox;
      else props[key] = "[complex]";
    }
    return { id: page.id, url: page.url, ...props };
  });

  console.log(JSON.stringify(entries, null, 2));
}

function showHelp() {
  console.log(`Notion CLI - Commands:
  search [-q query] [-l limit] [--type page|database]  Search pages/databases
  get <pageId>                                          Get page content
  create --parent <id> --title <title> [--content <text>] [--type database]
  append <pageId> --content <text>                      Append to page
  databases                                             List all databases
  query <databaseId> [-l limit]                         Query database entries

Options:
  -h, --help                                            Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "search":
        await search();
        break;
      case "get":
        await getPage(args[0]);
        break;
      case "create":
        await createPage();
        break;
      case "append":
        await appendContent(args[0]);
        break;
      case "databases":
        await listDatabases();
        break;
      case "query":
        await queryDatabase(args[0]);
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

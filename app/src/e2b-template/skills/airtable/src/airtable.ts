import { parseArgs } from "util";

const TOKEN = process.env.AIRTABLE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: AIRTABLE_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    base: { type: "string", short: "b" },
    table: { type: "string", short: "t" },
    record: { type: "string", short: "r" },
    limit: { type: "string", short: "l", default: "20" },
    view: { type: "string", short: "v" },
    filter: { type: "string", short: "f" },
    fields: { type: "string" },
    search: { type: "string", short: "s" },
    "search-field": { type: "string" },
  },
});

const [command, ...args] = positionals;

async function listBases() {
  const data = await api("/meta/bases");
  const bases = data.bases.map((b: any) => ({
    id: b.id,
    name: b.name,
    permission: b.permissionLevel,
  }));
  console.log(JSON.stringify(bases, null, 2));
}

async function getSchema() {
  if (!values.base) {
    console.error("Required: --base <baseId>");
    process.exit(1);
  }

  const data = await api(`/meta/bases/${values.base}/tables`);
  const tables = data.tables.map((t: any) => ({
    id: t.id,
    name: t.name,
    fields: t.fields.map((f: any) => ({ name: f.name, type: f.type })),
  }));

  console.log(JSON.stringify(tables, null, 2));
}

async function listRecords() {
  if (!values.base || !values.table) {
    console.error("Required: --base <baseId> --table <tableIdOrName>");
    process.exit(1);
  }

  const params = new URLSearchParams({ maxRecords: values.limit || "20" });
  if (values.view) params.set("view", values.view);
  if (values.filter) params.set("filterByFormula", values.filter);

  const data = await api(
    `/${values.base}/${encodeURIComponent(values.table)}?${params}`,
  );
  const records = data.records.map((r: any) => ({ id: r.id, ...r.fields }));
  console.log(JSON.stringify(records, null, 2));
}

async function getRecord() {
  if (!values.base || !values.table || !values.record) {
    console.error(
      "Required: --base <baseId> --table <table> --record <recordId>",
    );
    process.exit(1);
  }

  const record = await api(
    `/${values.base}/${encodeURIComponent(values.table)}/${values.record}`,
  );
  console.log(JSON.stringify({ id: record.id, ...record.fields }, null, 2));
}

async function createRecord() {
  if (!values.base || !values.table || !values.fields) {
    console.error(
      "Required: --base <baseId> --table <table> --fields '<json>'",
    );
    process.exit(1);
  }

  const fields = JSON.parse(values.fields);
  const record = await api(
    `/${values.base}/${encodeURIComponent(values.table)}`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );

  console.log(`Record created: ${record.id}`);
  console.log(JSON.stringify({ id: record.id, ...record.fields }, null, 2));
}

async function updateRecord() {
  if (!values.base || !values.table || !values.record || !values.fields) {
    console.error(
      "Required: --base <baseId> --table <table> --record <recordId> --fields '<json>'",
    );
    process.exit(1);
  }

  const fields = JSON.parse(values.fields);
  const record = await api(
    `/${values.base}/${encodeURIComponent(values.table)}/${values.record}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    },
  );

  console.log(`Record updated: ${record.id}`);
  console.log(JSON.stringify({ id: record.id, ...record.fields }, null, 2));
}

async function deleteRecord() {
  if (!values.base || !values.table || !values.record) {
    console.error(
      "Required: --base <baseId> --table <table> --record <recordId>",
    );
    process.exit(1);
  }

  const result = await api(
    `/${values.base}/${encodeURIComponent(values.table)}/${values.record}`,
    { method: "DELETE" },
  );
  console.log(`Record ${result.id} deleted.`);
}

async function searchRecords() {
  if (
    !values.base ||
    !values.table ||
    !values.search ||
    !values["search-field"]
  ) {
    console.error(
      "Required: --base <baseId> --table <table> --search <value> --search-field <fieldName>",
    );
    process.exit(1);
  }

  const formula = `SEARCH("${values.search}", {${values["search-field"]}})`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: values.limit || "10",
  });

  const data = await api(
    `/${values.base}/${encodeURIComponent(values.table)}?${params}`,
  );
  const records = data.records.map((r: any) => ({ id: r.id, ...r.fields }));
  console.log(JSON.stringify(records, null, 2));
}

function showHelp() {
  console.log(`Airtable CLI - Commands:
  bases                                                 List all bases
  schema -b <baseId>                                    Get base schema
  list -b <baseId> -t <table> [-l limit] [-v view] [-f formula]
  get -b <baseId> -t <table> -r <recordId>              Get single record
  create -b <baseId> -t <table> --fields '{"Name":"value"}'
  update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
  delete -b <baseId> -t <table> -r <recordId>           Delete record
  search -b <baseId> -t <table> -s <value> --search-field <field>

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
      case "bases":
        await listBases();
        break;
      case "schema":
        await getSchema();
        break;
      case "list":
        await listRecords();
        break;
      case "get":
        await getRecord();
        break;
      case "create":
        await createRecord();
        break;
      case "update":
        await updateRecord();
        break;
      case "delete":
        await deleteRecord();
        break;
      case "search":
        await searchRecords();
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

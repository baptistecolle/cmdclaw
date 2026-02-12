import { parseArgs } from "util";

const TOKEN = process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: GOOGLE_SHEETS_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_URL = "https://www.googleapis.com/drive/v3";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    range: { type: "string", short: "r" },
    values: { type: "string", short: "v" },
    title: { type: "string", short: "t" },
    sheet: { type: "string", short: "s" },
    limit: { type: "string", short: "l", default: "10" },
  },
});

const [command, ...args] = positionals;

type SheetInfo = {
  properties?: {
    sheetId?: number;
    title?: string;
    gridProperties?: { rowCount?: number; columnCount?: number };
  };
};

async function getSpreadsheet(spreadsheetId: string) {
  const url = values.range
    ? `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(values.range)}`
    : `${SHEETS_URL}/${spreadsheetId}?includeGridData=false`;

  const res = await fetch(url, { headers });
  if (!res.ok) {throw new Error(await res.text());}

  const data = (await res.json()) as {
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    range?: string;
    values?: unknown[][];
    properties?: { title?: string };
    sheets?: SheetInfo[];
  };

  if (values.range) {
    console.log(
      JSON.stringify(
        {
          spreadsheetId,
          range: data.range,
          values: data.values || [],
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          spreadsheetId: data.spreadsheetId,
          title: data.properties?.title,
          sheets: data.sheets?.map((s) => ({
            sheetId: s.properties?.sheetId,
            title: s.properties?.title,
            rowCount: s.properties?.gridProperties?.rowCount,
            columnCount: s.properties?.gridProperties?.columnCount,
          })),
          url: data.spreadsheetUrl,
        },
        null,
        2,
      ),
    );
  }
}

async function createSpreadsheet() {
  if (!values.title) {
    console.error("Required: --title <title>");
    process.exit(1);
  }

  const res = await fetch(SHEETS_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: values.title },
    }),
  });

  if (!res.ok) {throw new Error(await res.text());}
  const sheet = (await res.json()) as { spreadsheetUrl?: string };
  console.log(`Spreadsheet created: ${sheet.spreadsheetUrl}`);
}

async function appendRows(spreadsheetId: string) {
  if (!values.range || !values.values) {
    console.error('Required: --range <A:B> --values \'[["value1","value2"]]\'');
    process.exit(1);
  }

  let rowValues: unknown[][];
  try {
    rowValues = JSON.parse(values.values);
  } catch {
    console.error('Invalid JSON for --values. Use format: \'[["val1","val2"],["val3","val4"]]\'');
    process.exit(1);
  }

  const res = await fetch(
    `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(values.range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rowValues }),
    },
  );

  if (!res.ok) {throw new Error(await res.text());}
  const result = (await res.json()) as {
    updates?: { updatedRows?: number; updatedRange?: string };
  };
  console.log(
    `Appended ${result.updates?.updatedRows || 0} rows to ${result.updates?.updatedRange}`,
  );
}

async function updateCells(spreadsheetId: string) {
  if (!values.range || !values.values) {
    console.error('Required: --range <A1:B2> --values \'[["value1","value2"]]\'');
    process.exit(1);
  }

  let cellValues: unknown[][];
  try {
    cellValues = JSON.parse(values.values);
  } catch {
    console.error('Invalid JSON for --values. Use format: \'[["val1","val2"],["val3","val4"]]\'');
    process.exit(1);
  }

  const res = await fetch(
    `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(values.range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ values: cellValues }),
    },
  );

  if (!res.ok) {throw new Error(await res.text());}
  const result = (await res.json()) as { updatedCells?: number; updatedRange?: string };
  console.log(`Updated ${result.updatedCells || 0} cells in ${result.updatedRange}`);
}

async function clearRange(spreadsheetId: string) {
  if (!values.range) {
    console.error("Required: --range <A1:B10>");
    process.exit(1);
  }

  const res = await fetch(
    `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(values.range)}:clear`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );

  if (!res.ok) {throw new Error(await res.text());}
  console.log(`Cleared range: ${values.range}`);
}

async function addSheet(spreadsheetId: string) {
  if (!values.title) {
    console.error("Required: --title <sheet name>");
    process.exit(1);
  }

  const res = await fetch(`${SHEETS_URL}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: { title: values.title },
          },
        },
      ],
    }),
  });

  if (!res.ok) {throw new Error(await res.text());}
  const result = (await res.json()) as {
    replies?: Array<{ addSheet?: { properties?: { title?: string; sheetId?: number } } }>;
  };
  const newSheet = result.replies?.[0]?.addSheet?.properties;
  console.log(`Sheet "${newSheet?.title}" added with ID: ${newSheet?.sheetId}`);
}

async function listSpreadsheets() {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
    pageSize: values.limit || "10",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,modifiedTime,webViewLink)",
  });

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) {throw new Error(await res.text());}

  const { files = [] } = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string; webViewLink?: string }>;
  };
  const sheets = files.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(sheets, null, 2));
}

function showHelp() {
  console.log(`Google Sheets CLI - Commands:
  get <spreadsheetId> [--range <A1:D10>]        Get spreadsheet data or metadata
  create --title <title>                         Create a new spreadsheet
  append <spreadsheetId> --range <A:B> --values '[[...]]'   Append rows
  update <spreadsheetId> --range <A1:B2> --values '[[...]]' Update cells
  clear <spreadsheetId> --range <A1:B10>         Clear a range
  add-sheet <spreadsheetId> --title <name>       Add a new sheet
  list [-l limit]                                List recent spreadsheets

Values format: '[["row1col1","row1col2"],["row2col1","row2col2"]]'
Range examples: Sheet1!A1:D10, A1:B5, A:C

Options:
  -h, --help                                     Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "get":
        await getSpreadsheet(args[0]);
        break;
      case "create":
        await createSpreadsheet();
        break;
      case "append":
        await appendRows(args[0]);
        break;
      case "update":
        await updateCells(args[0]);
        break;
      case "clear":
        await clearRange(args[0]);
        break;
      case "add-sheet":
        await addSheet(args[0]);
        break;
      case "list":
        await listSpreadsheets();
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

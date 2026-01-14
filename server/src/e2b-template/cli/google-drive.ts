#!/usr/bin/env bun
import { parseArgs } from "util";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

const TOKEN = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: GOOGLE_DRIVE_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const DRIVE_URL = "https://www.googleapis.com/drive/v3";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    query: { type: "string", short: "q" },
    limit: { type: "string", short: "l", default: "20" },
    output: { type: "string", short: "o" },
    name: { type: "string", short: "n" },
    folder: { type: "string", short: "f" },
    file: { type: "string" },
    mime: { type: "string" },
  },
});

const [command, ...args] = positionals;

const EXPORT_MIMES: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: ".txt" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: ".csv" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "image/png", ext: ".png" },
};

async function listFiles() {
  const params = new URLSearchParams({
    pageSize: values.limit || "20",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
  });

  if (values.query) {
    params.set("q", values.query);
  }

  if (values.folder) {
    const existingQ = params.get("q");
    const folderQuery = `'${values.folder}' in parents`;
    params.set("q", existingQ ? `${existingQ} and ${folderQuery}` : folderQuery);
  }

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) throw new Error(await res.text());

  const { files = [] } = await res.json();
  const items = files.map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? `${Math.round(parseInt(f.size) / 1024)}KB` : "N/A",
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(items, null, 2));
}

async function getFile(fileId: string) {
  const res = await fetch(
    `${DRIVE_URL}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,description,starred`,
    { headers }
  );
  if (!res.ok) throw new Error(await res.text());

  const file = await res.json();
  console.log(JSON.stringify({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? `${Math.round(parseInt(file.size) / 1024)}KB` : "N/A",
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    description: file.description,
    starred: file.starred,
    url: file.webViewLink,
    parents: file.parents,
  }, null, 2));
}

async function downloadFile(fileId: string) {
  // First get file metadata
  const metaRes = await fetch(`${DRIVE_URL}/files/${fileId}?fields=name,mimeType`, { headers });
  if (!metaRes.ok) throw new Error(await metaRes.text());
  const meta = await metaRes.json();

  const isGoogleType = meta.mimeType.startsWith("application/vnd.google-apps.");
  let downloadUrl: string;
  let fileName = values.output || meta.name;

  if (isGoogleType) {
    const exportConfig = EXPORT_MIMES[meta.mimeType];
    if (!exportConfig) {
      console.error(`Cannot export Google type: ${meta.mimeType}`);
      process.exit(1);
    }
    downloadUrl = `${DRIVE_URL}/files/${fileId}/export?mimeType=${encodeURIComponent(exportConfig.mime)}`;
    if (!values.output && !fileName.endsWith(exportConfig.ext)) {
      fileName += exportConfig.ext;
    }
  } else {
    downloadUrl = `${DRIVE_URL}/files/${fileId}?alt=media`;
  }

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok) throw new Error(await res.text());

  const buffer = await res.arrayBuffer();
  await mkdir(dirname(fileName), { recursive: true }).catch(() => {});
  await writeFile(fileName, Buffer.from(buffer));

  console.log(`Downloaded: ${fileName} (${Math.round(buffer.byteLength / 1024)}KB)`);
}

async function searchFiles() {
  if (!values.query) {
    console.error("Required: -q <search query>");
    process.exit(1);
  }

  const params = new URLSearchParams({
    q: `fullText contains '${values.query.replace(/'/g, "\\'")}'`,
    pageSize: values.limit || "20",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
  });

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) throw new Error(await res.text());

  const { files = [] } = await res.json();
  const items = files.map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? `${Math.round(parseInt(f.size) / 1024)}KB` : "N/A",
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(items, null, 2));
}

async function uploadFile() {
  if (!values.file) {
    console.error("Required: --file <path>");
    process.exit(1);
  }

  const file = Bun.file(values.file);
  if (!(await file.exists())) {
    console.error(`File not found: ${values.file}`);
    process.exit(1);
  }

  const fileName = values.name || values.file.split("/").pop();
  const mimeType = values.mime || file.type || "application/octet-stream";

  const metadata: any = { name: fileName };
  if (values.folder) {
    metadata.parents = [values.folder];
  }

  // Use multipart upload
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const fileContent = await file.arrayBuffer();

  const body =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    Buffer.from(fileContent).toString("base64") +
    closeDelimiter;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) throw new Error(await res.text());
  const uploaded = await res.json();
  console.log(`Uploaded: ${uploaded.name} (ID: ${uploaded.id})`);
}

async function createFolder() {
  if (!values.name) {
    console.error("Required: --name <folder name>");
    process.exit(1);
  }

  const metadata: any = {
    name: values.name,
    mimeType: "application/vnd.google-apps.folder",
  };

  if (values.folder) {
    metadata.parents = [values.folder];
  }

  const res = await fetch(`${DRIVE_URL}/files`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) throw new Error(await res.text());
  const folder = await res.json();
  console.log(`Folder created: ${folder.name} (ID: ${folder.id})`);
}

async function deleteFile(fileId: string) {
  const res = await fetch(`${DRIVE_URL}/files/${fileId}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok && res.status !== 204) throw new Error(await res.text());
  console.log(`File deleted: ${fileId}`);
}

async function listFolders() {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.folder'",
    pageSize: values.limit || "20",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,modifiedTime,webViewLink,parents)",
  });

  const res = await fetch(`${DRIVE_URL}/files?${params}`, { headers });
  if (!res.ok) throw new Error(await res.text());

  const { files = [] } = await res.json();
  const folders = files.map((f: any) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    url: f.webViewLink,
  }));

  console.log(JSON.stringify(folders, null, 2));
}

async function main() {
  try {
    switch (command) {
      case "list": await listFiles(); break;
      case "get": await getFile(args[0]); break;
      case "download": await downloadFile(args[0]); break;
      case "search": await searchFiles(); break;
      case "upload": await uploadFile(); break;
      case "mkdir": await createFolder(); break;
      case "delete": await deleteFile(args[0]); break;
      case "folders": await listFolders(); break;
      default:
        console.log(`Google Drive CLI - Commands:
  list [-q query] [-l limit] [-f folderId]      List files
  get <fileId>                                   Get file metadata
  download <fileId> [-o output]                  Download file
  search -q <query> [-l limit]                   Search files by content
  upload --file <path> [--name <name>] [--folder <folderId>] [--mime <type>]
  mkdir --name <name> [--folder <parentId>]      Create a folder
  delete <fileId>                                Delete a file
  folders [-l limit]                             List folders

Query examples:
  -q "name contains 'report'"
  -q "mimeType='application/pdf'"
  -q "modifiedTime > '2024-01-01T00:00:00'"

Google Docs/Sheets/Slides are automatically exported as txt/csv/pdf`);
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();

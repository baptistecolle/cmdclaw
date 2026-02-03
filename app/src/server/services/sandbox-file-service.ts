import { db } from "@/server/db/client";
import { sandboxFile } from "@/server/db/schema";
import { uploadToS3, ensureBucket } from "@/server/storage/s3-client";
import { lookup as mimeLookup } from "mime-types";
import path from "path";
import type { SandboxBackend } from "@/server/sandbox/types";
import type { Sandbox } from "e2b";

export interface SandboxFileUpload {
  path: string;
  content: Buffer;
  conversationId: string;
  messageId?: string;
}

export interface SandboxFileRecord {
  id: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  storageKey: string | null;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const EXCLUDED_PATTERNS = [
  "node_modules",
  ".git",
  ".npm",
  ".cache",
  "__pycache__",
  ".pyc",
  ".pyo",
  ".log",
  ".tmp",
  ".swp",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
];

/**
 * Upload a sandbox file to S3 and save record to database.
 */
export async function uploadSandboxFile(file: SandboxFileUpload): Promise<SandboxFileRecord> {
  const filename = path.basename(file.path);
  const mimeType = mimeLookup(filename) || "application/octet-stream";
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storageKey = `sandbox-files/${file.conversationId}/${Date.now()}-${sanitizedFilename}`;

  await ensureBucket();
  await uploadToS3(storageKey, file.content, mimeType);

  const [record] = await db.insert(sandboxFile).values({
    conversationId: file.conversationId,
    messageId: file.messageId,
    path: file.path,
    filename,
    mimeType,
    sizeBytes: file.content.length,
    storageKey,
  }).returning();

  return {
    id: record.id,
    path: record.path,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    storageKey: record.storageKey,
  };
}

/**
 * Collect new files created in the sandbox since a marker time.
 * Only collects files from /app and /home/user directories.
 */
export async function collectNewSandboxFiles(
  sandbox: SandboxBackend,
  markerTime: number,
  excludePaths: string[] = []
): Promise<Array<{ path: string; content: Buffer }>> {
  // Build grep exclusion pattern
  const excludeGrep = EXCLUDED_PATTERNS.map(p => `grep -v "${p}"`).join(" | ");

  // Find files newer than marker in /app and /home/user, excluding system directories
  // Use Unix timestamp for -newermt
  const markerSeconds = Math.floor(markerTime / 1000);
  const findCmd = `find /app /home/user -type f -newermt "@${markerSeconds}" -size -${MAX_FILE_SIZE}c 2>/dev/null | ${excludeGrep} | head -50`;

  let result;
  try {
    result = await sandbox.execute(findCmd);
  } catch (err) {
    console.error("[SandboxFileService] Failed to find new files:", err);
    return [];
  }

  if (!result.stdout?.trim()) return [];

  const paths = result.stdout.trim().split("\n").filter((p: string) => {
    // Skip empty paths, hidden files, and explicitly excluded paths
    if (!p || p.includes("/.") || excludePaths.includes(p)) {
      return false;
    }
    // Skip if matches any excluded pattern
    for (const pattern of EXCLUDED_PATTERNS) {
      if (p.includes(pattern)) {
        return false;
      }
    }
    return true;
  });

  const files: Array<{ path: string; content: Buffer }> = [];

  for (const filePath of paths) {
    try {
      const content = await sandbox.readFile(filePath);
      if (content) {
        // sandbox.readFile returns a string, convert to Buffer
        files.push({ path: filePath, content: Buffer.from(content) });
      }
    } catch (err) {
      // Skip files we can't read
      console.warn(`[SandboxFileService] Could not read file ${filePath}:`, err);
    }
  }

  return files;
}

/**
 * Collect new files created in an E2B sandbox since a marker time.
 * Only collects files from /app and /home/user directories.
 */
export async function collectNewE2BFiles(
  sandbox: Sandbox,
  markerTime: number,
  excludePaths: string[] = []
): Promise<Array<{ path: string; content: Buffer }>> {
  // Build grep exclusion pattern
  const excludeGrep = EXCLUDED_PATTERNS.map(p => `grep -v "${p}"`).join(" | ");

  // Find files newer than marker in /app and /home/user, excluding system directories
  const markerSeconds = Math.floor(markerTime / 1000);
  const findCmd = `find /app /home/user -type f -newermt "@${markerSeconds}" -size -${MAX_FILE_SIZE}c 2>/dev/null | ${excludeGrep} | head -50`;

  let result;
  try {
    result = await sandbox.commands.run(findCmd);
  } catch (err) {
    console.error("[SandboxFileService] Failed to find new files in E2B:", err);
    return [];
  }

  if (!result.stdout?.trim()) return [];

  const paths = result.stdout.trim().split("\n").filter((p: string) => {
    // Skip empty paths, hidden files, and explicitly excluded paths
    if (!p || p.includes("/.") || excludePaths.includes(p)) {
      return false;
    }
    // Skip if matches any excluded pattern
    for (const pattern of EXCLUDED_PATTERNS) {
      if (p.includes(pattern)) {
        return false;
      }
    }
    return true;
  });

  const files: Array<{ path: string; content: Buffer }> = [];

  for (const filePath of paths) {
    try {
      const content = await sandbox.files.read(filePath);
      if (content) {
        // E2B files.read returns string, convert to Buffer
        files.push({ path: filePath, content: Buffer.from(content) });
      }
    } catch (err) {
      // Skip files we can't read
      console.warn(`[SandboxFileService] Could not read E2B file ${filePath}:`, err);
    }
  }

  return files;
}

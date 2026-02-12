import crypto from "node:crypto";
import OpenAI from "openai";
import { format, parseISO, isValid } from "date-fns";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/server/db/client";
import {
  conversation,
  memoryChunk,
  memoryEntry,
  memoryFile,
  memorySettings,
  message,
  providerAuth,
  sessionTranscript,
  sessionTranscriptChunk,
  type ContentPart,
} from "@/server/db/schema";
import { decrypt } from "@/server/utils/encryption";
import { generateConversationTitle } from "@/server/utils/generate-title";
import { SESSION_BOUNDARY_PREFIX } from "@/server/services/session-constants";

export type MemoryFileType = "longterm" | "daily";

export interface MemoryWriteInput {
  userId: string;
  type?: MemoryFileType;
  path?: string;
  date?: string;
  title?: string;
  tags?: string[];
  content: string;
}

export interface MemorySearchInput {
  userId: string;
  query: string;
  limit?: number;
  type?: MemoryFileType;
  date?: string;
}

export interface MemoryGetInput {
  userId: string;
  path: string;
}

export interface MemorySearchResult {
  id: string;
  path: string;
  score: number;
  snippet: string;
  fileId: string;
  entryId: string | null;
  entryTitle?: string | null;
  source?: "memory" | "session";
}

type MemoryFileRow = typeof memoryFile.$inferSelect;
type MemoryEntryRow = typeof memoryEntry.$inferSelect;
type SessionTranscriptRow = typeof sessionTranscript.$inferSelect;

const DEFAULT_EMBEDDING_PROVIDER = "openai";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_CHUNK_TOKENS = 400;
const DEFAULT_CHUNK_OVERLAP = 80;
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_SCORE_THRESHOLD = 0.35;

const MEMORY_BASE_PATH = "/app/bap";
const SESSION_BASE_PATH = "/app/bap/sessions";

export function getMemoryBasePath(): string {
  return MEMORY_BASE_PATH;
}

export function getSessionBasePath(): string {
  return SESSION_BASE_PATH;
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatDateOnly(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

function formatTimeOnly(value: Date): string {
  return format(value, "HH:mm");
}

function parseDateInput(value?: string): Date | null {
  if (!value) {return null;}
  const parsed = parseISO(value);
  if (!isValid(parsed)) {return null;}
  return parsed;
}

function resolveFileType(input: MemoryWriteInput | MemoryGetInput): {
  type: MemoryFileType;
  date: Date | null;
} | null {
  const path = "path" in input ? input.path : undefined;
  if (path) {
    const normalized = path.trim().replace(/^\//, "");
    if (normalized.toLowerCase() === "memory.md" || normalized === "MEMORY.md") {
      return { type: "longterm", date: null };
    }
    const match = normalized.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/i);
    if (match?.[1]) {
      const parsed = parseDateInput(match[1]);
      if (!parsed) {return null;}
      return { type: "daily", date: parsed };
    }
  }

  if ("type" in input) {
    const type = input.type || "daily";
    if (type === "longterm") {
      return { type, date: null };
    }
    const parsed = parseDateInput(input.date) || new Date();
    return { type, date: parsed };
  }

  return null;
}

function getFilePath(file: MemoryFileRow): string {
  if (file.type === "longterm") {return "MEMORY.md";}
  if (!file.date) {return "memory/unknown.md";}
  return `memory/${formatDateOnly(file.date)}.md`;
}

function getTranscriptPath(transcript: SessionTranscriptRow): string {
  return transcript.path;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

function formatEntryMarkdown(file: MemoryFileRow, entry: MemoryEntryRow): string {
  const createdAt = entry.createdAt || new Date();
  const timeLabel = formatTimeOnly(createdAt);
  const title = entry.title?.trim();
  const header =
    file.type === "daily"
      ? `## ${timeLabel}${title ? ` - ${title}` : ""}`
      : `## ${title || format(createdAt, "yyyy-MM-dd HH:mm")}`;

  const tags =
    entry.tags && entry.tags.length > 0
      ? `\n\nTags: ${entry.tags.map((t) => `#${t}`).join(" ")}`
      : "";

  return `${header}\n\n${entry.content.trim()}${tags}`.trim();
}

function buildEntryEmbeddingText(entry: MemoryEntryRow): string {
  const lines = [];
  if (entry.title) {lines.push(`Title: ${entry.title}`);}
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`Tags: ${entry.tags.join(", ")}`);
  }
  lines.push(entry.content.trim());
  return lines.filter(Boolean).join("\n");
}

function formatTranscriptMarkdown(params: {
  title: string;
  metadata: Array<[string, string | number | null | undefined]>;
  body: string;
}): string {
  const metaLines = params.metadata
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `- ${label}: ${value}`);
  const metaBlock = metaLines.length > 0 ? metaLines.join("\n") : "";
  const parts = [
    `# ${params.title}`,
    metaBlock ? `\n${metaBlock}\n` : "",
    params.body.trim(),
  ].filter(Boolean);
  return parts.join("\n\n").trim() + "\n";
}

export function buildMemorySystemPrompt(): string {
  return `
# Memory

You have access to persistent memory tools:
- memory_search: find relevant past notes and decisions
- memory_get: read a specific memory file
- memory_write: store durable facts, preferences, and decisions

Memory files are materialized in ${MEMORY_BASE_PATH}:
- ${MEMORY_BASE_PATH}/MEMORY.md (long-term)
- ${MEMORY_BASE_PATH}/memory/YYYY-MM-DD.md (daily logs)
- ${SESSION_BASE_PATH}/YYYY-MM-DD-HHMMSS-<slug>.md (session transcripts)

Use memory_search before answering questions about past work, preferences, or decisions.
When you learn something durable, write it to memory_write (daily logs for ongoing work, MEMORY.md for long-term facts).
`;
}

export async function ensureMemoryFile(params: {
  userId: string;
  type: MemoryFileType;
  date: Date | null;
}): Promise<MemoryFileRow> {
  const existing = await db.query.memoryFile.findFirst({
    where: and(
      eq(memoryFile.userId, params.userId),
      eq(memoryFile.type, params.type),
      params.type === "daily" && params.date ? eq(memoryFile.date, params.date) : sql`TRUE`,
    ),
  });

  if (existing) {return existing;}

  const [created] = await db
    .insert(memoryFile)
    .values({
      userId: params.userId,
      type: params.type,
      date: params.type === "daily" ? params.date : null,
      title: params.type === "longterm" ? "Long-term Memory" : null,
    })
    .returning();

  return created;
}

async function resolveMemorySettings(userId: string) {
  const settings = await db.query.memorySettings.findFirst({
    where: eq(memorySettings.userId, userId),
  });

  return {
    provider: settings?.provider || DEFAULT_EMBEDDING_PROVIDER,
    model: settings?.model || DEFAULT_EMBEDDING_MODEL,
    dimensions: settings?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
    chunkTokens: settings?.chunkTokens || DEFAULT_CHUNK_TOKENS,
    chunkOverlap: settings?.chunkOverlap || DEFAULT_CHUNK_OVERLAP,
  };
}

async function getOpenAIApiKey(userId: string): Promise<string | null> {
  const auth = await db.query.providerAuth.findFirst({
    where: and(eq(providerAuth.userId, userId), eq(providerAuth.provider, "openai")),
  });
  if (auth) {
    try {
      return decrypt(auth.accessToken);
    } catch {
      return null;
    }
  }
  return env.OPENAI_API_KEY || null;
}

async function embedTexts(
  userId: string,
  texts: string[],
  model: string,
): Promise<number[][] | null> {
  if (texts.length === 0) {return [];}
  const apiKey = await getOpenAIApiKey(userId);
  if (!apiKey) {return null;}

  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

export function chunkMarkdown(
  content: string,
  chunking: { tokens: number; overlap: number },
): Array<{ startLine: number; endLine: number; text: string; hash: string }> {
  const lines = content.split("\n");
  if (lines.length === 0) {return [];}

  const maxChars = Math.max(32, chunking.tokens * 4);
  const overlapChars = Math.max(0, chunking.overlap * 4);
  const chunks: Array<{
    startLine: number;
    endLine: number;
    text: string;
    hash: string;
  }> = [];

  let current: Array<{ line: string; lineNo: number }> = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) {return;}
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) {return;}
    const text = current.map((entry) => entry.line).join("\n");
    chunks.push({
      startLine: first.lineNo,
      endLine: last.lineNo,
      text,
      hash: hashText(text),
    });
  };

  const carryOverlap = () => {
    if (overlapChars <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) {continue;}
      acc += entry.line.length + 1;
      kept.unshift(entry);
      if (acc >= overlapChars) {break;}
    }
    current = kept;
    currentChars = kept.reduce((sum, entry) => sum + entry.line.length + 1, 0);
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const nextLen = line.length + 1;

    if (currentChars + nextLen > maxChars && current.length > 0) {
      flush();
      carryOverlap();
    }

    current.push({ line, lineNo });
    currentChars += nextLen;
  });

  flush();
  return chunks;
}

export async function writeMemoryEntry(input: MemoryWriteInput): Promise<MemoryEntryRow> {
  const resolved = resolveFileType(input);
  if (!resolved) {
    throw new Error("Invalid memory path or type");
  }

  const file = await ensureMemoryFile({
    userId: input.userId,
    type: resolved.type,
    date: resolved.date,
  });

  const [entry] = await db
    .insert(memoryEntry)
    .values({
      userId: input.userId,
      fileId: file.id,
      title: input.title,
      tags: input.tags,
      content: input.content.trim(),
    })
    .returning();

  const settings = await resolveMemorySettings(input.userId);
  const chunking = {
    tokens: settings.chunkTokens,
    overlap: settings.chunkOverlap,
  };
  const embeddingText = buildEntryEmbeddingText(entry);
  const chunks = chunkMarkdown(embeddingText, chunking);

  let embeddings: number[][] | null = null;
  if (settings.provider === "openai") {
    embeddings = await embedTexts(
      input.userId,
      chunks.map((c) => c.text),
      settings.model,
    );
  }

  if (chunks.length > 0) {
    await db.insert(memoryChunk).values(
      chunks.map((chunk, idx) => ({
        userId: input.userId,
        fileId: file.id,
        entryId: entry.id,
        content: chunk.text,
        contentHash: chunk.hash,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: embeddings ? embeddings[idx] : null,
        embeddingProvider: embeddings ? settings.provider : null,
        embeddingModel: embeddings ? settings.model : null,
        embeddingDimensions: embeddings ? settings.dimensions : null,
      })),
    );
  }

  const fileSnapshot = await readMemoryFile({
    userId: input.userId,
    path: getFilePath(file),
  });

  await db
    .update(memoryFile)
    .set({
      updatedAt: new Date(),
      hash: fileSnapshot ? hashText(fileSnapshot.text) : null,
    })
    .where(eq(memoryFile.id, file.id));

  return entry;
}

export async function readMemoryFile(
  input: MemoryGetInput,
): Promise<{ path: string; text: string } | null> {
  const resolved = resolveFileType(input);
  if (!resolved) {return null;}

  const file = await db.query.memoryFile.findFirst({
    where: and(
      eq(memoryFile.userId, input.userId),
      eq(memoryFile.type, resolved.type),
      resolved.type === "daily" && resolved.date ? eq(memoryFile.date, resolved.date) : sql`TRUE`,
    ),
  });

  if (!file) {return null;}

  const entries = await db.query.memoryEntry.findMany({
    where: eq(memoryEntry.fileId, file.id),
    orderBy: asc(memoryEntry.createdAt),
  });

  const header =
    file.type === "daily"
      ? `# ${file.date ? formatDateOnly(file.date) : "Unknown Date"}`
      : "# Long-term Memory";

  const body = entries.map((entry) => formatEntryMarkdown(file, entry)).join("\n\n");

  return {
    path: getFilePath(file),
    text: [header, body].filter(Boolean).join("\n\n").trim() + "\n",
  };
}

export async function listMemoryFiles(
  userId: string,
): Promise<Array<{ path: string; text: string }>> {
  const files = await db.query.memoryFile.findMany({
    where: eq(memoryFile.userId, userId),
    orderBy: [asc(memoryFile.type), desc(memoryFile.date)],
  });

  const results: Array<{ path: string; text: string }> = [];
  for (const file of files) {
    const entry = await readMemoryFile({ userId, path: getFilePath(file) });
    if (entry) {
      results.push(entry);
    }
  }
  return results;
}

export async function readSessionTranscriptByPath(
  input: MemoryGetInput,
): Promise<{ path: string; text: string } | null> {
  const normalized = input.path.trim().replace(/^\//, "");
  if (!normalized.toLowerCase().startsWith("sessions/")) {return null;}

  const transcript = await db.query.sessionTranscript.findFirst({
    where: and(eq(sessionTranscript.userId, input.userId), eq(sessionTranscript.path, normalized)),
  });

  if (!transcript) {return null;}

  return {
    path: getTranscriptPath(transcript),
    text: transcript.content,
  };
}

export async function listSessionTranscripts(
  userId: string,
): Promise<Array<{ path: string; text: string }>> {
  const transcripts = await db.query.sessionTranscript.findMany({
    where: eq(sessionTranscript.userId, userId),
    orderBy: desc(sessionTranscript.createdAt),
  });

  return transcripts.map((t) => ({
    path: getTranscriptPath(t),
    text: t.content,
  }));
}

export async function writeSessionTranscript(input: {
  userId: string;
  conversationId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  slug?: string | null;
  date?: Date | null;
  source?: string | null;
  messageCount?: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  content: string;
}): Promise<SessionTranscriptRow> {
  const date = input.date ?? new Date();
  const timeLabel = format(date, "HHmmss");
  const safeSlug = input.slug ? slugify(input.slug) : "";
  const slugPart = safeSlug ? `-${safeSlug}` : "-session";
  const path = `sessions/${formatDateOnly(date)}-${timeLabel}${slugPart}.md`;

  const [transcript] = await db
    .insert(sessionTranscript)
    .values({
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      sessionId: input.sessionId ?? null,
      title: input.title ?? null,
      slug: input.slug ? slugify(input.slug) : null,
      path,
      date,
      source: input.source ?? null,
      messageCount: input.messageCount ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      content: input.content.trim(),
    })
    .returning();

  const settings = await resolveMemorySettings(input.userId);
  const chunking = {
    tokens: settings.chunkTokens,
    overlap: settings.chunkOverlap,
  };
  const chunks = chunkMarkdown(transcript.content, chunking);

  let embeddings: number[][] | null = null;
  if (settings.provider === "openai") {
    embeddings = await embedTexts(
      input.userId,
      chunks.map((c) => c.text),
      settings.model,
    );
  }

  if (chunks.length > 0) {
    await db.insert(sessionTranscriptChunk).values(
      chunks.map((chunk, idx) => ({
        userId: input.userId,
        transcriptId: transcript.id,
        content: chunk.text,
        contentHash: chunk.hash,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: embeddings ? embeddings[idx] : null,
        embeddingProvider: embeddings ? settings.provider : null,
        embeddingModel: embeddings ? settings.model : null,
        embeddingDimensions: embeddings ? settings.dimensions : null,
      })),
    );
  }

  return transcript;
}

export async function writeSessionTranscriptFromConversation(input: {
  userId: string;
  conversationId: string;
  source?: string;
  messageLimit?: number;
  excludeUserMessages?: string[];
}): Promise<SessionTranscriptRow | null> {
  const convo = await db.query.conversation.findFirst({
    where: and(eq(conversation.id, input.conversationId), eq(conversation.userId, input.userId)),
  });
  if (!convo) {return null;}

  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, input.conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) {return null;}

  const boundaryIndex = messages
    .map((m, idx) =>
      m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX) ? idx : -1,
    )
    .filter((idx) => idx >= 0)
    .pop();

  const sessionMessages =
    boundaryIndex !== undefined ? messages.slice(boundaryIndex + 1) : messages;

  const trimmedMessages =
    input.messageLimit && sessionMessages.length > input.messageLimit
      ? sessionMessages.slice(-input.messageLimit)
      : sessionMessages;

  const excluded = new Set((input.excludeUserMessages || []).map((value) => value.trim()));

  const messagesForTranscript = trimmedMessages.filter((m) => {
    if (m.role === "user" && excluded.has(m.content.trim())) {
      return false;
    }
    return m.role === "user" || m.role === "assistant";
  });
  if (messagesForTranscript.length === 0) {return null;}

  const lastUser = [...messagesForTranscript].toReversed().find((m) => m.role === "user");
  const lastAssistant = [...messagesForTranscript].toReversed().find((m) => m.role === "assistant");
  const title = await generateConversationTitle(
    lastUser?.content ?? "",
    lastAssistant?.content ?? "",
  );

  const lines: string[] = [];
  for (const msg of messagesForTranscript) {
    const time = msg.createdAt ? format(msg.createdAt, "HH:mm") : "";
    if (msg.role === "assistant" && msg.contentParts && msg.contentParts.length > 0) {
      const textParts = msg.contentParts
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");
      lines.push(`**${msg.role} ${time}**\n${textParts || msg.content}`);
    } else {
      lines.push(`**${msg.role} ${time}**\n${msg.content}`);
    }
  }

  const startedAt = messagesForTranscript[0]?.createdAt ?? null;
  const endedAt = messagesForTranscript[messagesForTranscript.length - 1]?.createdAt ?? null;
  const transcriptTitle = title || "Session Transcript";
  const transcriptBody = lines.join("\n\n");
  const content = formatTranscriptMarkdown({
    title: transcriptTitle,
    metadata: [
      ["conversation_id", input.conversationId],
      ["session_id", convo.opencodeSessionId],
      ["source", input.source || "session_boundary"],
      ["messages", messagesForTranscript.length],
      ["started_at", startedAt ? startedAt.toISOString() : null],
      ["ended_at", endedAt ? endedAt.toISOString() : null],
    ],
    body: transcriptBody,
  });

  return writeSessionTranscript({
    userId: input.userId,
    conversationId: input.conversationId,
    sessionId: convo.opencodeSessionId,
    title: transcriptTitle,
    slug: title || null,
    date: endedAt ?? new Date(),
    source: input.source || "session_boundary",
    messageCount: messagesForTranscript.length,
    startedAt,
    endedAt,
    content,
  });
}

export async function searchMemory(input: MemorySearchInput): Promise<MemorySearchResult[]> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));
  const settings = await resolveMemorySettings(input.userId);

  const fileFilter: string[] = [];
  let filterRequested = false;
  if (input.type || input.date) {
    filterRequested = true;
    const resolved = resolveFileType({
      userId: input.userId,
      type: input.type,
      date: input.date,
      content: "",
    });
    if (resolved) {
      const file = await db.query.memoryFile.findFirst({
        where: and(
          eq(memoryFile.userId, input.userId),
          eq(memoryFile.type, resolved.type),
          resolved.type === "daily" && resolved.date
            ? eq(memoryFile.date, resolved.date)
            : sql`TRUE`,
        ),
      });
      if (file) {
        fileFilter.push(file.id);
      }
    }
  }
  if (filterRequested && fileFilter.length === 0) {
    return [];
  }

  let vectorRows: Array<{
    id: string;
    fileId: string;
    entryId: string | null;
    content: string;
    distance: number;
  }> = [];

  if (settings.provider === "openai") {
    const queryEmbedding = await embedTexts(input.userId, [input.query], settings.model);
    if (queryEmbedding && queryEmbedding[0]) {
      const vectorLiteral = `[${queryEmbedding[0].map((v) => Number(v).toFixed(6)).join(",")}]`;
      const distanceExpr = sql.raw(`embedding <=> '${vectorLiteral}'`);
      const fileClause =
        fileFilter.length > 0 ? sql`and ${memoryChunk.fileId} in ${fileFilter}` : sql``;

      const vectorResult = await db.execute(sql`
        select
          ${memoryChunk.id} as "id",
          ${memoryChunk.fileId} as "fileId",
          ${memoryChunk.entryId} as "entryId",
          ${memoryChunk.content} as "content",
          ${distanceExpr} as "distance"
        from ${memoryChunk}
        where ${memoryChunk.userId} = ${input.userId}
          and ${memoryChunk.embedding} is not null
          ${fileClause}
        order by ${distanceExpr} asc
        limit ${limit * 2}
      `);

      vectorRows = (vectorResult.rows || []) as typeof vectorRows;
    }
  }

  const fileClause =
    fileFilter.length > 0 ? sql`and ${memoryChunk.fileId} in ${fileFilter}` : sql``;

  const textResult = await db.execute(sql`
    select
      ${memoryChunk.id} as "id",
      ${memoryChunk.fileId} as "fileId",
      ${memoryChunk.entryId} as "entryId",
      ${memoryChunk.content} as "content",
      ts_rank_cd(to_tsvector('english', ${memoryChunk.content}), plainto_tsquery('english', ${input.query})) as "rank"
    from ${memoryChunk}
    where ${memoryChunk.userId} = ${input.userId}
      ${fileClause}
      and to_tsvector('english', ${memoryChunk.content}) @@ plainto_tsquery('english', ${input.query})
    order by "rank" desc
    limit ${limit * 2}
  `);

  const textRows = (textResult.rows || []) as Array<{
    id: string;
    fileId: string;
    entryId: string | null;
    content: string;
    rank: number;
  }>;

  const maxRank = textRows.reduce((max, row) => Math.max(max, Number(row.rank) || 0), 0) || 1;

  const combined = new Map<
    string,
    {
      id: string;
      fileId: string;
      entryId: string | null;
      content: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const row of vectorRows) {
    combined.set(row.id, {
      id: row.id,
      fileId: row.fileId,
      entryId: row.entryId,
      content: row.content,
      vectorScore: Math.max(0, 1 - Number(row.distance)),
      textScore: 0,
    });
  }

  for (const row of textRows) {
    const existing = combined.get(row.id);
    const textScore = Math.max(0, Number(row.rank) / maxRank);
    if (existing) {
      existing.textScore = textScore;
    } else {
      combined.set(row.id, {
        id: row.id,
        fileId: row.fileId,
        entryId: row.entryId,
        content: row.content,
        vectorScore: 0,
        textScore,
      });
    }
  }

  const scored = Array.from(combined.values())
    .map((row) => ({
      ...row,
      score: 0.7 * row.vectorScore + 0.3 * row.textScore,
    }))
    .filter((row) => row.score >= DEFAULT_SCORE_THRESHOLD)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) {return [];}

  const fileIds = Array.from(new Set(scored.map((row) => row.fileId)));
  const entryIds = Array.from(
    new Set(scored.map((row) => row.entryId).filter(Boolean)),
  ) as string[];

  const files = await db.query.memoryFile.findMany({
    where: inArray(memoryFile.id, fileIds),
  });
  const fileMap = new Map(files.map((file) => [file.id, file]));

  const entries =
    entryIds.length > 0
      ? await db.query.memoryEntry.findMany({
          where: inArray(memoryEntry.id, entryIds),
        })
      : [];
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

  return scored.map((row) => {
    const file = fileMap.get(row.fileId);
    const entry = row.entryId ? entryMap.get(row.entryId) : null;
    const snippet = row.content.length > 240 ? `${row.content.slice(0, 240)}...` : row.content;
    return {
      id: row.id,
      fileId: row.fileId,
      entryId: row.entryId,
      entryTitle: entry?.title ?? null,
      path: file ? getFilePath(file) : "memory/unknown.md",
      score: Number(row.score.toFixed(4)),
      snippet,
      source: "memory",
    };
  });
}

async function searchSessionTranscripts(input: MemorySearchInput): Promise<MemorySearchResult[]> {
  const settings = await resolveMemorySettings(input.userId);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));

  let vectorRows: Array<{
    id: string;
    transcriptId: string;
    content: string;
    distance: number;
  }> = [];

  if (settings.provider === "openai") {
    const queryEmbedding = await embedTexts(input.userId, [input.query], settings.model);
    if (queryEmbedding && queryEmbedding[0]) {
      const vectorLiteral = `[${queryEmbedding[0].map((v) => Number(v).toFixed(6)).join(",")}]`;
      const distanceExpr = sql.raw(`embedding <=> '${vectorLiteral}'`);

      const vectorResult = await db.execute(sql`
        select
          ${sessionTranscriptChunk.id} as "id",
          ${sessionTranscriptChunk.transcriptId} as "transcriptId",
          ${sessionTranscriptChunk.content} as "content",
          ${distanceExpr} as "distance"
        from ${sessionTranscriptChunk}
        where ${sessionTranscriptChunk.userId} = ${input.userId}
          and ${sessionTranscriptChunk.embedding} is not null
        order by ${distanceExpr} asc
        limit ${limit * 2}
      `);

      vectorRows = (vectorResult.rows || []) as typeof vectorRows;
    }
  }

  const textResult = await db.execute(sql`
    select
      ${sessionTranscriptChunk.id} as "id",
      ${sessionTranscriptChunk.transcriptId} as "transcriptId",
      ${sessionTranscriptChunk.content} as "content",
      ts_rank_cd(to_tsvector('english', ${sessionTranscriptChunk.content}), plainto_tsquery('english', ${input.query})) as "rank"
    from ${sessionTranscriptChunk}
    where ${sessionTranscriptChunk.userId} = ${input.userId}
      and to_tsvector('english', ${sessionTranscriptChunk.content}) @@ plainto_tsquery('english', ${input.query})
    order by "rank" desc
    limit ${limit * 2}
  `);

  const textRows = (textResult.rows || []) as Array<{
    id: string;
    transcriptId: string;
    content: string;
    rank: number;
  }>;

  const maxRank = textRows.reduce((max, row) => Math.max(max, Number(row.rank) || 0), 0) || 1;

  const combined = new Map<
    string,
    {
      id: string;
      transcriptId: string;
      content: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const row of vectorRows) {
    combined.set(row.id, {
      id: row.id,
      transcriptId: row.transcriptId,
      content: row.content,
      vectorScore: Math.max(0, 1 - Number(row.distance)),
      textScore: 0,
    });
  }

  for (const row of textRows) {
    const existing = combined.get(row.id);
    const textScore = Math.max(0, Number(row.rank) / maxRank);
    if (existing) {
      existing.textScore = textScore;
    } else {
      combined.set(row.id, {
        id: row.id,
        transcriptId: row.transcriptId,
        content: row.content,
        vectorScore: 0,
        textScore,
      });
    }
  }

  const scored = Array.from(combined.values())
    .map((row) => ({
      ...row,
      score: 0.7 * row.vectorScore + 0.3 * row.textScore,
    }))
    .filter((row) => row.score >= DEFAULT_SCORE_THRESHOLD)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) {return [];}

  const transcriptIds = Array.from(new Set(scored.map((row) => row.transcriptId)));
  const transcripts = await db.query.sessionTranscript.findMany({
    where: inArray(sessionTranscript.id, transcriptIds),
  });
  const transcriptMap = new Map(transcripts.map((t) => [t.id, t]));

  return scored.map((row) => {
    const transcript = transcriptMap.get(row.transcriptId);
    const snippet = row.content.length > 240 ? `${row.content.slice(0, 240)}...` : row.content;
    return {
      id: row.id,
      fileId: row.transcriptId,
      entryId: null,
      entryTitle: transcript?.title ?? null,
      path: transcript ? getTranscriptPath(transcript) : "sessions/unknown.md",
      score: Number(row.score.toFixed(4)),
      snippet,
      source: "session",
    };
  });
}

export async function searchMemoryWithSessions(
  input: MemorySearchInput,
): Promise<MemorySearchResult[]> {
  const memoryResults = await searchMemory(input);
  if (input.type || input.date) {
    return memoryResults;
  }

  const sessionResults = await searchSessionTranscripts(input);
  const merged = [...memoryResults, ...sessionResults].toSorted((a, b) => b.score - a.score);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));
  return merged.slice(0, limit);
}

export async function syncMemoryToSandbox(
  userId: string,
  writeFile: (path: string, content: string) => Promise<void>,
  ensureDir: (path: string) => Promise<void>,
): Promise<string[]> {
  const files = await listMemoryFiles(userId);
  const transcripts = await listSessionTranscripts(userId);
  if (files.length === 0 && transcripts.length === 0) {return [];}

  await ensureDir(`${MEMORY_BASE_PATH}/memory`);
  await ensureDir(SESSION_BASE_PATH);

  const written: string[] = [];
  for (const file of files) {
    const fullPath = `${MEMORY_BASE_PATH}/${file.path}`;
    await writeFile(fullPath, file.text);
    written.push(fullPath);
  }
  for (const transcript of transcripts) {
    const fullPath = `${MEMORY_BASE_PATH}/${transcript.path}`;
    await writeFile(fullPath, transcript.text);
    written.push(fullPath);
  }
  return written;
}

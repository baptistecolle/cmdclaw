import { env } from "@/env";
import { db } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import { getSandboxState } from "@/server/sandbox/e2b";
import {
  type MemoryFileType,
  readMemoryFile,
  readSessionTranscriptByPath,
  searchMemoryWithSessions,
  syncMemoryToSandbox,
  writeMemoryEntry,
} from "@/server/services/memory-service";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";

const memoryTypeSchema = z.enum(["longterm", "daily"]);

const memoryRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    authHeader: z.string().optional(),
    conversationId: z.string().min(1),
    operation: z.literal("search"),
    payload: z.object({
      query: z.string().optional(),
      limit: z.number().optional(),
      type: memoryTypeSchema.optional(),
      date: z.string().optional(),
    }),
  }),
  z.object({
    authHeader: z.string().optional(),
    conversationId: z.string().min(1),
    operation: z.literal("get"),
    payload: z.object({
      path: z.string(),
    }),
  }),
  z.object({
    authHeader: z.string().optional(),
    conversationId: z.string().min(1),
    operation: z.literal("write"),
    payload: z.object({
      path: z.string().optional(),
      type: memoryTypeSchema.optional(),
      date: z.string().optional(),
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
      content: z.string().optional(),
    }),
  }),
]);

function verifyPluginSecret(authHeader: string | undefined): boolean {
  if (!env.BAP_SERVER_SECRET) {
    console.warn("[Internal] BAP_SERVER_SECRET not configured");
    return false;
  }
  return authHeader === `Bearer ${env.BAP_SERVER_SECRET}`;
}

export async function POST(request: Request) {
  try {
    const parsed = memoryRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const conversationId = input.conversationId;

    if (!verifyPluginSecret(input.authHeader)) {
      console.error("[Internal] Invalid plugin auth for memory request");
      return Response.json({ success: false }, { status: 401 });
    }

    if (!conversationId) {
      return Response.json(
        { success: false, error: "Missing conversationId" },
        { status: 400 },
      );
    }

    const convo = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });

    if (!convo?.userId) {
      return Response.json(
        { success: false, error: "Conversation not found" },
        { status: 404 },
      );
    }

    const userId = convo.userId;

    if (input.operation === "search") {
      const payload = input.payload;
      const results = await searchMemoryWithSessions({
        userId,
        query: payload.query ?? "",
        limit: payload.limit,
        type: payload.type as MemoryFileType | undefined,
        date: payload.date,
      });
      return Response.json({ success: true, results });
    }

    if (input.operation === "get") {
      const payload = input.payload;
      const path = payload.path;
      const result =
        (await readSessionTranscriptByPath({ userId, path })) ??
        (await readMemoryFile({ userId, path }));
      if (!result) {
        return Response.json(
          { success: false, error: "Not found" },
          { status: 404 },
        );
      }
      return Response.json({ success: true, ...result });
    }

    if (input.operation === "write") {
      const payload = input.payload;
      const entry = await writeMemoryEntry({
        userId,
        path: payload.path,
        type: payload.type as MemoryFileType | undefined,
        date: payload.date,
        title: payload.title,
        tags: payload.tags,
        content: payload.content ?? "",
      });

      const state = getSandboxState(conversationId);
      if (state?.sandbox) {
        await syncMemoryToSandbox(
          userId,
          async (path, content) => {
            await state.sandbox.files.write(path, content);
          },
          async (dir) => {
            await state.sandbox.commands.run(`mkdir -p "${dir}"`);
          },
        );
      }

      return Response.json({ success: true, entryId: entry.id });
    }

    return Response.json(
      { success: false, error: "Unknown operation" },
      { status: 400 },
    );
  } catch (error) {
    console.error("[Internal] memory request error:", error);
    return Response.json({ success: false }, { status: 500 });
  }
}

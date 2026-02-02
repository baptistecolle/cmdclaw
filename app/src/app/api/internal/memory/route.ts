import { env } from "@/env";
import { db } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import { getSandboxState } from "@/server/sandbox/e2b";
import {
  readMemoryFile,
  searchMemory,
  syncMemoryToSandbox,
  writeMemoryEntry,
} from "@/server/services/memory-service";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

function verifyPluginSecret(authHeader: string | undefined): boolean {
  if (!env.BAP_SERVER_SECRET) {
    console.warn("[Internal] BAP_SERVER_SECRET not configured");
    return false;
  }
  return authHeader === `Bearer ${env.BAP_SERVER_SECRET}`;
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const conversationId = input.conversationId as string | undefined;

    if (!verifyPluginSecret(input.authHeader)) {
      console.error("[Internal] Invalid plugin auth for memory request");
      return Response.json({ success: false }, { status: 401 });
    }

    if (!conversationId) {
      return Response.json({ success: false, error: "Missing conversationId" }, { status: 400 });
    }

    const convo = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });

    if (!convo?.userId) {
      return Response.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    const userId = convo.userId;
    const operation = input.operation as string;
    const payload = input.payload as Record<string, unknown>;

    if (operation === "search") {
      const results = await searchMemory({
        userId,
        query: String(payload.query || ""),
        limit: payload.limit ? Number(payload.limit) : undefined,
        type: payload.type as any,
        date: payload.date as string | undefined,
      });
      return Response.json({ success: true, results });
    }

    if (operation === "get") {
      const result = await readMemoryFile({
        userId,
        path: String(payload.path || ""),
      });
      if (!result) {
        return Response.json({ success: false, error: "Not found" }, { status: 404 });
      }
      return Response.json({ success: true, ...result });
    }

    if (operation === "write") {
      const entry = await writeMemoryEntry({
        userId,
        path: payload.path as string | undefined,
        type: payload.type as any,
        date: payload.date as string | undefined,
        title: payload.title as string | undefined,
        tags: payload.tags as string[] | undefined,
        content: String(payload.content || ""),
      });

      const state = getSandboxState(conversationId);
      if (state?.sandbox) {
        await syncMemoryToSandbox(
          userId,
          (path, content) => state.sandbox.files.write(path, content),
          (dir) => state.sandbox.commands.run(`mkdir -p "${dir}"`)
        );
      }

      return Response.json({ success: true, entryId: entry.id });
    }

    return Response.json({ success: false, error: "Unknown operation" }, { status: 400 });
  } catch (error) {
    console.error("[Internal] memory request error:", error);
    return Response.json({ success: false }, { status: 500 });
  }
}

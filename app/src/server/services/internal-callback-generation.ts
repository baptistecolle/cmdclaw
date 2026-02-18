import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { conversation, generation } from "@/server/db/schema";

const CALLBACK_ROUTABLE_GENERATION_STATUSES = [
  "running",
  "awaiting_approval",
  "awaiting_auth",
] as const;

export async function resolveGenerationIdForInternalCallback(input: {
  conversationId: string;
  generationId?: string;
  sandboxId?: string;
}): Promise<string | undefined> {
  if (input.generationId) {
    const byGenerationId = await db.query.generation.findFirst({
      where: and(
        eq(generation.id, input.generationId),
        eq(generation.conversationId, input.conversationId),
        inArray(generation.status, [...CALLBACK_ROUTABLE_GENERATION_STATUSES]),
      ),
      columns: {
        id: true,
        sandboxId: true,
      },
    });
    if (!byGenerationId) {
      return undefined;
    }
    if (
      input.sandboxId &&
      byGenerationId.sandboxId &&
      input.sandboxId !== byGenerationId.sandboxId
    ) {
      return undefined;
    }
    return byGenerationId.id;
  }

  if (input.sandboxId) {
    const bySandboxId = await db.query.generation.findFirst({
      where: and(
        eq(generation.conversationId, input.conversationId),
        eq(generation.sandboxId, input.sandboxId),
        inArray(generation.status, [...CALLBACK_ROUTABLE_GENERATION_STATUSES]),
      ),
      orderBy: [desc(generation.startedAt)],
      columns: { id: true },
    });
    if (bySandboxId?.id) {
      return bySandboxId.id;
    }
  }

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, input.conversationId),
    columns: { currentGenerationId: true },
  });
  if (!conv?.currentGenerationId) {
    return undefined;
  }

  const byConversationPointer = await db.query.generation.findFirst({
    where: and(
      eq(generation.id, conv.currentGenerationId),
      eq(generation.conversationId, input.conversationId),
      inArray(generation.status, [...CALLBACK_ROUTABLE_GENERATION_STATUSES]),
    ),
    columns: { id: true },
  });
  return byConversationPointer?.id;
}

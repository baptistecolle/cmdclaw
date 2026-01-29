import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { conversation, message, messageAttachment } from "@/server/db/schema";
import { eq, desc, and, isNull, asc } from "drizzle-orm";

// List conversations for current user
const list = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    })
  )
  .handler(async ({ input, context }) => {
    const conversations = await context.db.query.conversation.findMany({
      where: and(
        eq(conversation.userId, context.user.id),
        eq(conversation.type, "chat"),
        isNull(conversation.archivedAt)
      ),
      orderBy: desc(conversation.updatedAt),
      limit: input.limit + 1,
      with: {
        messages: {
          columns: { id: true },
        },
      },
    });

    const hasMore = conversations.length > input.limit;
    const items = hasMore ? conversations.slice(0, -1) : conversations;

    return {
      conversations: items.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
    };
  });

// Get conversation with messages
const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const conv = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.id),
        eq(conversation.userId, context.user.id),
        eq(conversation.type, "chat")
      ),
      with: {
        messages: {
          orderBy: asc(message.createdAt),
          with: {
            attachments: true,
          },
        },
      },
    });

    if (!conv) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      autoApprove: conv.autoApprove,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        contentParts: m.contentParts,
        createdAt: m.createdAt,
        attachments: m.attachments?.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      })),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  });

// Update conversation title
const updateTitle = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      title: z.string().min(1).max(200),
    })
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ title: input.title })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat")
        )
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Update conversation auto-approve setting
const updateAutoApprove = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      autoApprove: z.boolean(),
    })
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ autoApprove: input.autoApprove })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat")
        )
      )
      .returning({ id: conversation.id, autoApprove: conversation.autoApprove });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, autoApprove: result[0].autoApprove };
  });

// Archive conversation
const archive = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat")
        )
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Delete conversation
const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .delete(conversation)
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat")
        )
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Download attachment (returns presigned URL)
const downloadAttachment = protectedProcedure
  .input(z.object({ attachmentId: z.string() }))
  .handler(async ({ input, context }) => {
    // Find the attachment and verify ownership
    const attachment = await context.db.query.messageAttachment.findFirst({
      where: eq(messageAttachment.id, input.attachmentId),
      with: {
        message: {
          with: {
            conversation: true,
          },
        },
      },
    });

    if (!attachment || attachment.message.conversation.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
    }

    const { getPresignedDownloadUrl } = await import("@/server/storage/s3-client");
    const url = await getPresignedDownloadUrl(attachment.storageKey);

    return { url, filename: attachment.filename, mimeType: attachment.mimeType };
  });

export const conversationRouter = {
  list,
  get,
  updateTitle,
  updateAutoApprove,
  archive,
  delete: del,
  downloadAttachment,
};

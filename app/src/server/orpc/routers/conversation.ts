import { ORPCError } from "@orpc/server";
import { eq, desc, and, isNull, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { conversation, message, messageAttachment, sandboxFile } from "@/server/db/schema";
import { writeSessionTranscriptFromConversation } from "@/server/services/memory-service";
import { protectedProcedure } from "../middleware";

// List conversations for current user
const list = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const conversations = await context.db.query.conversation.findMany({
      where: and(
        eq(conversation.userId, context.user.id),
        eq(conversation.type, "chat"),
        isNull(conversation.archivedAt),
      ),
      orderBy: [desc(conversation.isPinned), desc(conversation.updatedAt)],
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
        isPinned: c.isPinned,
        isShared: c.isShared,
        generationStatus: c.generationStatus,
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
      where: and(eq(conversation.id, input.id), eq(conversation.userId, context.user.id)),
      with: {
        messages: {
          orderBy: asc(message.createdAt),
          with: {
            attachments: true,
            sandboxFiles: true,
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
      isPinned: conv.isPinned,
      isShared: conv.isShared,
      shareToken: conv.shareToken,
      model: conv.model,
      autoApprove: conv.autoApprove,
      messages: conv.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          contentParts: m.contentParts,
          timing: m.timing,
          createdAt: m.createdAt,
          attachments: m.attachments?.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
          sandboxFiles: m.sandboxFiles?.map((f) => ({
            fileId: f.id,
            path: f.path,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
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
    }),
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ title: input.title })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Update conversation pinned setting
const updatePinned = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      isPinned: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ isPinned: input.isPinned })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({
        id: conversation.id,
        isPinned: conversation.isPinned,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, isPinned: result[0].isPinned };
  });

// Update conversation auto-approve setting
const updateAutoApprove = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      autoApprove: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({ autoApprove: input.autoApprove })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat"),
        ),
      )
      .returning({
        id: conversation.id,
        autoApprove: conversation.autoApprove,
      });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, autoApprove: result[0].autoApprove };
  });

// Share conversation via public link
const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({
        isShared: true,
        shareToken: randomUUID(),
        sharedAt: new Date(),
      })
      .where(and(eq(conversation.id, input.id), eq(conversation.userId, context.user.id)))
      .returning({ shareToken: conversation.shareToken });

    if (result.length === 0 || !result[0].shareToken) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true, shareToken: result[0].shareToken };
  });

// Unshare conversation and invalidate existing link
const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .update(conversation)
      .set({
        isShared: false,
        shareToken: null,
        sharedAt: null,
      })
      .where(and(eq(conversation.id, input.id), eq(conversation.userId, context.user.id)))
      .returning({ id: conversation.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    return { success: true };
  });

// Archive conversation
const archive = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    try {
      await writeSessionTranscriptFromConversation({
        userId: context.user.id,
        conversationId: input.id,
        source: "archive",
        messageLimit: 15,
      });
    } catch (err) {
      console.error("[Conversation] Failed to write session transcript on archive:", err);
    }

    const result = await context.db
      .update(conversation)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat"),
        ),
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
    try {
      await writeSessionTranscriptFromConversation({
        userId: context.user.id,
        conversationId: input.id,
        source: "delete",
        messageLimit: 15,
      });
    } catch (err) {
      console.error("[Conversation] Failed to write session transcript on delete:", err);
    }

    const result = await context.db
      .delete(conversation)
      .where(
        and(
          eq(conversation.id, input.id),
          eq(conversation.userId, context.user.id),
          eq(conversation.type, "chat"),
        ),
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

    return {
      url,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    };
  });

// Download sandbox file (returns presigned URL)
const downloadSandboxFile = protectedProcedure
  .input(z.object({ fileId: z.string() }))
  .handler(async ({ input, context }) => {
    // Find the sandbox file and verify ownership
    const file = await context.db.query.sandboxFile.findFirst({
      where: eq(sandboxFile.id, input.fileId),
      with: {
        conversation: true,
      },
    });

    if (!file || file.conversation.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    if (!file.storageKey) {
      throw new ORPCError("NOT_FOUND", { message: "File not uploaded" });
    }

    const { getPresignedDownloadUrl } = await import("@/server/storage/s3-client");
    const url = await getPresignedDownloadUrl(file.storageKey);

    return {
      url,
      filename: file.filename,
      mimeType: file.mimeType,
      path: file.path,
      sizeBytes: file.sizeBytes,
    };
  });

// Get sandbox files for a conversation
const getSandboxFiles = protectedProcedure
  .input(z.object({ conversationId: z.string() }))
  .handler(async ({ input, context }) => {
    // Verify ownership
    const conv = await context.db.query.conversation.findFirst({
      where: and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, context.user.id),
      ),
    });

    if (!conv) {
      throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
    }

    const files = await context.db.query.sandboxFile.findMany({
      where: eq(sandboxFile.conversationId, input.conversationId),
      orderBy: asc(sandboxFile.createdAt),
    });

    return {
      files: files.map((f) => ({
        id: f.id,
        path: f.path,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        messageId: f.messageId,
        createdAt: f.createdAt,
      })),
    };
  });

export const conversationRouter = {
  list,
  get,
  updateTitle,
  updatePinned,
  updateAutoApprove,
  share,
  unshare,
  archive,
  delete: del,
  downloadAttachment,
  downloadSandboxFile,
  getSandboxFiles,
};

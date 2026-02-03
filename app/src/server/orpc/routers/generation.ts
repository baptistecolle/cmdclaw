import { eventIterator } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { generationManager, type GenerationEvent } from "@/server/services/generation-manager";
import { db } from "@/server/db/client";
import { generation, conversation } from "@/server/db/schema";
import { eq } from "drizzle-orm";

// Schema for generation events (same structure as GenerationEvent type)
const generationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_use"),
    toolName: z.string(),
    toolInput: z.unknown(),
    toolUseId: z.string().optional(),
    integration: z.string().optional(),
    operation: z.string().optional(),
    isWrite: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("thinking"),
    content: z.string(),
    thinkingId: z.string(),
  }),
  z.object({
    type: z.literal("pending_approval"),
    generationId: z.string(),
    conversationId: z.string(),
    toolUseId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
    integration: z.string(),
    operation: z.string(),
    command: z.string().optional(),
  }),
  z.object({
    type: z.literal("approval_result"),
    toolUseId: z.string(),
    decision: z.enum(["approved", "denied"]),
  }),
  z.object({
    type: z.literal("auth_needed"),
    generationId: z.string(),
    conversationId: z.string(),
    integrations: z.array(z.string()),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("auth_progress"),
    connected: z.string(),
    remaining: z.array(z.string()),
  }),
  z.object({
    type: z.literal("auth_result"),
    success: z.boolean(),
    integrations: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("done"),
    generationId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalCostUsd: z.number(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("cancelled"),
  }),
  z.object({
    type: z.literal("status_change"),
    status: z.string(),
  }),
  z.object({
    type: z.literal("sandbox_file"),
    fileId: z.string(),
    path: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().nullable(),
  }),
]);

// Start a new generation (returns immediately with generationId)
const startGeneration = protectedProcedure
  .input(
    z.object({
      conversationId: z.string().optional(),
      content: z.string().min(1).max(100000),
      model: z.string().optional(),
      autoApprove: z.boolean().optional(),
      deviceId: z.string().optional(),
      attachments: z.array(z.object({
        name: z.string(),
        mimeType: z.string(),
        dataUrl: z.string(),
      })).optional(),
    })
  )
  .output(
    z.object({
      generationId: z.string(),
      conversationId: z.string(),
    })
  )
  .handler(async ({ input, context }) => {
    const result = await generationManager.startGeneration({
      conversationId: input.conversationId,
      content: input.content,
      model: input.model,
      userId: context.user.id,
      autoApprove: input.autoApprove,
      deviceId: input.deviceId,
      attachments: input.attachments,
    });

    return result;
  });

// Subscribe to generation stream (can be called multiple times, from multiple clients)
const subscribeGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    })
  )
  .output(eventIterator(generationEventSchema))
  .handler(async function* ({ input, context }) {
    const stream = generationManager.subscribeToGeneration(input.generationId, context.user.id);

    for await (const event of stream) {
      yield event;
    }
  });

// Cancel a generation
const cancelGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    })
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    const success = await generationManager.cancelGeneration(input.generationId, context.user.id);
    return { success };
  });

// Resume a paused generation (after approval timeout)
const resumeGeneration = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    })
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    // For now, resume is handled by submitApproval
    // Future: implement sandbox resume when E2B pause/resume is stable
    return { success: false };
  });

// Submit approval decision
const submitApproval = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
      toolUseId: z.string(),
      decision: z.enum(["approve", "deny"]),
    })
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    const success = await generationManager.submitApproval(
      input.generationId,
      input.toolUseId,
      input.decision,
      context.user.id
    );
    return { success };
  });

// Submit auth result (after OAuth completes)
const submitAuthResult = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
      integration: z.string(),
      success: z.boolean(),
    })
  )
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    const success = await generationManager.submitAuthResult(
      input.generationId,
      input.integration,
      input.success,
      context.user.id
    );
    return { success };
  });

// Get generation status (for polling fallback)
const getGenerationStatus = protectedProcedure
  .input(
    z.object({
      generationId: z.string(),
    })
  )
  .output(
    z.object({
      status: z.enum(["running", "awaiting_approval", "awaiting_auth", "paused", "completed", "cancelled", "error"]),
      contentParts: z.array(z.unknown()),
      pendingApproval: z
        .object({
          toolUseId: z.string(),
          toolName: z.string(),
          toolInput: z.unknown(),
          requestedAt: z.string(),
        })
        .nullable(),
      usage: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
      }),
    }).nullable()
  )
  .handler(async ({ input, context }) => {
    // First check if user has access
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, input.generationId),
      with: { conversation: true },
    });

    if (!genRecord) {
      return null;
    }

    if (genRecord.conversation.userId !== context.user.id) {
      throw new Error("Access denied");
    }

    const status = await generationManager.getGenerationStatus(input.generationId);
    return status;
  });

// Get active generation for a conversation
const getActiveGeneration = protectedProcedure
  .input(
    z.object({
      conversationId: z.string(),
    })
  )
  .output(
    z.object({
      generationId: z.string().nullable(),
      status: z.enum(["idle", "generating", "awaiting_approval", "awaiting_auth", "paused", "complete", "error"]).nullable(),
    })
  )
  .handler(async ({ input, context }) => {
    // Check conversation access
    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, input.conversationId),
    });

    if (!conv) {
      throw new Error("Conversation not found");
    }

    if (conv.userId !== context.user.id) {
      throw new Error("Access denied");
    }

    // Map generation status to conversation status
    const mapStatus = (genStatus: string | null | undefined): "idle" | "generating" | "awaiting_approval" | "awaiting_auth" | "paused" | "complete" | "error" | null => {
      if (!genStatus) return null;
      switch (genStatus) {
        case "running": return "generating";
        case "completed": return "complete";
        case "cancelled": return "idle";
        case "awaiting_approval": return "awaiting_approval";
        case "awaiting_auth": return "awaiting_auth";
        case "paused": return "paused";
        case "error": return "error";
        default: return null;
      }
    };

    // Check for in-memory generation first
    const activeGenId = generationManager.getGenerationForConversation(input.conversationId);
    if (activeGenId) {
      const genStatus = await generationManager.getGenerationStatus(activeGenId);
      return {
        generationId: activeGenId,
        status: mapStatus(genStatus?.status),
      };
    }

    // Fall back to conversation's stored state
    return {
      generationId: conv.currentGenerationId,
      status: conv.generationStatus,
    };
  });

export const generationRouter = {
  startGeneration,
  subscribeGeneration,
  cancelGeneration,
  resumeGeneration,
  submitApproval,
  submitAuthResult,
  getGenerationStatus,
  getActiveGeneration,
};

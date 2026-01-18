import { Sandbox } from "e2b";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  conversation,
  generation,
  message,
  type ContentPart,
  type PendingApproval,
} from "@/server/db/schema";
import {
  getOrCreateSandbox,
  runSDKAgentInSandbox,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
  writeApprovalResponse,
  getActiveSandbox,
  killSandbox,
  type SDKAgentEvent,
} from "@/server/sandbox/e2b";
import {
  getCliEnvForUser,
  getCliInstructions,
  getEnabledIntegrationTypes,
} from "@/server/integrations/cli-env";
import { generateConversationTitle } from "@/server/utils/generate-title";
import { env } from "@/env";

// Event types for generation stream
export type GenerationEvent =
  | { type: "text"; content: string }
  | {
      type: "tool_use";
      toolName: string;
      toolInput: unknown;
      toolUseId?: string;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "tool_result"; toolName: string; result: unknown }
  | { type: "thinking"; content: string; thinkingId: string }
  | {
      type: "pending_approval";
      generationId: string;
      conversationId: string;
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
      integration: string;
      operation: string;
      command?: string;
    }
  | { type: "approval_result"; toolUseId: string; decision: "approved" | "denied" }
  | {
      type: "done";
      generationId: string;
      conversationId: string;
      messageId: string;
      usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
    }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "status_change"; status: string };

type GenerationStatus =
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

interface Subscriber {
  id: string;
  callback: (event: GenerationEvent) => void;
}

interface GenerationContext {
  id: string;
  conversationId: string;
  userId: string;
  sandboxId?: string;
  status: GenerationStatus;
  contentParts: ContentPart[];
  assistantContent: string;
  subscribers: Map<string, Subscriber>;
  abortController: AbortController;
  pendingApproval: PendingApproval | null;
  approvalTimeoutId?: ReturnType<typeof setTimeout>;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  sessionId?: string;
  errorMessage?: string;
  startedAt: Date;
  lastSaveAt: Date;
  saveDebounceId?: ReturnType<typeof setTimeout>;
  isNewConversation: boolean;
  model: string;
  userMessageContent: string;
}

// Approval timeout: 5 minutes before pausing sandbox
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
// Save debounce interval for text chunks
const SAVE_DEBOUNCE_MS = 2000;
// Max generation time without subscribers
const MAX_UNATTENDED_GENERATION_MS = 30 * 60 * 1000;

class GenerationManager {
  private activeGenerations = new Map<string, GenerationContext>();
  private conversationToGeneration = new Map<string, string>();

  /**
   * Start a new generation for a conversation
   */
  async startGeneration(params: {
    conversationId?: string;
    content: string;
    model?: string;
    userId: string;
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model } = params;

    // Check for existing active generation on this conversation
    if (params.conversationId) {
      const existingGenId = this.conversationToGeneration.get(params.conversationId);
      if (existingGenId) {
        const existing = this.activeGenerations.get(existingGenId);
        if (existing && existing.status === "running") {
          throw new Error("Generation already in progress for this conversation");
        }
      }
    }

    // Get or create conversation
    let conv: typeof conversation.$inferSelect;
    let isNewConversation = false;

    if (params.conversationId) {
      const existing = await db.query.conversation.findFirst({
        where: eq(conversation.id, params.conversationId),
      });
      if (!existing) {
        throw new Error("Conversation not found");
      }
      if (existing.userId !== userId) {
        throw new Error("Access denied");
      }
      conv = existing;
    } else {
      isNewConversation = true;
      const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      const [newConv] = await db
        .insert(conversation)
        .values({
          userId,
          title,
          model: model ?? "claude-sonnet-4-20250514",
        })
        .returning();
      conv = newConv;
    }

    // Save user message
    await db.insert(message).values({
      conversationId: conv.id,
      role: "user",
      content,
    });

    // Create generation record
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: conv.id,
        status: "running",
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
      })
      .returning();

    // Update conversation status
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: genRecord.id,
      })
      .where(eq(conversation.id, conv.id));

    // Create generation context
    const ctx: GenerationContext = {
      id: genRecord.id,
      conversationId: conv.id,
      userId,
      status: "running",
      contentParts: [],
      assistantContent: "",
      subscribers: new Map(),
      abortController: new AbortController(),
      pendingApproval: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      startedAt: new Date(),
      lastSaveAt: new Date(),
      isNewConversation,
      model: model ?? conv.model ?? "claude-sonnet-4-20250514",
      userMessageContent: content,
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.conversationToGeneration.set(conv.id, genRecord.id);

    // Start the generation in the background
    this.runGeneration(ctx).catch((err) => {
      console.error("[GenerationManager] runGeneration error:", err);
    });

    return {
      generationId: genRecord.id,
      conversationId: conv.id,
    };
  }

  /**
   * Subscribe to a generation's events
   */
  async *subscribeToGeneration(
    generationId: string,
    userId: string
  ): AsyncGenerator<GenerationEvent, void, unknown> {
    const ctx = this.activeGenerations.get(generationId);

    // If no active context, check database for completed/partial generation
    if (!ctx) {
      const genRecord = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
        with: { conversation: true },
      });

      if (!genRecord) {
        yield { type: "error", message: "Generation not found" };
        return;
      }

      // Check access
      if (genRecord.conversation.userId !== userId) {
        yield { type: "error", message: "Access denied" };
        return;
      }

      // If generation is completed/cancelled/error, return final state
      if (
        genRecord.status === "completed" ||
        genRecord.status === "cancelled" ||
        genRecord.status === "error"
      ) {
        // Replay content parts as events
        if (genRecord.contentParts) {
          for (const part of genRecord.contentParts) {
            if (part.type === "text") {
              yield { type: "text", content: part.text };
            } else if (part.type === "tool_use") {
              yield {
                type: "tool_use",
                toolName: part.name,
                toolInput: part.input,
                toolUseId: part.id,
              };
            } else if (part.type === "tool_result") {
              // Find tool name from previous tool_use
              const toolUse = genRecord.contentParts?.find(
                (p): p is ContentPart & { type: "tool_use" } =>
                  p.type === "tool_use" && p.id === part.tool_use_id
              );
              yield {
                type: "tool_result",
                toolName: toolUse?.name ?? "unknown",
                result: part.content,
              };
            } else if (part.type === "thinking") {
              yield { type: "thinking", content: part.content, thinkingId: part.id };
            }
          }
        }

        if (genRecord.status === "completed" && genRecord.messageId) {
          yield {
            type: "done",
            generationId: genRecord.id,
            conversationId: genRecord.conversationId,
            messageId: genRecord.messageId,
            usage: {
              inputTokens: genRecord.inputTokens,
              outputTokens: genRecord.outputTokens,
              totalCostUsd: 0,
            },
          };
        } else if (genRecord.status === "cancelled") {
          yield { type: "cancelled" };
        } else if (genRecord.status === "error") {
          yield { type: "error", message: genRecord.errorMessage || "Unknown error" };
        }
        return;
      }

      // If paused or awaiting approval, we need to resume the context
      // For now, just report the state
      yield { type: "status_change", status: genRecord.status };
      if (genRecord.pendingApproval) {
        yield {
          type: "pending_approval",
          generationId: genRecord.id,
          conversationId: genRecord.conversationId,
          toolUseId: genRecord.pendingApproval.toolUseId,
          toolName: genRecord.pendingApproval.toolName,
          toolInput: genRecord.pendingApproval.toolInput,
          integration: "",
          operation: "",
        };
      }
      return;
    }

    // Check access
    if (ctx.userId !== userId) {
      yield { type: "error", message: "Access denied" };
      return;
    }

    // Create subscriber
    const subscriberId = crypto.randomUUID();
    const eventQueue: GenerationEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let isUnsubscribed = false;

    const subscriber: Subscriber = {
      id: subscriberId,
      callback: (event) => {
        eventQueue.push(event);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      },
    };

    // Replay existing content parts
    for (const part of ctx.contentParts) {
      if (part.type === "text") {
        eventQueue.push({ type: "text", content: part.text });
      } else if (part.type === "tool_use") {
        eventQueue.push({
          type: "tool_use",
          toolName: part.name,
          toolInput: part.input,
          toolUseId: part.id,
        });
      } else if (part.type === "tool_result") {
        const toolUse = ctx.contentParts.find(
          (p): p is ContentPart & { type: "tool_use" } =>
            p.type === "tool_use" && p.id === part.tool_use_id
        );
        eventQueue.push({
          type: "tool_result",
          toolName: toolUse?.name ?? "unknown",
          result: part.content,
        });
      } else if (part.type === "thinking") {
        eventQueue.push({ type: "thinking", content: part.content, thinkingId: part.id });
      }
    }

    // If pending approval, send that event
    if (ctx.pendingApproval) {
      eventQueue.push({
        type: "pending_approval",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        toolUseId: ctx.pendingApproval.toolUseId,
        toolName: ctx.pendingApproval.toolName,
        toolInput: ctx.pendingApproval.toolInput,
        integration: "",
        operation: "",
      });
    }

    ctx.subscribers.set(subscriberId, subscriber);

    try {
      while (!isUnsubscribed) {
        // Yield all queued events
        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;

          // Check for terminal events
          if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
            isUnsubscribed = true;
            break;
          }
        }

        if (isUnsubscribed) break;

        // Check if generation is complete
        if (
          ctx.status === "completed" ||
          ctx.status === "cancelled" ||
          ctx.status === "error"
        ) {
          break;
        }

        // Wait for more events
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 100);
        });
      }
    } finally {
      ctx.subscribers.delete(subscriberId);
    }
  }

  /**
   * Cancel a generation
   */
  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return false;
    }

    if (ctx.userId !== userId) {
      throw new Error("Access denied");
    }

    ctx.abortController.abort();
    await this.finishGeneration(ctx, "cancelled");
    return true;
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(
    generationId: string,
    toolUseId: string,
    decision: "approve" | "deny",
    userId: string
  ): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return false;
    }

    if (ctx.userId !== userId) {
      throw new Error("Access denied");
    }

    if (!ctx.pendingApproval || ctx.pendingApproval.toolUseId !== toolUseId) {
      return false;
    }

    // Clear approval timeout
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
      ctx.approvalTimeoutId = undefined;
    }

    // Write approval to sandbox
    const sandbox = getActiveSandbox(ctx.conversationId);
    if (sandbox) {
      await writeApprovalResponse(sandbox, toolUseId, decision === "approve" ? "allow" : "deny");
    }

    // Clear pending approval
    ctx.pendingApproval = null;
    ctx.status = "running";

    // Update database
    await db
      .update(generation)
      .set({
        status: "running",
        pendingApproval: null,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({ generationStatus: "generating" })
      .where(eq(conversation.id, ctx.conversationId));

    // Notify subscribers
    this.broadcast(ctx, {
      type: "approval_result",
      toolUseId,
      decision: decision === "approve" ? "approved" : "denied",
    });

    return true;
  }

  /**
   * Get the current generation for a conversation
   */
  getGenerationForConversation(conversationId: string): string | undefined {
    return this.conversationToGeneration.get(conversationId);
  }

  /**
   * Get generation status
   */
  async getGenerationStatus(generationId: string): Promise<{
    status: GenerationStatus;
    contentParts: ContentPart[];
    pendingApproval: PendingApproval | null;
    usage: { inputTokens: number; outputTokens: number };
  } | null> {
    const ctx = this.activeGenerations.get(generationId);
    if (ctx) {
      return {
        status: ctx.status,
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        usage: { inputTokens: ctx.usage.inputTokens, outputTokens: ctx.usage.outputTokens },
      };
    }

    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });

    if (!genRecord) {
      return null;
    }

    return {
      status: genRecord.status as GenerationStatus,
      contentParts: genRecord.contentParts ?? [],
      pendingApproval: genRecord.pendingApproval ?? null,
      usage: { inputTokens: genRecord.inputTokens, outputTokens: genRecord.outputTokens },
    };
  }

  // ========== Private Methods ==========

  private async runGeneration(ctx: GenerationContext): Promise<void> {
    try {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      // Get user's CLI environment and integrations
      const [cliEnv, enabledIntegrations] = await Promise.all([
        getCliEnvForUser(ctx.userId),
        getEnabledIntegrationTypes(ctx.userId),
      ]);

      const cliInstructions = getCliInstructions(enabledIntegrations);

      // Get or create sandbox
      const sandbox = await getOrCreateSandbox({
        conversationId: ctx.conversationId,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        integrationEnvs: cliEnv,
      });

      // Sandbox is tracked by conversation ID in the e2b module

      // Write skills to sandbox
      const writtenSkills = await writeSkillsToSandbox(sandbox, ctx.userId);
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);

      // Build system prompt
      const baseSystemPrompt = "You are Bap, an AI agent that helps do work.";
      const systemPromptParts = [baseSystemPrompt, cliInstructions, skillsInstructions].filter(
        Boolean
      );
      const systemPrompt = systemPromptParts.join("\n\n");

      // Get conversation for session ID
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
      });

      // Run SDK agent
      const agentStream = runSDKAgentInSandbox(sandbox, ctx.userMessageContent, {
        model: ctx.model,
        resume: conv?.claudeSessionId ?? undefined,
        systemPrompt,
      });

      let currentTextPart: { type: "text"; text: string } | null = null;

      for await (const event of agentStream) {
        if (ctx.abortController.signal.aborted) {
          break;
        }

        // Handle SDK-specific events
        if (event.type === "approval_needed") {
          await this.handleApprovalNeeded(ctx, event);
          continue;
        }

        if (event.type === "approval_result") {
          this.broadcast(ctx, {
            type: "approval_result",
            toolUseId: event.toolUseId || "",
            decision: event.decision === "approved" ? "approved" : "denied",
          });
          continue;
        }

        if (event.type === "tool_use_integration") {
          this.broadcast(ctx, {
            type: "tool_use",
            toolName: "Bash",
            toolInput: event.toolInput,
            toolUseId: event.toolUseId,
            integration: event.integration,
            operation: event.operation,
            isWrite: event.isWrite,
          });
          continue;
        }

        // Process standard events
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              ctx.assistantContent += block.text;
              this.broadcast(ctx, { type: "text", content: block.text });

              if (currentTextPart) {
                currentTextPart.text += block.text;
              } else {
                currentTextPart = { type: "text", text: block.text };
                ctx.contentParts.push(currentTextPart);
              }

              this.scheduleSave(ctx);
            } else if (block.type === "thinking" && block.thinking) {
              currentTextPart = null;
              const thinkingId = `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              this.broadcast(ctx, {
                type: "thinking",
                content: block.thinking,
                thinkingId,
              });
              ctx.contentParts.push({
                type: "thinking",
                id: thinkingId,
                content: block.thinking,
              });
              this.scheduleSave(ctx);
            } else if (block.type === "tool_use" && block.name) {
              currentTextPart = null;
              this.broadcast(ctx, {
                type: "tool_use",
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
              });
              ctx.contentParts.push({
                type: "tool_use",
                id: block.id || "",
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              await this.saveProgress(ctx); // Save immediately after tool_use
            }
          }
        } else if (event.type === "user" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const toolUse = ctx.contentParts.find(
                (p): p is ContentPart & { type: "tool_use" } =>
                  p.type === "tool_use" && p.id === block.tool_use_id
              );
              if (toolUse) {
                this.broadcast(ctx, {
                  type: "tool_result",
                  toolName: toolUse.name,
                  result: block.content,
                });
                ctx.contentParts.push({
                  type: "tool_result",
                  tool_use_id: block.tool_use_id,
                  content: block.content,
                });
                await this.saveProgress(ctx); // Save immediately after tool_result
              }
            }
          }
        } else if (event.type === "result") {
          if (event.subtype === "success") {
            ctx.usage = {
              inputTokens: event.usage?.input_tokens ?? 0,
              outputTokens: event.usage?.output_tokens ?? 0,
              totalCostUsd: event.total_cost_usd ?? 0,
            };
            ctx.sessionId = event.session_id;
          } else if (event.subtype === "error") {
            throw new Error(event.error || "Unknown error");
          }
        }
      }

      // Check if aborted
      if (ctx.abortController.signal.aborted) {
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      // Complete the generation
      await this.finishGeneration(ctx, "completed");
    } catch (error) {
      console.error("[GenerationManager] Error:", error);
      ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.finishGeneration(ctx, "error");
    }
  }

  private async handleApprovalNeeded(ctx: GenerationContext, event: SDKAgentEvent): Promise<void> {
    ctx.status = "awaiting_approval";
    ctx.pendingApproval = {
      toolUseId: event.toolUseId || "",
      toolName: event.toolName || "Bash",
      toolInput: (event.toolInput as Record<string, unknown>) || {},
      requestedAt: new Date().toISOString(),
    };

    // Update database
    await db
      .update(generation)
      .set({
        status: "awaiting_approval",
        pendingApproval: ctx.pendingApproval,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({ generationStatus: "awaiting_approval" })
      .where(eq(conversation.id, ctx.conversationId));

    // Notify subscribers
    this.broadcast(ctx, {
      type: "pending_approval",
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      toolUseId: event.toolUseId || "",
      toolName: event.toolName || "Bash",
      toolInput: event.toolInput,
      integration: event.integration || "",
      operation: event.operation || "",
      command: event.command,
    });

    // Start approval timeout
    ctx.approvalTimeoutId = setTimeout(() => {
      this.handleApprovalTimeout(ctx);
    }, APPROVAL_TIMEOUT_MS);
  }

  private async handleApprovalTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_approval" || !ctx.pendingApproval) {
      return;
    }

    console.log(`[GenerationManager] Approval timeout for generation ${ctx.id}, pausing sandbox`);

    ctx.status = "paused";

    // Update database
    await db
      .update(generation)
      .set({
        status: "paused",
        isPaused: true,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({ generationStatus: "paused" })
      .where(eq(conversation.id, ctx.conversationId));

    // Pause sandbox (if E2B supports it)
    // Note: E2B pause/resume is a beta feature
    // For now, we'll just keep the sandbox alive but paused in our state

    this.broadcast(ctx, { type: "status_change", status: "paused" });
  }

  private async finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error"
  ): Promise<void> {
    // Clear any pending timeouts
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
    }

    ctx.status = status;

    let messageId: string | undefined;

    if (status === "completed") {
      // Update session ID
      if (ctx.sessionId) {
        await db
          .update(conversation)
          .set({ claudeSessionId: ctx.sessionId })
          .where(eq(conversation.id, ctx.conversationId));
      }

      // Save assistant message
      const [assistantMessage] = await db
        .insert(message)
        .values({
          conversationId: ctx.conversationId,
          role: "assistant",
          content: ctx.assistantContent || "I apologize, but I couldn't generate a response.",
          contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
          inputTokens: ctx.usage.inputTokens,
          outputTokens: ctx.usage.outputTokens,
        })
        .returning();

      messageId = assistantMessage.id;

      // Generate title for new conversations
      if (ctx.isNewConversation && ctx.assistantContent) {
        try {
          const title = await generateConversationTitle(
            ctx.userMessageContent,
            ctx.assistantContent
          );
          if (title) {
            await db
              .update(conversation)
              .set({ title })
              .where(eq(conversation.id, ctx.conversationId));
          }
        } catch (err) {
          console.error("[GenerationManager] Failed to generate title:", err);
        }
      }
    }

    // Update generation record
    await db
      .update(generation)
      .set({
        status,
        messageId,
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        errorMessage: ctx.errorMessage,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
        completedAt: new Date(),
      })
      .where(eq(generation.id, ctx.id));

    // Update conversation status
    await db
      .update(conversation)
      .set({
        generationStatus: status === "completed" ? "complete" : status === "error" ? "error" : "idle",
      })
      .where(eq(conversation.id, ctx.conversationId));

    // Notify subscribers
    if (status === "completed" && messageId) {
      this.broadcast(ctx, {
        type: "done",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        messageId,
        usage: ctx.usage,
      });
    } else if (status === "cancelled") {
      this.broadcast(ctx, { type: "cancelled" });
    } else if (status === "error") {
      this.broadcast(ctx, { type: "error", message: ctx.errorMessage || "Unknown error" });
    }

    // Cleanup
    this.activeGenerations.delete(ctx.id);
    this.conversationToGeneration.delete(ctx.conversationId);
  }

  private scheduleSave(ctx: GenerationContext): void {
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }

    ctx.saveDebounceId = setTimeout(() => {
      this.saveProgress(ctx);
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveProgress(ctx: GenerationContext): Promise<void> {
    ctx.lastSaveAt = new Date();

    await db
      .update(generation)
      .set({
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
      })
      .where(eq(generation.id, ctx.id));
  }

  private broadcast(ctx: GenerationContext, event: GenerationEvent): void {
    for (const subscriber of ctx.subscribers.values()) {
      try {
        subscriber.callback(event);
      } catch (err) {
        console.error("[GenerationManager] Subscriber callback error:", err);
      }
    }
  }
}

// Singleton instance
export const generationManager = new GenerationManager();

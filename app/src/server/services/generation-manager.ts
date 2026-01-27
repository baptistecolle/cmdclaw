import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  conversation,
  generation,
  message,
  type ContentPart,
  type PendingApproval,
  type PendingAuth,
} from "@/server/db/schema";
import {
  getOrCreateSession,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
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
      type: "auth_needed";
      generationId: string;
      conversationId: string;
      integrations: string[];
      reason?: string;
    }
  | {
      type: "auth_progress";
      connected: string;
      remaining: string[];
    }
  | { type: "auth_result"; success: boolean; integrations?: string[] }
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
  | "awaiting_auth"
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
  approvalResolver?: (decision: "allow" | "deny") => void;
  pendingAuth: PendingAuth | null;
  authTimeoutId?: ReturnType<typeof setTimeout>;
  authResolver?: (result: { success: boolean; userId?: string }) => void;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  sessionId?: string;
  errorMessage?: string;
  startedAt: Date;
  lastSaveAt: Date;
  saveDebounceId?: ReturnType<typeof setTimeout>;
  isNewConversation: boolean;
  model: string;
  userMessageContent: string;
  // Track assistant message IDs to filter out user message parts
  assistantMessageIds: Set<string>;
}

// Approval timeout: 5 minutes before pausing sandbox
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
// Auth timeout: 10 minutes for OAuth flow
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;
// Save debounce interval for text chunks
const SAVE_DEBOUNCE_MS = 2000;

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
    autoApprove?: boolean;
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model, autoApprove } = params;

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
          autoApprove: autoApprove ?? false,
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
      pendingAuth: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      startedAt: new Date(),
      lastSaveAt: new Date(),
      isNewConversation,
      model: model ?? conv.model ?? "claude-sonnet-4-20250514",
      userMessageContent: content,
      assistantMessageIds: new Set(),
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
                integration: part.integration,
                operation: part.operation,
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

      // If paused or awaiting approval/auth, we need to resume the context
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
      if (genRecord.pendingAuth) {
        yield {
          type: "auth_needed",
          generationId: genRecord.id,
          conversationId: genRecord.conversationId,
          integrations: genRecord.pendingAuth.integrations,
          reason: genRecord.pendingAuth.reason,
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

    // If pending auth, send that event
    if (ctx.pendingAuth) {
      eventQueue.push({
        type: "auth_needed",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        integrations: ctx.pendingAuth.integrations,
        reason: ctx.pendingAuth.reason,
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

    // Resolve the approval promise if waiting (OpenCode plugin flow)
    if (ctx.approvalResolver) {
      ctx.approvalResolver(decision === "approve" ? "allow" : "deny");
      ctx.approvalResolver = undefined;
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

      // Get conversation for existing session info
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
      });

      // Determine if we need to replay history (existing conversation)
      const hasExistingMessages = !!conv?.opencodeSessionId;

      // Get or create sandbox with OpenCode session
      const { client, sessionId, sandbox } = await getOrCreateSession(
        {
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          anthropicApiKey: env.ANTHROPIC_API_KEY,
          integrationEnvs: cliEnv,
        },
        {
          title: conv?.title || "Conversation",
          replayHistory: hasExistingMessages,
        }
      );

      // Store session ID
      ctx.sessionId = sessionId;

      // Write skills to sandbox
      const writtenSkills = await writeSkillsToSandbox(sandbox, ctx.userId);
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);

      // Build system prompt
      const baseSystemPrompt = "You are Bap, an AI agent that helps do work.";
      const systemPromptParts = [baseSystemPrompt, cliInstructions, skillsInstructions].filter(
        Boolean
      );
      const systemPrompt = systemPromptParts.join("\n\n");

      let currentTextPart: { type: "text"; text: string } | null = null;
      let currentTextPartId: string | null = null;

      // Subscribe to SSE events BEFORE sending the prompt
      const eventResult = await client.event.subscribe();
      const eventStream = eventResult.stream;

      // Resolve provider from model ID
      const modelConfig = {
        providerID: resolveProviderID(ctx.model),
        modelID: ctx.model,
      };

      // Send the prompt to OpenCode
      console.log("[GenerationManager] Sending prompt to OpenCode session:", sessionId);
      const promptPromise = client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: ctx.userMessageContent }],
          system: systemPrompt,
          model: modelConfig,
        },
      });

      // Process SSE events
      for await (const event of eventStream) {
        if (ctx.abortController.signal.aborted) {
          break;
        }

        // Log events for debugging
        const eventJson = JSON.stringify(event.properties || {});
        if (event.type === "message.part.updated") {
          const part = (event.properties as any)?.part;
          if (part?.type === "tool") {
            // Log tool state for debugging (state contains input/output)
            console.log("[OpenCode Event] TOOL:", {
              callID: part.callID,
              tool: part.tool,
              state: part.state,
            });
          }
        }
        console.log("[OpenCode Event]", event.type, eventJson.slice(0, 200));

        // Transform OpenCode events to GenerationEvents
        await this.processOpencodeEvent(ctx, event, currentTextPart, currentTextPartId, (part, partId) => {
          currentTextPart = part;
          currentTextPartId = partId;
        });

        // Check for session idle (generation complete)
        if (event.type === "session.idle") {
          console.log("[GenerationManager] Session idle - generation complete");
          break;
        }

        // Check for session error
        if (event.type === "session.error") {
          const error = (event.properties as any)?.error || "Unknown error";
          throw new Error(error);
        }
      }

      // Wait for prompt to complete
      await promptPromise;

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

  /**
   * Process an OpenCode SSE event and transform it to GenerationEvent
   */
  private async processOpencodeEvent(
    ctx: GenerationContext,
    event: { type: string; properties?: unknown },
    currentTextPart: { type: "text"; text: string } | null,
    currentTextPartId: string | null,
    setCurrentTextPart: (part: { type: "text"; text: string } | null, partId: string | null) => void
  ): Promise<void> {
    const props = event.properties as Record<string, unknown>;

    switch (event.type) {
      case "message.updated": {
        // Track assistant message IDs to filter out user message parts
        const info = props.info as Record<string, unknown>;
        if (info?.role === "assistant" && info?.id) {
          ctx.assistantMessageIds.add(info.id as string);
        }
        break;
      }

      case "message.part.updated": {
        const part = props.part as Record<string, unknown>;
        if (!part) return;

        // Only process parts from assistant messages (filter out user message parts)
        const messageID = part.messageID as string;
        if (messageID && !ctx.assistantMessageIds.has(messageID)) {
          // This is a user message part, skip it
          return;
        }

        const partId = part.id as string;

        // Text content
        // NOTE: OpenCode sends the FULL cumulative text with each update, not deltas
        // We need to calculate the delta ourselves
        if (part.type === "text") {
          const fullText = part.text as string;
          if (fullText) {
            // Check if this is a new text part (different part ID)
            const isNewPart = partId !== currentTextPartId;

            // Calculate delta from the previous text
            const previousLength = isNewPart ? 0 : (currentTextPart?.text.length ?? 0);
            const delta = fullText.slice(previousLength);

            // Only process if there's new content
            if (delta) {
              ctx.assistantContent += delta;
              this.broadcast(ctx, { type: "text", content: delta });

              if (currentTextPart && !isNewPart) {
                // Update to the full cumulative text
                currentTextPart.text = fullText;
              } else {
                // New text part - create a new entry
                const newPart = { type: "text" as const, text: fullText };
                ctx.contentParts.push(newPart);
                setCurrentTextPart(newPart, partId);
              }
              this.scheduleSave(ctx);
            }
          }
        }

        // Tool call (OpenCode uses "tool" type with callID, tool, and state properties)
        // See @opencode-ai/sdk ToolPart type: state contains input/output
        // Status flow: pending (no input) -> running (has input) -> completed (has output)
        if (part.type === "tool") {
          setCurrentTextPart(null, null);
          const toolUseId = part.callID as string;
          const toolName = part.tool as string;
          const state = part.state as Record<string, unknown> | undefined;

          // Input is inside state.input
          const toolInput = (state?.input || {}) as Record<string, unknown>;
          const status = state?.status as string;
          // Output is inside state.output when completed
          const result = state?.output;

          const existingToolUse = ctx.contentParts.find(
            (p): p is ContentPart & { type: "tool_use" } =>
              p.type === "tool_use" && p.id === toolUseId
          );

          if (status === "completed" && result !== undefined) {
            // Tool completed - broadcast result
            if (existingToolUse) {
              this.broadcast(ctx, {
                type: "tool_result",
                toolName: existingToolUse.name,
                result,
              });
              ctx.contentParts.push({
                type: "tool_result",
                tool_use_id: toolUseId,
                content: result,
              });
              await this.saveProgress(ctx);
            }
          } else if (status === "running" && !existingToolUse) {
            // Tool is running - now we have the actual input
            // Only capture on "running" status, not "pending" (which has empty input)
            this.broadcast(ctx, {
              type: "tool_use",
              toolName,
              toolInput,
              toolUseId,
            });

            ctx.contentParts.push({
              type: "tool_use",
              id: toolUseId || "",
              name: toolName,
              input: toolInput || {},
            });
            await this.saveProgress(ctx);
          }
        }
        break;
      }

      case "session.updated": {
        // Track session metadata if needed
        const info = props.info as Record<string, unknown>;
        if (info?.id) {
          ctx.sessionId = info.id as string;
        }
        break;
      }

      case "session.status": {
        // Can track status changes if needed
        break;
      }
    }
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

  private async handleAuthTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_auth" || !ctx.pendingAuth) {
      return;
    }

    console.log(`[GenerationManager] Auth timeout for generation ${ctx.id}, cancelling`);

    await this.finishGeneration(ctx, "cancelled");
  }

  /**
   * Submit an auth result (called after OAuth completes)
   */
  async submitAuthResult(
    generationId: string,
    integration: string,
    success: boolean,
    userId: string
  ): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return false;
    }

    if (ctx.userId !== userId) {
      throw new Error("Access denied");
    }

    if (!ctx.pendingAuth) {
      return false;
    }

    // Clear auth timeout
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
      ctx.authTimeoutId = undefined;
    }

    if (!success) {
      // User cancelled - resolve promise with failure (OpenCode plugin flow)
      if (ctx.authResolver) {
        ctx.authResolver({ success: false });
        ctx.authResolver = undefined;
      }
      await this.finishGeneration(ctx, "cancelled");
      return true;
    }

    // Track connected integration
    ctx.pendingAuth.connectedIntegrations.push(integration);

    const allConnected = ctx.pendingAuth.integrations.every(
      (i) => ctx.pendingAuth!.connectedIntegrations.includes(i)
    );

    if (allConnected) {
      // Resolve the auth promise if waiting (OpenCode plugin flow)
      if (ctx.authResolver) {
        ctx.authResolver({ success: true, userId: ctx.userId });
        ctx.authResolver = undefined;
      }

      // Broadcast result before clearing pendingAuth
      this.broadcast(ctx, {
        type: "auth_result",
        success: true,
        integrations: ctx.pendingAuth.connectedIntegrations,
      });

      // Clear pending auth and resume
      ctx.pendingAuth = null;
      ctx.status = "running";

      // Update database
      await db
        .update(generation)
        .set({
          status: "running",
          pendingAuth: null,
        })
        .where(eq(generation.id, ctx.id));

      await db
        .update(conversation)
        .set({ generationStatus: "generating" })
        .where(eq(conversation.id, ctx.conversationId));
    } else {
      // Still waiting for more integrations - broadcast progress
      this.broadcast(ctx, {
        type: "auth_progress",
        connected: integration,
        remaining: ctx.pendingAuth.integrations.filter(
          (i) => !ctx.pendingAuth!.connectedIntegrations.includes(i)
        ),
      });
    }

    return true;
  }

  /**
   * Wait for user approval on a write operation (called by internal router from plugin).
   * This creates a pending approval request and waits for the user to respond.
   */
  async waitForApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
    }
  ): Promise<"allow" | "deny"> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return "deny";
    }

    // Create a promise that resolves when user approves/denies
    return new Promise((resolve) => {
      const toolUseId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      ctx.status = "awaiting_approval";
      ctx.pendingApproval = {
        toolUseId,
        toolName: "Bash",
        toolInput: request.toolInput,
        requestedAt: new Date().toISOString(),
      };
      ctx.approvalResolver = resolve;

      // Update database
      db.update(generation)
        .set({
          status: "awaiting_approval",
          pendingApproval: ctx.pendingApproval,
        })
        .where(eq(generation.id, ctx.id))
        .then(() => {
          // Update conversation status
          return db
            .update(conversation)
            .set({ generationStatus: "awaiting_approval" })
            .where(eq(conversation.id, ctx.conversationId));
        })
        .catch((err) => console.error("[GenerationManager] DB update error:", err));

      // Notify subscribers
      this.broadcast(ctx, {
        type: "pending_approval",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        toolUseId,
        toolName: "Bash",
        toolInput: request.toolInput,
        integration: request.integration,
        operation: request.operation,
        command: request.command,
      });

      // Start approval timeout
      ctx.approvalTimeoutId = setTimeout(() => {
        if (ctx.approvalResolver) {
          ctx.approvalResolver("deny");
          ctx.approvalResolver = undefined;
        }
        this.handleApprovalTimeout(ctx);
      }, APPROVAL_TIMEOUT_MS);
    });
  }

  /**
   * Wait for OAuth authentication (called by internal router from plugin).
   * This creates a pending auth request and waits for the OAuth flow to complete.
   */
  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    }
  ): Promise<{ success: boolean; userId?: string }> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return { success: false };
    }

    // Create a promise that resolves when OAuth completes
    return new Promise((resolve) => {
      ctx.status = "awaiting_auth";
      ctx.pendingAuth = {
        integrations: [request.integration],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
        reason: request.reason,
      };
      ctx.authResolver = resolve;

      // Update database
      db.update(generation)
        .set({
          status: "awaiting_auth",
          pendingAuth: ctx.pendingAuth,
        })
        .where(eq(generation.id, ctx.id))
        .then(() => {
          return db
            .update(conversation)
            .set({ generationStatus: "awaiting_auth" })
            .where(eq(conversation.id, ctx.conversationId));
        })
        .catch((err) => console.error("[GenerationManager] DB update error:", err));

      // Notify subscribers
      this.broadcast(ctx, {
        type: "auth_needed",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        integrations: [request.integration],
        reason: request.reason,
      });

      // Start auth timeout
      ctx.authTimeoutId = setTimeout(() => {
        if (ctx.authResolver) {
          ctx.authResolver({ success: false });
          ctx.authResolver = undefined;
        }
        this.handleAuthTimeout(ctx);
      }, AUTH_TIMEOUT_MS);
    });
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
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
    }

    // NOTE: We set ctx.status AFTER broadcasting to subscribers to avoid a race condition
    // where the subscription loop sees the status change and exits before receiving the
    // terminal event (done/cancelled/error). The status is set after broadcast below.

    let messageId: string | undefined;

    if (status === "completed") {
      // Update session ID
      if (ctx.sessionId) {
        await db
          .update(conversation)
          .set({ opencodeSessionId: ctx.sessionId })
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

    // Notify subscribers BEFORE setting status to avoid race condition
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

    // Set status AFTER broadcast so subscription loop receives the terminal event
    // before seeing the status change
    ctx.status = status;

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

/**
 * Map a model ID to its provider ID.
 */
function resolveProviderID(modelID: string): string {
  if (modelID.startsWith("claude")) return "anthropic";
  if (
    modelID.startsWith("gpt") ||
    modelID.startsWith("o3") ||
    modelID.startsWith("o4") ||
    modelID.startsWith("codex")
  ) {
    return "openai";
  }
  if (modelID.startsWith("gemini")) return "google";
  return "anthropic"; // default
}

// Singleton instance
export const generationManager = new GenerationManager();

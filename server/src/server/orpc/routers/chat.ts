import { eventIterator } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { conversation, message, type ContentPart } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  getCliEnvForUser,
  getCliInstructions,
  getEnabledIntegrationTypes,
} from "@/server/integrations/cli-env";
import { env } from "@/env";
import {
  getOrCreateSandbox,
  runClaudeInSandbox,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
} from "@/server/sandbox/e2b";
import { generateConversationTitle } from "@/server/utils/generate-title";

// Schema for streaming chat events
const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_use"),
    toolName: z.string(),
    toolInput: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("done"),
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
]);

export type ChatEvent = z.infer<typeof chatEventSchema>;

// Streaming chat procedure
const sendMessage = protectedProcedure
  .input(
    z.object({
      conversationId: z.string().optional(),
      content: z.string().min(1).max(100000),
      model: z.string().optional(),
    })
  )
  .output(eventIterator(chatEventSchema))
  .handler(async function* ({ input, context }) {
    const userId = context.user.id;
    const db = context.db;

    // Track if this is a new conversation (for title generation)
    let isNewConversation = false;

    // Get or create conversation
    let conv: typeof conversation.$inferSelect;

    if (input.conversationId) {
      const existing = await db.query.conversation.findFirst({
        where: eq(conversation.id, input.conversationId),
      });
      if (!existing) {
        yield { type: "error" as const, message: "Conversation not found" };
        return;
      }
      if (existing.userId !== userId) {
        yield { type: "error" as const, message: "Access denied" };
        return;
      }
      conv = existing;
    } else {
      // Create new conversation with temporary title
      isNewConversation = true;
      const title =
        input.content.slice(0, 50) + (input.content.length > 50 ? "..." : "");
      const [newConv] = await db
        .insert(conversation)
        .values({
          userId,
          title,
          model: input.model ?? "claude-sonnet-4-20250514",
        })
        .returning();
      conv = newConv;
    }

    // Save user message
    await db.insert(message).values({
      conversationId: conv.id,
      role: "user",
      content: input.content,
    });

    // Get user's enabled integrations and CLI environment
    const [cliEnv, enabledIntegrations] = await Promise.all([
      getCliEnvForUser(userId),
      getEnabledIntegrationTypes(userId),
    ]);

    const cliInstructions = getCliInstructions(enabledIntegrations);

    // Use E2B sandbox for execution
    yield* handleE2BExecution({
      input,
      conv,
      cliEnv,
      cliInstructions,
      db,
      isNewConversation,
      userId,
    });
  });

interface ExecutionContext {
  input: { content: string; model?: string };
  conv: typeof conversation.$inferSelect;
  cliEnv: Record<string, string>;
  cliInstructions: string;
  db: any;
  isNewConversation: boolean;
  userId: string;
}

/**
 * Handle execution using E2B sandbox
 */
async function* handleE2BExecution(
  ctx: ExecutionContext
): AsyncGenerator<ChatEvent, void, unknown> {
  const { input, conv, cliEnv, cliInstructions, db, isNewConversation, userId } = ctx;

  try {
    // Check API key
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Get or create sandbox for this conversation
    const sandbox = await getOrCreateSandbox({
      conversationId: conv.id,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      integrationEnvs: cliEnv,
    });

    // Write user's skills to the sandbox
    const writtenSkills = await writeSkillsToSandbox(sandbox, userId);
    const skillsInstructions = getSkillsSystemPrompt(writtenSkills);

    let assistantContent = "";
    // Interleaved content parts (text/tool_use/tool_result)
    let contentParts: ContentPart[] = [];
    let currentTextPart: { type: "text"; text: string } | null = null;
    let finalUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
    let sessionId: string | undefined;

    // Build system prompt with base identity, CLI instructions and skills
    const baseSystemPrompt = "You are Bap, an AI agent that helps do work.";
    const systemPromptParts = [baseSystemPrompt, cliInstructions, skillsInstructions].filter(Boolean);
    const systemPrompt = systemPromptParts.join("\n\n");

    // Debug: Log what we're sending
    console.log("[E2B] Enabled integrations CLI instructions:", cliInstructions ? "present" : "none");
    console.log("[E2B] Skills written:", writtenSkills.length > 0 ? writtenSkills.join(", ") : "none");

    // Run Claude in sandbox
    const claudeStream = runClaudeInSandbox(sandbox, input.content, {
      model: input.model ?? conv.model ?? "claude-sonnet-4-20250514",
      resume: conv.claudeSessionId ?? undefined,
      systemPrompt,
    });

    for await (const event of claudeStream) {
      // Process different event types from Claude CLI stream-json output
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            assistantContent += block.text;
            yield { type: "text" as const, content: block.text };
            // Build contentParts: append to current text part or create new one
            if (currentTextPart) {
              currentTextPart.text += block.text;
            } else {
              currentTextPart = { type: "text", text: block.text };
              contentParts.push(currentTextPart);
            }
          } else if (block.type === "tool_use" && block.name) {
            // Finalize current text part before tool_use
            currentTextPart = null;
            yield {
              type: "tool_use" as const,
              toolName: block.name,
              toolInput: block.input,
            };
            contentParts.push({
              type: "tool_use",
              id: block.id || "",
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }
      } else if (event.type === "user" && event.message?.content) {
        // Tool results
        for (const block of event.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            // Find the tool_use in contentParts to get the name
            const toolUse = contentParts.find(
              (p): p is ContentPart & { type: "tool_use" } =>
                p.type === "tool_use" && p.id === block.tool_use_id
            );
            if (toolUse) {
              yield {
                type: "tool_result" as const,
                toolName: toolUse.name,
                result: block.content,
              };
              contentParts.push({
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                content: block.content,
              });
            }
          }
        }
      } else if (event.type === "result") {
        if (event.subtype === "success") {
          finalUsage = {
            inputTokens: event.usage?.input_tokens ?? 0,
            outputTokens: event.usage?.output_tokens ?? 0,
            totalCostUsd: event.total_cost_usd ?? 0,
          };
          sessionId = event.session_id;
        } else if (event.subtype === "error") {
          yield { type: "error" as const, message: event.error || "Unknown error" };
          return;
        }
      }
    }

    // Update conversation session ID
    if (sessionId) {
      await db
        .update(conversation)
        .set({ claudeSessionId: sessionId })
        .where(eq(conversation.id, conv.id));
    }

    // Save assistant message with interleaved contentParts
    const [assistantMessage] = await db
      .insert(message)
      .values({
        conversationId: conv.id,
        role: "assistant",
        content:
          assistantContent || "I apologize, but I couldn't generate a response.",
        contentParts: contentParts.length > 0 ? contentParts : null,
        inputTokens: finalUsage.inputTokens,
        outputTokens: finalUsage.outputTokens,
      })
      .returning();

    // Generate title for new conversations (await so sidebar updates)
    if (isNewConversation && assistantContent) {
      try {
        const title = await generateConversationTitle(input.content, assistantContent);
        if (title) {
          await db
            .update(conversation)
            .set({ title })
            .where(eq(conversation.id, conv.id));
          console.log("[Title] Generated title:", title);
        }
      } catch (err) {
        console.error("[Title] Failed to generate title:", err);
      }
    }

    yield {
      type: "done" as const,
      conversationId: conv.id,
      messageId: assistantMessage.id,
      usage: finalUsage,
    };
  } catch (error) {
    console.error("[E2B] Chat error:", error);
    yield {
      type: "error" as const,
      message: error instanceof Error ? error.message : "An unknown error occurred",
    };
  }
}

export const chatRouter = {
  sendMessage,
};

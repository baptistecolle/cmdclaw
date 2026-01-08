import { ORPCError, eventIterator } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { conversation, message } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  getCliEnvForUser,
  getCliInstructions,
  getEnabledIntegrationTypes,
} from "@/server/integrations/cli-env";

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
      // Create new conversation
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
    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const [cliEnv, enabledIntegrations] = await Promise.all([
        getCliEnvForUser(userId),
        getEnabledIntegrationTypes(userId),
      ]);

      const cliInstructions = getCliInstructions(enabledIntegrations);

      let assistantContent = "";
      let toolCalls: {
        id: string;
        name: string;
        input: Record<string, unknown>;
        result?: unknown;
      }[] = [];
      let finalUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

      const systemPrompt = `You are a helpful AI assistant. Be concise and helpful.
${cliInstructions}

When using CLI tools, always run them with \`bun run src/cli/<integration>.ts <command>\`.
The environment is already configured with the necessary authentication tokens.`;

      const agentQuery = query({
        prompt: input.content,
        options: {
          model: input.model ?? conv.model ?? "claude-sonnet-4-20250514",
          resume: conv.claudeSessionId ?? undefined,
          cwd: process.cwd(),
          env: { ...process.env, ...cliEnv },
          systemPrompt,
          tools: { type: "preset", preset: "claude_code" },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        },
      });

      for await (const sdkMessage of agentQuery) {
        if (sdkMessage.type === "assistant" && sdkMessage.message?.content) {
          for (const block of sdkMessage.message.content) {
            if ("text" in block && block.text) {
              assistantContent += block.text;
              yield { type: "text" as const, content: block.text };
            } else if ("name" in block && block.name) {
              yield {
                type: "tool_use" as const,
                toolName: block.name,
                toolInput: block.input,
              };
              toolCalls.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }
        } else if (sdkMessage.type === "user" && sdkMessage.message?.content) {
          // Tool results come back as user messages
          for (const block of sdkMessage.message.content) {
            if ("tool_use_id" in block) {
              const toolCall = toolCalls.find(
                (tc) => tc.id === block.tool_use_id
              );
              if (toolCall) {
                toolCall.result = block.content;
                yield {
                  type: "tool_result" as const,
                  toolName: toolCall.name,
                  result: block.content,
                };
              }
            }
          }
        } else if (
          sdkMessage.type === "result" &&
          sdkMessage.subtype === "success"
        ) {
          finalUsage = {
            inputTokens: sdkMessage.usage?.input_tokens ?? 0,
            outputTokens: sdkMessage.usage?.output_tokens ?? 0,
            totalCostUsd: sdkMessage.total_cost_usd ?? 0,
          };

          // Update conversation session ID
          if (sdkMessage.session_id) {
            await db
              .update(conversation)
              .set({ claudeSessionId: sdkMessage.session_id })
              .where(eq(conversation.id, conv.id));
          }
        }
      }

      // Save assistant message
      const [assistantMessage] = await db
        .insert(message)
        .values({
          conversationId: conv.id,
          role: "assistant",
          content: assistantContent || "I apologize, but I couldn't generate a response.",
          toolCalls: toolCalls.length > 0 ? toolCalls : null,
          inputTokens: finalUsage.inputTokens,
          outputTokens: finalUsage.outputTokens,
        })
        .returning();

      yield {
        type: "done" as const,
        conversationId: conv.id,
        messageId: assistantMessage.id,
        usage: finalUsage,
      };
    } catch (error) {
      console.error("Chat error:", error);
      yield {
        type: "error" as const,
        message:
          error instanceof Error ? error.message : "An unknown error occurred",
      };
    }
  });

export const chatRouter = {
  sendMessage,
};

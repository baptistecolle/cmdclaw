/**
 * OpenAI-compatible backend for ChatGPT subscription models.
 * Uses the user's OAuth token from providerAuth.
 */

import OpenAI from "openai";
import type { LLMBackend, ChatParams, StreamEvent, ChatMessage } from "./llm-backend";

export class OpenAIBackend implements LLMBackend {
  private client: OpenAI;
  private accessToken: string;

  constructor(accessToken: string, baseURL?: string) {
    this.accessToken = accessToken;
    this.client = new OpenAI({
      apiKey: accessToken,
      baseURL: baseURL || undefined,
    });
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent, void, unknown> {
    const model = params.model || "gpt-4o";
    const maxTokens = params.maxTokens || 16384;

    // Convert messages to OpenAI format
    const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map((m) =>
      convertMessage(m),
    );

    if (params.system) {
      messages.unshift({ role: "system", content: params.system });
    }

    // Convert tools to OpenAI format
    const tools: OpenAI.ChatCompletionTool[] | undefined = params.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        tools: tools && tools.length > 0 ? tools : undefined,
        stream: true,
        stream_options: { include_usage: true },
      });

      // Handle abort
      if (params.signal) {
        params.signal.addEventListener("abort", () => {
          stream.controller.abort();
        });
      }

      let currentToolCallId = "";
      let currentToolName = "";

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          // Usage-only chunk at end of stream
          if (chunk.usage) {
            yield {
              type: "usage",
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }
          continue;
        }

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: "text_delta", text: delta.content };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              currentToolCallId = tc.id;
              currentToolName = tc.function?.name || "";
              yield {
                type: "tool_use_start",
                toolUseId: currentToolCallId,
                toolName: currentToolName,
              };
            }
            if (tc.function?.arguments) {
              yield {
                type: "tool_use_delta",
                toolUseId: currentToolCallId,
                jsonDelta: tc.function.arguments,
              };
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          if (currentToolCallId) {
            yield { type: "tool_use_end", toolUseId: currentToolCallId };
            currentToolCallId = "";
          }

          const stopReason =
            choice.finish_reason === "tool_calls"
              ? "tool_use"
              : choice.finish_reason === "stop"
                ? "end_turn"
                : choice.finish_reason === "length"
                  ? "max_tokens"
                  : "end_turn";

          yield { type: "done", stopReason };
        }
      }
    } catch (err: unknown) {
      if (params.signal?.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      yield { type: "error", error: message };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data
        .map((m) => m.id)
        .filter((id) => id.startsWith("gpt") || id.startsWith("o"));
    } catch {
      return ["gpt-4o", "o3", "o4-mini"];
    }
  }

  isAvailable(): boolean {
    return !!this.accessToken;
  }
}

function convertMessage(m: ChatMessage): OpenAI.ChatCompletionMessageParam {
  if (typeof m.content === "string") {
    return { role: m.role, content: m.content };
  }

  if (m.role === "assistant") {
    const content: string[] = [];
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

    for (const block of m.content) {
      if (block.type === "text") {
        content.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      role: "assistant",
      content: content.join("") || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // User message with tool results
  // For OpenAI, tool results must be separate messages
  const parts: OpenAI.ChatCompletionMessageParam[] = [];
  const textParts: string[] = [];

  for (const block of m.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_result") {
      // If we have accumulated text, flush it first
      if (textParts.length > 0) {
        parts.push({ role: "user", content: textParts.join("") });
        textParts.length = 0;
      }
      parts.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
      });
    }
  }

  if (textParts.length > 0) {
    parts.push({ role: "user", content: textParts.join("") });
  }

  // Return first part (OpenAI expects flat message arrays)
  return parts[0] || { role: "user", content: "" };
}

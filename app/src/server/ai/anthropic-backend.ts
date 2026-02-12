/**
 * Direct Anthropic Messages API backend with streaming.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import type {
  LLMBackend,
  ChatParams,
  StreamEvent,
  ChatMessage,
  ContentBlock,
  ToolDefinition,
} from "./llm-backend";

export class AnthropicBackend implements LLMBackend {
  private client: Anthropic;
  private apiKey: string;

  constructor(apiKey?: string, baseURL?: string) {
    this.apiKey = apiKey || env.ANTHROPIC_API_KEY || "";
    this.client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: baseURL || undefined,
    });
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent, void, unknown> {
    const model = params.model || "claude-sonnet-4-20250514";
    const maxTokens = params.maxTokens || 16384;

    // Convert our message format to Anthropic format
    const messages = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : convertContentBlocks(m.content),
    }));

    // Build tools in Anthropic format
    const tools = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens,
      messages,
      system: params.system || undefined,
      tools: tools && tools.length > 0 ? tools : undefined,
    });

    // Handle abort
    if (params.signal) {
      params.signal.addEventListener("abort", () => {
        stream.abort();
      });
    }

    try {
      for await (const event of stream) {
        const events = mapAnthropicEvent(event);
        for (const e of events) {
          yield e;
        }
      }

      // Yield final usage from the accumulated message
      const finalMessage = await stream.finalMessage();
      yield {
        type: "usage",
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      };
      yield {
        type: "done",
        stopReason:
          (finalMessage.stop_reason as StreamEvent extends { type: "done" }
            ? StreamEvent
            : never extends { stopReason: infer R }
              ? R
              : string) || "end_turn",
      } as StreamEvent;
    } catch (err: unknown) {
      if (params.signal?.aborted) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      yield { type: "error", error: message };
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-3-5-20241022",
    ];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}

function convertContentBlocks(
  blocks: ContentBlock[],
): Anthropic.ContentBlockParam[] {
  return blocks.map((block): Anthropic.ContentBlockParam => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        };
      case "thinking":
        return {
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature,
        } as any;
      case "image":
        return {
          type: "image",
          source: block.source,
        } as any;
      default:
        return { type: "text", text: "" };
    }
  });
}

function mapAnthropicEvent(event: Anthropic.MessageStreamEvent): StreamEvent[] {
  const events: StreamEvent[] = [];

  switch (event.type) {
    case "content_block_start": {
      const block = event.content_block;
      if (block.type === "tool_use") {
        events.push({
          type: "tool_use_start",
          toolUseId: block.id,
          toolName: block.name,
        });
      } else if (block.type === "thinking") {
        events.push({
          type: "thinking",
          thinkingId: `thinking-${event.index}`,
          text: "",
        });
      }
      break;
    }

    case "content_block_delta": {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        events.push({ type: "text_delta", text: delta.text });
      } else if (delta.type === "input_json_delta") {
        events.push({
          type: "tool_use_delta",
          toolUseId: "", // filled by consumer via content_block_start
          jsonDelta: delta.partial_json,
        });
      } else if (delta.type === "thinking_delta") {
        events.push({
          type: "thinking",
          thinkingId: `thinking-${event.index}`,
          text: (delta as any).thinking || "",
        });
      }
      break;
    }

    case "content_block_stop": {
      // We could emit tool_use_end here but we need the toolUseId.
      // The GenerationManager tracks this via accumulated state.
      break;
    }

    case "message_delta": {
      if ((event.delta as any).stop_reason) {
        events.push({
          type: "done",
          stopReason: (event.delta as any).stop_reason,
        });
      }
      if (event.usage) {
        events.push({
          type: "usage",
          inputTokens: 0,
          outputTokens: event.usage.output_tokens,
        });
      }
      break;
    }
  }

  return events;
}

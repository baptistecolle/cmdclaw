/**
 * LLM Backend interface for direct model calls.
 *
 * Each backend produces an async stream of events that the GenerationManager
 * can consume and broadcast to subscribers.
 */

export interface LLMStreamEvent {
  type: "text_delta" | "tool_use_start" | "tool_use_delta" | "tool_use_end" | "thinking" | "usage" | "done" | "error";
}

export interface TextDeltaEvent extends LLMStreamEvent {
  type: "text_delta";
  text: string;
}

export interface ToolUseStartEvent extends LLMStreamEvent {
  type: "tool_use_start";
  toolUseId: string;
  toolName: string;
}

export interface ToolUseDeltaEvent extends LLMStreamEvent {
  type: "tool_use_delta";
  toolUseId: string;
  jsonDelta: string;
}

export interface ToolUseEndEvent extends LLMStreamEvent {
  type: "tool_use_end";
  toolUseId: string;
}

export interface ThinkingEvent extends LLMStreamEvent {
  type: "thinking";
  thinkingId: string;
  text: string;
}

export interface UsageEvent extends LLMStreamEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
}

export interface DoneEvent extends LLMStreamEvent {
  type: "done";
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface ErrorEvent extends LLMStreamEvent {
  type: "error";
  error: string;
}

export type StreamEvent =
  | TextDeltaEvent
  | ToolUseStartEvent
  | ToolUseDeltaEvent
  | ToolUseEndEvent
  | ThinkingEvent
  | UsageEvent
  | DoneEvent
  | ErrorEvent;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  system?: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMBackend {
  /** Stream a chat completion. Yields events as they arrive. */
  chat(params: ChatParams): AsyncGenerator<StreamEvent, void, unknown>;

  /** List available models for this backend. */
  listModels(): Promise<string[]>;

  /** Check if this backend is currently available. */
  isAvailable(): boolean;
}

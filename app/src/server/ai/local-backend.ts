/**
 * Local LLM backend: routes chat requests to the daemon via WebSocket
 * for local models (Ollama, LM Studio).
 * The daemon handles the actual API calls and streams results back.
 */

import type { LLMBackend, ChatParams, StreamEvent } from "./llm-backend";
import { sendToDevice, isDeviceOnline } from "@/server/ws/server";
import type { DaemonResponse } from "@/server/sandbox/types";

export class LocalLLMBackend implements LLMBackend {
  private deviceId: string;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent, void, unknown> {
    if (!isDeviceOnline(this.deviceId)) {
      yield { type: "error", error: "Device not connected" };
      return;
    }

    const requestId = crypto.randomUUID();

    // Send the LLM request to daemon
    const sent = sendToDevice(this.deviceId, {
      type: "llm.chat",
      id: requestId,
      messages: params.messages,
      tools: params.tools,
      system: params.system,
      model: params.model,
    });

    if (!sent) {
      yield { type: "error", error: "Failed to send to device" };
      return;
    }

    // Listen for streaming responses from the daemon
    // This requires a streaming response pattern over WS.
    // We use an event-based approach: daemon sends multiple messages
    // with the same request ID.
    const { getDeviceSocket } = await import("@/server/ws/server");
    const ws = getDeviceSocket(this.deviceId);
    if (!ws) {
      yield { type: "error", error: "Device WebSocket not found" };
      return;
    }

    // Create an async queue to bridge WS events to the generator
    const queue: (StreamEvent | null)[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    // Temporarily override the message handler for this request
    // This is handled by the WS server routing responses to pending requests,
    // but for streaming we need a different approach.
    // We'll use a simple polling approach that checks for llm.chunk messages.

    // For the prototype, we'll collect responses via the global pending requests mechanism
    // with a streaming adapter. The daemon sends llm.chunk events that get routed here.

    // Simplified: collect chunks until llm.done
    // Register a streaming listener
    const streamListener = (msg: DaemonResponse) => {
      if (!("id" in msg) || msg.id !== requestId) {return;}

      if (msg.type === "llm.chunk") {
        const chunk = msg.chunk as StreamEvent;
        queue.push(chunk);
        resolveWait?.();
        resolveWait = null;
      } else if (msg.type === "llm.done") {
        if (msg.usage) {
          queue.push({
            type: "usage",
            inputTokens: msg.usage.inputTokens,
            outputTokens: msg.usage.outputTokens,
          });
        }
        queue.push({ type: "done", stopReason: "end_turn" });
        queue.push(null); // sentinel
        done = true;
        resolveWait?.();
        resolveWait = null;
      } else if (msg.type === "llm.error") {
        queue.push({ type: "error", error: msg.error });
        queue.push(null);
        done = true;
        resolveWait?.();
        resolveWait = null;
      }
    };

    // Register the listener via the streaming registry
    registerStreamListener(requestId, streamListener);

    try {
      while (!done || queue.length > 0) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          if (event === null) {return;}
          yield event;
        }

        if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            setTimeout(resolve, 100);
          });
        }
      }
    } finally {
      unregisterStreamListener(requestId);
    }
  }

  async listModels(): Promise<string[]> {
    // Would query daemon for available models
    return [];
  }

  isAvailable(): boolean {
    return isDeviceOnline(this.deviceId);
  }
}

// ========== Streaming Registry ==========
// Allows the WS server to route streaming responses to the right consumer.

const streamListeners = new Map<string, (msg: DaemonResponse) => void>();

export function registerStreamListener(
  requestId: string,
  listener: (msg: DaemonResponse) => void,
): void {
  streamListeners.set(requestId, listener);
}

export function unregisterStreamListener(requestId: string): void {
  streamListeners.delete(requestId);
}

/**
 * Route a streaming message to its listener (called from WS server).
 */
export function routeStreamMessage(msg: DaemonResponse): boolean {
  if (!("id" in msg) || !msg.id) {return false;}
  const listener = streamListeners.get(msg.id);
  if (listener) {
    listener(msg);
    return true;
  }
  return false;
}

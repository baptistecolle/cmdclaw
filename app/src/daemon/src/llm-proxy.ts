/**
 * Local LLM proxy for the Bap daemon.
 * Detects and proxies requests to Ollama and LM Studio.
 */

import { logger } from "./logger";

interface LocalProvider {
  name: string;
  baseUrl: string;
  models: string[];
}

type LlmTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
};

type OpenAIStreamDelta = {
  content?: string;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: OpenAIStreamDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

const PROVIDERS: { name: string; detectUrl: string; baseUrl: string }[] = [
  {
    name: "ollama",
    detectUrl: "http://localhost:11434/api/tags",
    baseUrl: "http://localhost:11434/v1",
  },
  {
    name: "lm-studio",
    detectUrl: "http://localhost:1234/v1/models",
    baseUrl: "http://localhost:1234/v1",
  },
];

/**
 * Detect available local LLM providers.
 */
export async function detectLocalProviders(): Promise<LocalProvider[]> {
  const checks = PROVIDERS.map(async (provider) => {
    try {
      const res = await fetch(provider.detectUrl, {
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      const dataObj = asRecord(data);
      let models: string[] = [];

      if (provider.name === "ollama" && Array.isArray(dataObj?.models)) {
        models = dataObj.models
          .map((m) => asRecord(m)?.name)
          .filter((m): m is string => typeof m === "string");
      } else if (provider.name === "lm-studio" && Array.isArray(dataObj?.data)) {
        models = dataObj.data
          .map((m) => asRecord(m)?.id)
          .filter((m): m is string => typeof m === "string");
      }

      logger.info("llm-proxy", `Found ${provider.name} with ${models.length} models`);
      return {
        name: provider.name,
        baseUrl: provider.baseUrl,
        models,
      } satisfies LocalProvider;
    } catch {
      // Provider not running
      return null;
    }
  });

  const found = await Promise.all(checks);
  return found.filter((provider): provider is LocalProvider => provider !== null);
}

/**
 * Proxy a chat request to a local LLM provider.
 * Streams responses back via the callback.
 */
export async function proxyChatRequest(
  request: {
    messages: unknown[];
    tools?: LlmTool[];
    system?: string;
    model?: string;
  },
  onChunk: (chunk: unknown) => void,
  onDone: (usage?: { inputTokens: number; outputTokens: number }) => void,
  onError: (error: string) => void,
): Promise<void> {
  // Find a provider with the requested model
  const providers = await detectLocalProviders();

  if (providers.length === 0) {
    onError("No local LLM providers available");
    return;
  }

  // Find the right provider for the model
  let targetProvider = providers[0]; // default to first
  const model = request.model || "";

  for (const p of providers) {
    if (p.models.some((m) => m === model || model.includes(m))) {
      targetProvider = p;
      break;
    }
  }

  try {
    // Build messages array with system message
    const messages: unknown[] = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    messages.push(...(request.messages as unknown[]));

    const body: {
      model: string;
      messages: unknown[];
      stream: true;
      tools?: Array<{
        type: "function";
        function: {
          name: string;
          description?: string;
          parameters?: Record<string, unknown>;
        };
      }>;
    } = {
      model: model || targetProvider.models[0] || "default",
      messages,
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const res = await fetch(`${targetProvider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      onError(`LLM API error: ${res.status} ${text}`);
      return;
    }

    // Parse SSE stream
    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    const readChunk = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(data) as OpenAIStreamChunk;
          const choice = parsed.choices?.[0];
          if (!choice) {
            continue;
          }

          const delta = choice.delta;

          if (delta?.content) {
            onChunk({ type: "text_delta", text: delta.content });
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                onChunk({
                  type: "tool_use_start",
                  toolUseId: tc.id,
                  toolName: tc.function?.name || "",
                });
              }
              if (tc.function?.arguments) {
                onChunk({
                  type: "tool_use_delta",
                  toolUseId: tc.id || "",
                  jsonDelta: tc.function.arguments,
                });
              }
            }
          }

          if (choice.finish_reason) {
            if (choice.finish_reason === "tool_calls") {
              onChunk({ type: "done", stopReason: "tool_use" });
            } else {
              onChunk({ type: "done", stopReason: "end_turn" });
            }
          }

          // Usage info
          if (parsed.usage) {
            onDone({
              inputTokens: parsed.usage.prompt_tokens || 0,
              outputTokens: parsed.usage.completion_tokens || 0,
            });
            return;
          }
        } catch {
          // skip unparseable lines
        }
      }
      return readChunk();
    };

    await readChunk();

    onDone();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error("llm-proxy", `Chat proxy error: ${msg}`);
    onError(msg);
  }
}

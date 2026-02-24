/**
 * OpenCode Plugin: Memory Tools
 *
 * Registers memory_search, memory_get, and memory_write tools that proxy
 * to the CmdClaw server so memory lives in Postgres while files are synced
 * into the sandbox.
 */

type MemoryToolInput = Record<string, unknown>;

const MEMORY_TOOLS = [
  {
    name: "memory_search",
    description:
      "Search persistent memory (long-term, daily logs, and session transcripts) using semantic + keyword search.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default: 8)" },
        type: { type: "string", enum: ["longterm", "daily"] },
        date: { type: "string", description: "YYYY-MM-DD (daily only)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get",
    description:
      "Read a specific memory file by path (MEMORY.md, memory/YYYY-MM-DD.md, or sessions/YYYY-MM-DD-HHMMSS-<slug>.md).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "memory_write",
    description:
      "Write durable information to memory. Use type=longterm for persistent facts, " +
      "type=daily (or date) for daily logs.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string", enum: ["longterm", "daily"] },
        date: { type: "string", description: "YYYY-MM-DD (daily only)" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        path: { type: "string" },
      },
      required: ["content"],
    },
  },
];

async function callMemoryApi(operation: string, payload: MemoryToolInput) {
  const serverUrl = process.env.APP_URL;
  const serverSecret = process.env.CMDCLAW_SERVER_SECRET;
  const conversationId = process.env.CONVERSATION_ID;

  if (!serverUrl || !conversationId) {
    throw new Error("Missing APP_URL or CONVERSATION_ID");
  }

  const response = await fetch(`${serverUrl}/api/internal/memory`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId,
      operation,
      payload,
      authHeader: serverSecret ? `Bearer ${serverSecret}` : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Memory API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const MemoryPlugin = async () => {
  return {
    tools: MEMORY_TOOLS.map((tool) => {
      const execute = async (args: MemoryToolInput) => {
        const operation = tool.name.replace("memory_", "");
        const result = await callMemoryApi(operation, args);
        if (!result?.success) {
          throw new Error(result?.error || "Memory tool failed");
        }
        return result;
      };
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
        execute,
      };
    }),
  };
};

export default MemoryPlugin;

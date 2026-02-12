/**
 * Tool definitions for direct LLM calls (BYOC mode).
 * These match the tools that OpenCode provides to the model.
 */

import type { ToolDefinition } from "./llm-backend";

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute a bash command in the sandbox. Use this for running scripts, installing packages, " +
    "file operations, git commands, and any other shell operations. The working directory persists " +
    "between calls. Commands run with a 2-minute timeout by default.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Optional timeout in milliseconds (default: 120000)",
      },
    },
    required: ["command"],
  },
};

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file, creating it if it doesn't exist or overwriting if it does. " +
    "Use this for creating new files or completely replacing file contents.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Returns the full file content as a string.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute path to the file to read",
      },
    },
    required: ["path"],
  },
};

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description: "List files and directories at a given path. Returns a listing similar to 'ls -la'.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory path to list (default: current directory)",
      },
    },
    required: [],
  },
};

export const searchFilesTool: ToolDefinition = {
  name: "search_files",
  description:
    "Search for files matching a pattern using glob syntax. Returns matching file paths.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match (e.g. '**/*.ts', 'src/**/*.tsx')",
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current directory)",
      },
    },
    required: ["pattern"],
  },
};

export const searchContentTool: ToolDefinition = {
  name: "search_content",
  description:
    "Search file contents for a text pattern using grep/ripgrep. " +
    "Returns matching lines with file paths and line numbers.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The search pattern (supports regex)",
      },
      path: {
        type: "string",
        description: "File or directory to search in (default: current directory)",
      },
      include: {
        type: "string",
        description: "File glob pattern to include (e.g. '*.ts')",
      },
    },
    required: ["pattern"],
  },
};

export const memorySearchTool: ToolDefinition = {
  name: "memory_search",
  description:
    "Search persistent memory (long-term, daily logs, and session transcripts) using semantic + keyword search.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number", description: "Max results (default: 8)" },
      type: {
        type: "string",
        enum: ["longterm", "daily"],
        description: "Optional memory type filter",
      },
      date: {
        type: "string",
        description: "Optional date filter for daily logs (YYYY-MM-DD)",
      },
    },
    required: ["query"],
  },
};

export const memoryGetTool: ToolDefinition = {
  name: "memory_get",
  description:
    "Read a specific memory file by path (MEMORY.md, memory/YYYY-MM-DD.md, or sessions/YYYY-MM-DD-HHMMSS-<slug>.md).",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Memory file path" },
    },
    required: ["path"],
  },
};

export const memoryWriteTool: ToolDefinition = {
  name: "memory_write",
  description:
    "Write durable information to memory. Use type=longterm for persistent facts, " +
    "type=daily (or date) for daily logs.",
  input_schema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Memory content to store" },
      type: {
        type: "string",
        enum: ["longterm", "daily"],
        description: "Memory file type",
      },
      date: {
        type: "string",
        description: "Date for daily memory (YYYY-MM-DD, default: today)",
      },
      title: { type: "string", description: "Optional title for the entry" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags",
      },
      path: {
        type: "string",
        description: "Optional path override (MEMORY.md or memory/YYYY-MM-DD.md)",
      },
    },
    required: ["content"],
  },
};

export const sendFileTool: ToolDefinition = {
  name: "send_file",
  description:
    "Send a file from the sandbox to the user. Use this when you've created a file " +
    "the user needs to download (PDFs, images, documents, code files, etc). " +
    "The file will appear as a downloadable attachment in the chat.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the file in the sandbox (e.g., /app/output.pdf)",
      },
      description: {
        type: "string",
        description: "Brief description of the file for the user",
      },
    },
    required: ["path"],
  },
};

/**
 * Get all tool definitions for direct mode.
 */
export function getDirectModeTools(): ToolDefinition[] {
  return [
    bashTool,
    writeFileTool,
    readFileTool,
    listFilesTool,
    searchFilesTool,
    searchContentTool,
    memorySearchTool,
    memoryGetTool,
    memoryWriteTool,
    sendFileTool,
  ];
}

/**
 * Map a tool call to a bash command for sandbox execution.
 * Some tools (write_file, read_file, etc.) are implemented as
 * bash commands under the hood.
 */
export function toolCallToCommand(
  toolName: string,
  input: Record<string, unknown>,
): { command: string; isWrite: boolean } | null {
  switch (toolName) {
    case "bash":
      return {
        command: input.command as string,
        isWrite: false, // permission checker will determine
      };

    case "write_file":
      // Use heredoc for safe file writing
      return {
        command: `mkdir -p "$(dirname "${input.path}")" && cat > "${input.path}" << 'BAPEOF'\n${input.content}\nBAPEOF`,
        isWrite: true,
      };

    case "read_file":
      return {
        command: `cat "${input.path}"`,
        isWrite: false,
      };

    case "list_files":
      return {
        command: `ls -la "${input.path || "."}"`,
        isWrite: false,
      };

    case "search_files":
      return {
        command: input.path
          ? `find "${input.path}" -name "${input.pattern}" 2>/dev/null | head -100`
          : `find . -name "${input.pattern}" 2>/dev/null | head -100`,
        isWrite: false,
      };

    case "search_content": {
      const include = input.include ? `--include="${input.include}"` : "";
      return {
        command: `grep -rn ${include} "${input.pattern}" "${input.path || "."}" 2>/dev/null | head -100`,
        isWrite: false,
      };
    }

    default:
      return null;
  }
}

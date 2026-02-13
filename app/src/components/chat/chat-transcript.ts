import type { Message, MessagePart } from "./message-list";

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatPart(part: MessagePart): string {
  if (part.type === "text") {
    return part.content;
  }

  if (part.type === "thinking") {
    return `[thinking]\n${part.content}`;
  }

  if (part.type === "system") {
    return `[system]\n${part.content}`;
  }

  if (part.type === "approval") {
    return [
      `[approval:${part.status}] ${part.toolName}`,
      `integration: ${part.integration}`,
      `operation: ${part.operation}`,
      `input: ${formatValue(part.toolInput)}`,
      part.command ? `command: ${part.command}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `[tool_call] ${part.name}`,
    part.integration ? `integration: ${part.integration}` : null,
    part.operation ? `operation: ${part.operation}` : null,
    `input: ${formatValue(part.input)}`,
    part.result !== undefined ? `result: ${formatValue(part.result)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMessageBody(message: Message): string {
  if (message.parts && message.parts.length > 0) {
    const partContent = message.parts.map(formatPart).join("\n\n");
    return partContent.trim() || message.content.trim();
  }

  return message.content.trim();
}

function formatRole(role: Message["role"]): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function formatChatTranscript(
  messages: Message[],
  streamingParts: MessagePart[] = [],
): string {
  const lines: string[] = [];

  messages.forEach((message, index) => {
    lines.push(`## ${index + 1}. ${formatRole(message.role)}`);

    const body = formatMessageBody(message);
    if (body) {
      lines.push(body);
    }

    if (message.attachments && message.attachments.length > 0) {
      lines.push("attachments:");
      for (const attachment of message.attachments) {
        lines.push(`- ${attachment.name} (${attachment.mimeType})`);
      }
    }

    if (message.sandboxFiles && message.sandboxFiles.length > 0) {
      lines.push("sandbox files:");
      for (const file of message.sandboxFiles) {
        lines.push(`- ${file.path}`);
      }
    }

    lines.push("");
  });

  if (streamingParts.length > 0) {
    lines.push("## Assistant (streaming)");
    lines.push(streamingParts.map(formatPart).join("\n\n"));
    lines.push("");
  }

  return lines.join("\n").trim();
}

type PersistedContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

type PersistedMessage = {
  id: string;
  role: string;
  content: string;
  contentParts?: PersistedContentPart[];
  attachments?: Array<{ filename: string; mimeType: string }>;
  sandboxFiles?: Array<{ path: string; filename: string; mimeType: string; fileId: string }>;
};

export function formatPersistedChatTranscript(messages: PersistedMessage[]): string {
  const normalizedMessages: Message[] = messages.map((message) => {
    let parts: MessagePart[] | undefined;
    if (message.contentParts && message.contentParts.length > 0) {
      const toolResults = new Map<string, unknown>();
      for (const part of message.contentParts) {
        if (part.type === "tool_result") {
          toolResults.set(part.tool_use_id, part.content);
        }
      }

      parts = message.contentParts
        .filter((part) => part.type !== "tool_result")
        .map((part) => {
          if (part.type === "text") {
            return { type: "text", content: part.text };
          }
          if (part.type === "thinking") {
            return { type: "thinking", id: part.id, content: part.content };
          }
          if (part.type === "system") {
            return { type: "system", content: part.content };
          }

          return {
            type: "tool_call",
            id: part.id,
            name: part.name,
            input: part.input,
            result: toolResults.get(part.id),
            integration: part.integration,
            operation: part.operation,
          };
        });
    }

    return {
      id: message.id,
      role: (message.role as Message["role"]) ?? "assistant",
      content: message.content,
      parts,
      attachments: message.attachments?.map((attachment) => ({
        name: attachment.filename,
        mimeType: attachment.mimeType,
        dataUrl: "",
      })),
      sandboxFiles: message.sandboxFiles?.map((file) => ({
        path: file.path,
        filename: file.filename,
        mimeType: file.mimeType,
        fileId: file.fileId,
        sizeBytes: null,
      })),
    };
  });

  return formatChatTranscript(normalizedMessages);
}

import type { Message, MessagePart } from "./message-list";
import { getTimingMetrics } from "./chat-performance-metrics";
import {
  mapPersistedMessagesToChatMessages,
  type PersistedConversationMessage,
} from "./persisted-message-mapper";

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
      part.questionAnswers ? `answers: ${formatValue(part.questionAnswers)}` : null,
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
  options?: {
    includeTimingMetrics?: boolean;
  },
): string {
  const lines: string[] = [];
  const includeTimingMetrics = options?.includeTimingMetrics ?? false;

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

    if (includeTimingMetrics && message.timing) {
      const metrics = getTimingMetrics(message.timing);
      if (metrics.length > 0) {
        lines.push("performance metrics:");
        for (const metric of metrics) {
          lines.push(`- ${metric.label}: ${metric.value}`);
        }
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

type PersistedMessage = PersistedConversationMessage;

export function formatPersistedChatTranscript(
  messages: PersistedMessage[],
  options?: {
    includeTimingMetrics?: boolean;
  },
): string {
  const normalizedMessages: Message[] = mapPersistedMessagesToChatMessages(messages);

  return formatChatTranscript(normalizedMessages, [], options);
}

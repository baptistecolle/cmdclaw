import type { MessageTiming } from "./chat-performance-metrics";
import type { Message, MessagePart, SandboxFileData } from "./message-list";

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

export type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentParts?: PersistedContentPart[] | null;
  timing?: MessageTiming | null;
  attachments?: Array<{
    id?: string;
    filename: string;
    mimeType: string;
    dataUrl?: string;
  }>;
  sandboxFiles?: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number | null;
    downloadUrl?: string | null;
  }>;
};

export function mapPersistedMessagesToChatMessages(
  messages: PersistedConversationMessage[],
): Message[] {
  return messages.map((message) => {
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
            return { type: "text", content: part.text } as MessagePart;
          }
          if (part.type === "thinking") {
            return { type: "thinking", id: part.id, content: part.content } as MessagePart;
          }
          if (part.type === "system") {
            return { type: "system", content: part.content } as MessagePart;
          }

          return {
            type: "tool_call",
            id: part.id,
            name: part.name,
            input: part.input,
            result: toolResults.get(part.id),
            integration: part.integration,
            operation: part.operation,
          } as MessagePart;
        });
    }

    return {
      id: message.id,
      role: (message.role as Message["role"]) ?? "assistant",
      content: message.content,
      parts,
      timing: message.timing ?? undefined,
      attachments: message.attachments?.map((attachment) => ({
        id: attachment.id,
        name: attachment.filename,
        mimeType: attachment.mimeType,
        dataUrl: attachment.dataUrl ?? "",
      })),
      sandboxFiles: message.sandboxFiles?.map(
        (file) =>
          ({
            path: file.path,
            filename: file.filename,
            mimeType: file.mimeType,
            fileId: file.fileId,
            sizeBytes: file.sizeBytes ?? null,
            downloadUrl: file.downloadUrl,
          }) satisfies SandboxFileData,
      ),
    } satisfies Message;
  });
}

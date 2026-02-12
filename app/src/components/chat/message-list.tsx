"use client";

import { MessageItem } from "./message-item";

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
      result?: unknown;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string }
  | {
      type: "approval";
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
    };

export type AttachmentData = {
  name: string;
  mimeType: string;
  dataUrl: string;
  /** Set for persisted attachments loaded from DB */
  id?: string;
};

export type SandboxFileData = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts?: MessagePart[];
  integrationsUsed?: string[];
  attachments?: AttachmentData[];
  sandboxFiles?: SandboxFileData[];
};

type Props = {
  messages: Message[];
};

export function MessageList({ messages }: Props) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div data-testid="chat-message-list" className="space-y-2">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          id={message.id}
          role={message.role}
          content={message.content}
          parts={message.parts}
          integrationsUsed={message.integrationsUsed}
          attachments={message.attachments}
          sandboxFiles={message.sandboxFiles}
        />
      ))}
    </div>
  );
}

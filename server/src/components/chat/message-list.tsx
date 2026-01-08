"use client";

import { MessageItem } from "./message-item";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }[];
};

type Props = {
  messages: Message[];
};

export function MessageList({ messages }: Props) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          role={message.role}
          content={message.content}
          toolCalls={message.toolCalls}
        />
      ))}
    </div>
  );
}

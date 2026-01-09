"use client";

import { User, Bot } from "lucide-react";
import { ToolCallDisplay } from "./tool-call-display";
import { TextPartDisplay } from "./text-part-display";
import { cn } from "@/lib/utils";
import type { MessagePart } from "./message-list";

type Props = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts?: MessagePart[];
  toolCalls?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }[];
};

export function MessageItem({ role, content, parts, toolCalls }: Props) {
  // For user messages, show simple bubble
  if (role === "user") {
    return (
      <div className="flex gap-3 py-4 flex-row-reverse">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </div>
        <div className="flex max-w-[80%] flex-col gap-2 items-end">
          <div className="rounded-lg px-4 py-2 bg-primary text-primary-foreground">
            <p className="whitespace-pre-wrap text-sm">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  // For assistant messages, render parts linearly if available
  const hasParts = parts && parts.length > 0;

  return (
    <div className="flex gap-3 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-4 w-4" />
      </div>

      <div className="flex max-w-[80%] flex-col gap-2">
        {hasParts ? (
          // Render parts linearly
          parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <TextPartDisplay
                  key={`text-${index}`}
                  content={part.content}
                />
              );
            } else {
              return (
                <ToolCallDisplay
                  key={part.id}
                  name={part.name}
                  input={part.input}
                  result={part.result}
                />
              );
            }
          })
        ) : (
          // Fallback: legacy format (content at top, tool calls below)
          <>
            <div className="rounded-lg px-4 py-2 bg-muted">
              <p className="whitespace-pre-wrap text-sm">{content}</p>
            </div>
            {toolCalls && toolCalls.length > 0 && (
              <div className="w-full space-y-2">
                {toolCalls.map((tc) => (
                  <ToolCallDisplay key={tc.id} {...tc} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

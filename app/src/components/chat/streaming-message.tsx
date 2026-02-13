"use client";

import { Bot } from "lucide-react";
import type { MessagePart } from "./message-list";
import { TextPartDisplay } from "./text-part-display";
import { ThinkingPartDisplay } from "./thinking-part-display";
import { ToolCallDisplay } from "./tool-call-display";

type Props = {
  parts: MessagePart[];
};

export function StreamingMessage({ parts }: Props) {
  const partKeyCounts = new Map<string, number>();

  return (
    <div className="flex gap-3 py-4">
      <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Bot className="h-4 w-4" />
      </div>

      <div className="flex max-w-[80%] flex-col gap-2">
        {parts.length === 0 && (
          <div className="bg-muted flex items-center gap-2 rounded-lg px-4 py-2">
            <div className="flex gap-1">
              <span className="bg-foreground/50 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
              <span className="bg-foreground/50 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
              <span className="bg-foreground/50 h-2 w-2 animate-bounce rounded-full" />
            </div>
          </div>
        )}

        {parts.map((part, index) => {
          let baseKey: string;
          switch (part.type) {
            case "text":
              baseKey = `text:${part.content}`;
              break;
            case "thinking":
              baseKey = `thinking:${part.id}`;
              break;
            case "tool_call":
              baseKey = `tool:${part.id}`;
              break;
            case "system":
              baseKey = `system:${part.content}`;
              break;
            case "approval":
              baseKey = `approval:${part.toolUseId}`;
              break;
          }
          const occurrence = (partKeyCounts.get(baseKey) ?? 0) + 1;
          partKeyCounts.set(baseKey, occurrence);
          const partKey = `${baseKey}:${occurrence}`;

          if (part.type === "text") {
            const isLast = index === parts.length - 1;
            return <TextPartDisplay key={partKey} content={part.content} isStreaming={isLast} />;
          } else if (part.type === "thinking") {
            const isLast = index === parts.length - 1;
            return (
              <ThinkingPartDisplay key={partKey} content={part.content} isStreaming={isLast} />
            );
          } else if (part.type === "tool_call") {
            return (
              <ToolCallDisplay
                key={partKey}
                name={part.name}
                input={part.input}
                result={part.result}
              />
            );
          } else {
            // Skip approval parts - they're shown separately in the approval card
            return null;
          }
        })}
      </div>
    </div>
  );
}

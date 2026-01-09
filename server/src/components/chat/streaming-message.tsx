"use client";

import { Bot } from "lucide-react";
import { ToolCallDisplay } from "./tool-call-display";
import { TextPartDisplay } from "./text-part-display";
import type { MessagePart } from "./message-list";

type Props = {
  parts: MessagePart[];
};

export function StreamingMessage({ parts }: Props) {
  return (
    <div className="flex gap-3 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-4 w-4" />
      </div>

      <div className="flex max-w-[80%] flex-col gap-2">
        {parts.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50" />
            </div>
          </div>
        )}

        {parts.map((part, index) => {
          if (part.type === "text") {
            const isLast = index === parts.length - 1;
            return (
              <TextPartDisplay
                key={`text-${index}`}
                content={part.content}
                isStreaming={isLast}
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
        })}
      </div>
    </div>
  );
}

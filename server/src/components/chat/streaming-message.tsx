"use client";

import { Bot } from "lucide-react";
import { ToolCallDisplay } from "./tool-call-display";

type Props = {
  content: string;
  toolCalls: { name: string; input: unknown; result?: unknown }[];
};

export function StreamingMessage({ content, toolCalls }: Props) {
  return (
    <div className="flex gap-3 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-4 w-4" />
      </div>

      <div className="flex max-w-[80%] flex-col gap-2">
        {content && (
          <div className="rounded-lg bg-muted px-4 py-2">
            <p className="whitespace-pre-wrap text-sm">{content}</p>
            <span className="inline-block h-4 w-1 animate-pulse bg-foreground/50" />
          </div>
        )}

        {toolCalls.length > 0 && (
          <div className="w-full space-y-2">
            {toolCalls.map((tc, i) => (
              <ToolCallDisplay
                key={`streaming-${tc.name}-${i}`}
                name={tc.name}
                input={tc.input}
                result={tc.result}
              />
            ))}
          </div>
        )}

        {!content && toolCalls.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-foreground/50" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

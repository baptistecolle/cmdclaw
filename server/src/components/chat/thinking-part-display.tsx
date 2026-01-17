"use client";

import { useState } from "react";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
};

export function ThinkingPartDisplay({ content, isStreaming, defaultExpanded = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Preview: first 80 chars or first line
  const firstLine = content.split('\n')[0];
  const preview = firstLine.slice(0, 80) + (firstLine.length > 80 ? '...' : '');

  return (
    <div className="rounded-lg border border-muted-foreground/20 bg-muted/50">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
        <Brain className="h-4 w-4 shrink-0" />

        {isStreaming && !isExpanded ? (
          <div className="flex items-center gap-2">
            <span className="italic">Thinking</span>
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
            </div>
          </div>
        ) : (
          <span className={cn("truncate", isExpanded ? "italic" : "")}>
            {isExpanded ? "Thinking" : preview}
          </span>
        )}
      </button>

      {/* Content - collapsible */}
      {isExpanded && (
        <div className="border-t border-muted-foreground/20 px-3 py-2">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground italic">
            {content}
          </p>
          {isStreaming && (
            <span className="inline-block h-4 w-1 animate-pulse bg-muted-foreground/50" />
          )}
        </div>
      )}
    </div>
  );
}

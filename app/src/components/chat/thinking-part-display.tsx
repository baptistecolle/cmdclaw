"use client";

import { ChevronRight, Brain } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
};

export function ThinkingPartDisplay({ content, isStreaming, defaultExpanded = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Preview: first 80 chars or first line
  const firstLine = content.split("\n")[0];
  const preview = firstLine.slice(0, 80) + (firstLine.length > 80 ? "..." : "");

  return (
    <div className="border-muted-foreground/20 bg-muted/50 rounded-lg border">
      {/* Header - always visible */}
      <button
        onClick={handleToggleExpanded}
        className="text-muted-foreground hover:bg-muted/80 flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            isExpanded && "rotate-90",
          )}
        />
        <Brain className="h-4 w-4 shrink-0" />

        {isStreaming && !isExpanded ? (
          <div className="flex items-center gap-2">
            <span className="italic">Thinking</span>
            <div className="flex gap-1">
              <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
              <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
              <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full" />
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
        <div className="border-muted-foreground/20 border-t px-3 py-2">
          <p className="text-muted-foreground text-sm whitespace-pre-wrap italic">{content}</p>
          {isStreaming && (
            <span className="bg-muted-foreground/50 inline-block h-4 w-1 animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}

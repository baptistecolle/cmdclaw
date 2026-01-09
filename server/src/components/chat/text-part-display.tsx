"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

type Props = {
  content: string;
  isStreaming?: boolean;
};

export function TextPartDisplay({ content, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Get a preview of the content (first line or first 50 chars)
  const preview = content.split("\n")[0].slice(0, 60) + (content.length > 60 ? "..." : "");

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {preview}
        </span>
        {isStreaming && (
          <span className="inline-block h-3 w-1 animate-pulse bg-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2">
          <p className="whitespace-pre-wrap text-sm">{content}</p>
          {isStreaming && (
            <span className="inline-block h-4 w-1 animate-pulse bg-foreground/50" />
          )}
        </div>
      )}
    </div>
  );
}

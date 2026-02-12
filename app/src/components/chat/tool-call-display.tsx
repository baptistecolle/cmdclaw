"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Check,
  Loader2,
} from "lucide-react";

type Props = {
  name: string;
  input: unknown;
  result?: unknown;
};

export function ToolCallDisplay({ name, input, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = result !== undefined;

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
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 font-mono text-xs">{name}</span>
        {isComplete ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2">
          <div className="mb-2">
            <p className="text-xs font-medium text-muted-foreground">Input:</p>
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Result:
              </p>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

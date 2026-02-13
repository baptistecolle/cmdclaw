"use client";

import { ChevronDown, ChevronRight, Wrench, Check, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

type Props = {
  name: string;
  input: unknown;
  result?: unknown;
};

export function ToolCallDisplay({ name, input, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = result !== undefined;
  const handleToggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="bg-card text-card-foreground rounded-lg border">
      <button
        onClick={handleToggleExpanded}
        className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Wrench className="text-muted-foreground h-4 w-4" />
        <span className="flex-1 font-mono text-xs">{name}</span>
        {isComplete ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2">
          <div className="mb-2">
            <p className="text-muted-foreground text-xs font-medium">Input:</p>
            <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 text-xs">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="text-muted-foreground text-xs font-medium">Result:</p>
              <pre className="bg-muted mt-1 max-h-48 overflow-auto rounded p-2 text-xs">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

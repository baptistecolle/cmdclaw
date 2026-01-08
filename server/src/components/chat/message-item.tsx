"use client";

import { User, Bot } from "lucide-react";
import { ToolCallDisplay } from "./tool-call-display";
import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }[];
};

export function MessageItem({ role, content, toolCalls }: Props) {
  return (
    <div
      className={cn(
        "flex gap-3 py-4",
        role === "user" && "flex-row-reverse"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        {role === "user" ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      <div
        className={cn("flex max-w-[80%] flex-col gap-2", role === "user" && "items-end")}
      >
        <div
          className={cn(
            "rounded-lg px-4 py-2",
            role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}
        >
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>

        {toolCalls && toolCalls.length > 0 && (
          <div className="w-full space-y-2">
            {toolCalls.map((tc) => (
              <ToolCallDisplay key={tc.id} {...tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

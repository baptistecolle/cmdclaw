"use client";

import { User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant";
  content: string;
  className?: string;
};

export function MessageBubble({ role, content, className }: Props) {
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse", className)}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-2",
          isUser && "items-end"
        )}
      >
        <div
          className={cn(
            "rounded-lg px-4 py-2",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}
        >
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    </div>
  );
}

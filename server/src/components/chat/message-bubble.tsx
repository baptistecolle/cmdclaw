"use client";

import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant";
  content: string;
  className?: string;
};

export function MessageBubble({ role, content, className }: Props) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className={cn("flex justify-end", className)}>
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    </div>
  );
}

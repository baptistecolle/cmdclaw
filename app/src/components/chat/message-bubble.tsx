"use client";

import ReactMarkdown from "react-markdown";
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
      <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

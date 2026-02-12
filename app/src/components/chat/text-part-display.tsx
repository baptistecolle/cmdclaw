"use client";

type Props = {
  content: string;
  isStreaming?: boolean;
};

export function TextPartDisplay({ content, isStreaming }: Props) {
  return (
    <div className="rounded-lg bg-muted px-4 py-2">
      <p className="whitespace-pre-wrap text-sm">{content}</p>
      {isStreaming && <span className="inline-block h-4 w-1 animate-pulse bg-foreground/50" />}
    </div>
  );
}

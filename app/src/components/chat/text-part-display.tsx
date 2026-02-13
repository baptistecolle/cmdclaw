"use client";

type Props = {
  content: string;
  isStreaming?: boolean;
};

export function TextPartDisplay({ content, isStreaming }: Props) {
  return (
    <div className="bg-muted rounded-lg px-4 py-2">
      <p className="text-sm whitespace-pre-wrap">{content}</p>
      {isStreaming && <span className="bg-foreground/50 inline-block h-4 w-1 animate-pulse" />}
    </div>
  );
}

"use client";

import { Download } from "lucide-react";
import { useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import type { SandboxFileData } from "./message-list";

type Props = {
  role: "user" | "assistant";
  content: string;
  className?: string;
  sandboxFiles?: SandboxFileData[];
  onFileClick?: (file: SandboxFileData) => void;
};

// Regex to match file paths like /app/file.txt or /home/user/file.pdf
const FILE_PATH_REGEX = /(?<!\S)(\/(?:app|home\/user)\/[^\s\])"']+\.[a-zA-Z0-9]+)(?!\S)/g;

function MarkdownFileButton({
  file,
  label,
  className,
  onFileClick,
}: {
  file: SandboxFileData;
  label: string;
  className: string;
  onFileClick: (file: SandboxFileData) => void;
}) {
  const handleClick = useCallback(() => {
    onFileClick(file);
  }, [file, onFileClick]);

  return (
    <button onClick={handleClick} className={className}>
      {label}
      <Download className="w-3 h-3" />
    </button>
  );
}

export function MessageBubble({ role, content, className, sandboxFiles, onFileClick }: Props) {
  const isUser = role === "user";

  // Create a map of path -> sandbox file for quick lookup
  const fileMap = useMemo(() => {
    const map = new Map<string, SandboxFileData>();
    if (sandboxFiles) {
      for (const file of sandboxFiles) {
        map.set(file.path, file);
      }
    }
    return map;
  }, [sandboxFiles]);

  // Custom component to render text with clickable file paths
  const renderTextWithPaths = useCallback(
    (text: string) => {
      if (!sandboxFiles?.length || !onFileClick) {
        return text;
      }

      const parts: (string | React.ReactNode)[] = [];
      let lastIndex = 0;
      let match;
      const regex = new RegExp(FILE_PATH_REGEX.source, "g");

      while ((match = regex.exec(text)) !== null) {
        const path = match[1];
        const file = fileMap.get(path);

        if (file) {
          // Add text before the match
          if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
          }

          // Add clickable file link
          parts.push(
            <MarkdownFileButton
              key={`${path}-${match.index}`}
              file={file}
              label={path}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              onFileClick={onFileClick}
            />,
          );

          lastIndex = regex.lastIndex;
        }
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }

      return parts.length > 0 ? parts : text;
    },
    [fileMap, onFileClick, sandboxFiles?.length],
  );
  const markdownComponents = useMemo(
    () => ({
      // Override text rendering to handle file paths
      p: ({ children }: { children: React.ReactNode }) => (
        <p>
          {Array.isArray(children)
            ? React.Children.map(children, (child) =>
                typeof child === "string" ? <span>{renderTextWithPaths(child)}</span> : child,
              )
            : typeof children === "string"
              ? renderTextWithPaths(children)
              : children}
        </p>
      ),
      code: ({
        children,
        className: codeClassName,
      }: {
        children: React.ReactNode;
        className?: string;
      }) => {
        const isInline = !codeClassName;
        if (isInline && typeof children === "string") {
          const file = fileMap.get(children);
          if (file && onFileClick) {
            return (
              <MarkdownFileButton
                file={file}
                label={children}
                className="inline-flex items-center gap-1 bg-muted px-1 rounded text-primary hover:underline font-mono text-sm"
                onFileClick={onFileClick}
              />
            );
          }
        }
        return <code className={codeClassName}>{children}</code>;
      },
    }),
    [fileMap, onFileClick, renderTextWithPaths],
  );

  if (isUser) {
    return (
      <div data-testid="chat-bubble-user" className={cn("flex justify-end", className)}>
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chat-bubble-assistant" className={className}>
      <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none">
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

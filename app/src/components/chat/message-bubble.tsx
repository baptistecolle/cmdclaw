"use client";

import { Download } from "lucide-react";
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

export function MessageBubble({ role, content, className, sandboxFiles, onFileClick }: Props) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div data-testid="chat-bubble-user" className={cn("flex justify-end", className)}>
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  // Create a map of path -> sandbox file for quick lookup
  const fileMap = new Map<string, SandboxFileData>();
  if (sandboxFiles) {
    for (const file of sandboxFiles) {
      fileMap.set(file.path, file);
    }
  }

  // Custom component to render text with clickable file paths
  const renderTextWithPaths = (text: string) => {
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
          <button
            key={`${path}-${match.index}`}
            onClick={() => onFileClick(file)}
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
          >
            {path}
            <Download className="w-3 h-3" />
          </button>,
        );

        lastIndex = regex.lastIndex;
      }
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div data-testid="chat-bubble-assistant" className={className}>
      <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none">
        <ReactMarkdown
          components={{
            // Override text rendering to handle file paths
            p: ({ children }) => (
              <p>
                {Array.isArray(children)
                  ? React.Children.map(children, (child) =>
                      typeof child === "string" ? (
                        <span>{renderTextWithPaths(child)}</span>
                      ) : (
                        child
                      ),
                    )
                  : typeof children === "string"
                    ? renderTextWithPaths(children)
                    : children}
              </p>
            ),
            code: ({ children, className: codeClassName }) => {
              const isInline = !codeClassName;
              if (isInline && typeof children === "string") {
                const file = fileMap.get(children);
                if (file && onFileClick) {
                  return (
                    <button
                      onClick={() => onFileClick(file)}
                      className="inline-flex items-center gap-1 bg-muted px-1 rounded text-primary hover:underline font-mono text-sm"
                    >
                      {children}
                      <Download className="w-3 h-3" />
                    </button>
                  );
                }
              }
              return <code className={codeClassName}>{children}</code>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

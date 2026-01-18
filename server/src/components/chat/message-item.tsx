"use client";

import { useMemo } from "react";
import { MessageBubble } from "./message-bubble";
import { CollapsedTrace } from "./collapsed-trace";
import type { MessagePart } from "./message-list";
import type { IntegrationType } from "@/lib/integration-icons";
import type { ActivityItemData } from "./activity-item";

type Props = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts?: MessagePart[];
  integrationsUsed?: string[];
};

export function MessageItem({ id, role, content, parts, integrationsUsed }: Props) {
  // For user messages, show simple bubble
  if (role === "user") {
    return (
      <div className="py-4">
        <MessageBubble role="user" content={content} />
      </div>
    );
  }

  // Convert message parts to activity items for collapsed trace
  const activityItems = useMemo((): ActivityItemData[] => {
    if (!parts) return [];

    return parts
      .filter((part) => part.type === "text" || part.type === "thinking" || part.type === "tool_call")
      .map((part, index): ActivityItemData => {
        if (part.type === "text") {
          return {
            id: `activity-text-${index}`,
            timestamp: Date.now() - (parts.length - index) * 1000,
            type: "text",
            content: part.content,
          };
        } else if (part.type === "thinking") {
          return {
            id: `activity-${part.id}`,
            timestamp: Date.now() - (parts.length - index) * 1000, // Approximate timestamps
            type: "thinking",
            content: part.content,
          };
        } else {
          // tool_call
          return {
            id: `activity-${part.id}`,
            timestamp: Date.now() - (parts.length - index) * 1000,
            type: "tool_call",
            content: part.name,
            toolName: part.name,
            integration: part.integration as IntegrationType | undefined,
            operation: part.operation,
            status: part.result !== undefined ? "complete" : "running",
            input: part.input,
            result: part.result,
          };
        }
      });
  }, [parts]);

  // Extract integrations from parts if not provided
  const integrations = useMemo((): IntegrationType[] => {
    if (integrationsUsed && integrationsUsed.length > 0) {
      return integrationsUsed as IntegrationType[];
    }
    if (!parts) return [];

    const found = new Set<string>();
    for (const part of parts) {
      if (part.type === "tool_call" && part.integration) {
        found.add(part.integration);
      }
    }
    return Array.from(found) as IntegrationType[];
  }, [parts, integrationsUsed]);

  // Check if there were any text, tool calls or thinking (need to show trace)
  const hasTrace = parts && parts.some(
    (p) => p.type === "text" || p.type === "thinking" || p.type === "tool_call"
  );

  // Check if there was an error
  const hasError = content.startsWith("Error:");

  // Get text content - only show the last text part when parts exist
  const textContent = useMemo(() => {
    if (!parts || parts.length === 0) {
      return content || "";
    }

    // Find the last text part to display after the trace
    const textParts = parts.filter((p) => p.type === "text");
    if (textParts.length === 0) {
      return "";
    }

    // Return only the last text part's content
    const lastTextPart = textParts[textParts.length - 1];
    return lastTextPart.content;
  }, [parts, content]);

  return (
    <div className="py-4 space-y-3">
      {/* Show collapsed trace if there was any activity */}
      {hasTrace && activityItems.length > 0 && (
        <CollapsedTrace
          messageId={id}
          integrationsUsed={integrations}
          hasError={hasError}
          activityItems={activityItems}
        />
      )}

      {/* Show message bubble if there's text content */}
      {textContent && (
        <MessageBubble role="assistant" content={textContent} />
      )}

      {/* If no text and no trace, show empty indicator */}
      {!textContent && !hasTrace && (
        <div className="text-sm text-muted-foreground italic">
          Task completed
        </div>
      )}
    </div>
  );
}

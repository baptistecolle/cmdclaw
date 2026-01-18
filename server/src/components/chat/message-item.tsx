"use client";

import { useMemo, useState } from "react";
import { MessageBubble } from "./message-bubble";
import { CollapsedTrace } from "./collapsed-trace";
import { ToolApprovalCard } from "./tool-approval-card";
import type { MessagePart } from "./message-list";
import type { IntegrationType } from "@/lib/integration-icons";
import type { ActivityItemData } from "./activity-item";

// Display segment for saved messages
type DisplaySegment = {
  id: string;
  items: ActivityItemData[];
  approval: {
    toolUseId: string;
    toolName: string;
    toolInput: unknown;
    integration: string;
    operation: string;
    command?: string;
    status: "approved" | "denied";
  } | null;
};

type Props = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts?: MessagePart[];
  integrationsUsed?: string[];
};

export function MessageItem({ id, role, content, parts, integrationsUsed }: Props) {
  // Track expanded state for each segment
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set());

  // For user messages, show simple bubble
  if (role === "user") {
    return (
      <div className="py-4">
        <MessageBubble role="user" content={content} />
      </div>
    );
  }

  // Parse message parts into segments based on approval parts
  const segments = useMemo((): DisplaySegment[] => {
    if (!parts) return [];

    const result: DisplaySegment[] = [];
    let currentSegment: DisplaySegment = { id: "seg-0", items: [], approval: null };
    let segmentIndex = 0;
    let activityIndex = 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.type === "approval") {
        // Attach approval to current segment and start new one
        currentSegment.approval = {
          toolUseId: part.toolUseId,
          toolName: part.toolName,
          toolInput: part.toolInput,
          integration: part.integration,
          operation: part.operation,
          command: part.command,
          status: part.status,
        };
        result.push(currentSegment);
        segmentIndex++;
        currentSegment = { id: `seg-${segmentIndex}`, items: [], approval: null };
      } else if (part.type === "tool_call") {
        // Add tool call to current segment's items
        currentSegment.items.push({
          id: `activity-${part.id}`,
          timestamp: Date.now() - (parts.length - i) * 1000,
          type: "tool_call",
          content: part.name,
          toolName: part.name,
          integration: part.integration as IntegrationType | undefined,
          operation: part.operation,
          status: part.result !== undefined ? "complete" : "running",
          input: part.input,
          result: part.result,
        });
        activityIndex++;
      } else if (part.type === "thinking") {
        currentSegment.items.push({
          id: `activity-${part.id}`,
          timestamp: Date.now() - (parts.length - i) * 1000,
          type: "thinking",
          content: part.content,
        });
        activityIndex++;
      } else if (part.type === "text") {
        currentSegment.items.push({
          id: `activity-text-${activityIndex}`,
          timestamp: Date.now() - (parts.length - i) * 1000,
          type: "text",
          content: part.content,
        });
        activityIndex++;
      }
    }

    // Push final segment if it has items
    if (currentSegment.items.length > 0) {
      result.push(currentSegment);
    }

    return result;
  }, [parts]);

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
    const textParts = parts.filter((p): p is MessagePart & { type: "text" } => p.type === "text");
    if (textParts.length === 0) {
      return "";
    }

    // Return only the last text part's content
    const lastTextPart = textParts[textParts.length - 1];
    return lastTextPart.content;
  }, [parts, content]);

  // Toggle segment expand/collapse
  const toggleSegmentExpand = (segmentId: string) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  // Check if we have segments with approvals (need segmented display)
  const hasApprovals = segments.some((seg) => seg.approval !== null);

  return (
    <div className="py-4 space-y-3">
      {/* Show segmented trace if there are approvals, otherwise show collapsed trace */}
      {hasTrace && segments.length > 0 && (
        hasApprovals ? (
          // Segmented display with approvals between segments
          <div className="space-y-3">
            {segments.map((segment, index) => {
              // Get integrations used in this segment
              const segmentIntegrations = Array.from(
                new Set(
                  segment.items
                    .filter((item) => item.integration)
                    .map((item) => item.integration as IntegrationType)
                )
              );

              // Only last segment is expanded by default
              const isExpanded = expandedSegments.has(segment.id);

              return (
                <div key={segment.id} className="space-y-3">
                  {/* Activity trace for this segment */}
                  {segment.items.length > 0 && (
                    <CollapsedTrace
                      messageId={`${id}-${segment.id}`}
                      integrationsUsed={segmentIntegrations}
                      hasError={hasError && index === segments.length - 1}
                      activityItems={segment.items}
                      defaultExpanded={isExpanded}
                      onToggleExpand={() => toggleSegmentExpand(segment.id)}
                    />
                  )}

                  {/* Approval card (readonly, no buttons) */}
                  {segment.approval && (
                    <ToolApprovalCard
                      toolUseId={segment.approval.toolUseId}
                      toolName={segment.approval.toolName}
                      toolInput={segment.approval.toolInput}
                      integration={segment.approval.integration}
                      operation={segment.approval.operation}
                      command={segment.approval.command}
                      status={segment.approval.status}
                      onApprove={() => {}}
                      onDeny={() => {}}
                      readonly
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // Simple collapsed trace (no approvals)
          <CollapsedTrace
            messageId={id}
            integrationsUsed={
              integrationsUsed
                ? (integrationsUsed as IntegrationType[])
                : Array.from(
                    new Set(
                      segments.flatMap((seg) =>
                        seg.items
                          .filter((item) => item.integration)
                          .map((item) => item.integration as IntegrationType)
                      )
                    )
                  )
            }
            hasError={hasError}
            activityItems={segments.flatMap((seg) => seg.items)}
          />
        )
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

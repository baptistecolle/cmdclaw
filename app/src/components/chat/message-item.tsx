"use client";

import { Paperclip, Download, FileIcon, Eye } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import type { IntegrationType } from "@/lib/integration-icons";
import { useDownloadAttachment, useDownloadSandboxFile } from "@/orpc/hooks";
import type { ActivityItemData } from "./activity-item";
import type { MessagePart, AttachmentData, SandboxFileData } from "./message-list";
import { CollapsedTrace } from "./collapsed-trace";
import { MessageBubble } from "./message-bubble";
import { ToolApprovalCard } from "./tool-approval-card";

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
  attachments?: AttachmentData[];
  sandboxFiles?: SandboxFileData[];
};

const NOOP = () => {};

function getAttachmentKey(a: AttachmentData): string {
  return a.id ?? `${a.name}-${a.mimeType}-${a.dataUrl}`;
}

export function MessageItem({
  id,
  role,
  content,
  parts,
  integrationsUsed,
  attachments,
  sandboxFiles,
}: Props) {
  // Track expanded state for each segment
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set());
  const { mutateAsync: downloadAttachment } = useDownloadAttachment();
  const { mutateAsync: downloadSandboxFile } = useDownloadSandboxFile();

  const getAttachmentUrl = useCallback(
    async (attachment: AttachmentData): Promise<string | null> => {
      if (attachment.id) {
        const result = await downloadAttachment(attachment.id);
        return result.url;
      }
      return attachment.dataUrl || null;
    },
    [downloadAttachment],
  );

  const handleViewAttachment = useCallback(
    async (attachment: AttachmentData) => {
      try {
        const url = await getAttachmentUrl(attachment);
        if (!url) {
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        console.error("Failed to open attachment:", err);
      }
    },
    [getAttachmentUrl],
  );

  const handleDownload = useCallback(
    async (attachment: AttachmentData) => {
      try {
        const url = await getAttachmentUrl(attachment);
        if (!url) {
          return;
        }

        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error("Failed to download attachment:", err);
      }
    },
    [getAttachmentUrl],
  );

  const handleDownloadSandboxFile = useCallback(
    async (file: SandboxFileData) => {
      try {
        const result = await downloadSandboxFile(file.fileId);
        // Trigger download via temporary link
        const link = document.createElement("a");
        link.href = result.url;
        link.download = file.filename;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error("Failed to download sandbox file:", err);
      }
    },
    [downloadSandboxFile],
  );

  const hasInterruptedMarker = useMemo(
    () => !!parts?.some((p) => p.type === "system" && p.content === "Interrupted by user"),
    [parts],
  );

  // Parse message parts into segments based on approval parts
  const segments = useMemo((): DisplaySegment[] => {
    if (!parts) {
      return [];
    }

    const result: DisplaySegment[] = [];
    let currentSegment: DisplaySegment = {
      id: "seg-0",
      items: [],
      approval: null,
    };
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
        currentSegment = {
          id: `seg-${segmentIndex}`,
          items: [],
          approval: null,
        };
      } else if (part.type === "tool_call") {
        // Add tool call to current segment's items
        currentSegment.items.push({
          id: `activity-${part.id}`,
          timestamp: i + 1,
          type: "tool_call",
          content: part.name,
          toolName: part.name,
          integration: part.integration as IntegrationType | undefined,
          operation: part.operation,
          status:
            part.result !== undefined
              ? "complete"
              : hasInterruptedMarker
                ? "interrupted"
                : "running",
          input: part.input,
          result: part.result,
        });
        activityIndex++;
      } else if (part.type === "thinking") {
        currentSegment.items.push({
          id: `activity-${part.id}`,
          timestamp: i + 1,
          type: "thinking",
          content: part.content,
        });
        activityIndex++;
      } else if (part.type === "system") {
        currentSegment.items.push({
          id: `activity-system-${activityIndex}`,
          timestamp: i + 1,
          type: "system",
          content: part.content,
        });
        activityIndex++;
      } else if (part.type === "text") {
        currentSegment.items.push({
          id: `activity-text-${activityIndex}`,
          timestamp: i + 1,
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
  }, [hasInterruptedMarker, parts]);

  // Check if there were any text, tool calls or thinking (need to show trace)
  const hasTrace =
    parts &&
    parts.some(
      (p) =>
        p.type === "text" || p.type === "thinking" || p.type === "tool_call" || p.type === "system",
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
  const toggleSegmentExpand = useCallback((segmentId: string) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- Set.delete, not a Drizzle query
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  }, []);

  const attachmentsByKey = useMemo(() => {
    const map = new Map<string, AttachmentData>();
    for (const attachment of attachments ?? []) {
      map.set(getAttachmentKey(attachment), attachment);
    }
    return map;
  }, [attachments]);

  const sandboxFilesById = useMemo(() => {
    const map = new Map<string, SandboxFileData>();
    for (const file of sandboxFiles ?? []) {
      map.set(file.fileId, file);
    }
    return map;
  }, [sandboxFiles]);

  const segmentToggleHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of segments) {
      handlers.set(segment.id, () => {
        toggleSegmentExpand(segment.id);
      });
    }
    return handlers;
  }, [segments, toggleSegmentExpand]);

  const handleAttachmentViewClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const key = event.currentTarget.dataset.attachmentKey;
      if (!key) {
        return;
      }
      const attachment = attachmentsByKey.get(key);
      if (attachment) {
        void handleViewAttachment(attachment);
      }
    },
    [attachmentsByKey, handleViewAttachment],
  );

  const handleAttachmentDownloadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const key = event.currentTarget.dataset.attachmentKey;
      if (!key) {
        return;
      }
      const attachment = attachmentsByKey.get(key);
      if (attachment) {
        void handleDownload(attachment);
      }
    },
    [attachmentsByKey, handleDownload],
  );

  const handleSandboxFileClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const fileId = event.currentTarget.dataset.fileId;
      if (!fileId) {
        return;
      }
      const file = sandboxFilesById.get(fileId);
      if (file) {
        void handleDownloadSandboxFile(file);
      }
    },
    [handleDownloadSandboxFile, sandboxFilesById],
  );

  // Check if we have segments with approvals (need segmented display)
  const hasApprovals = segments.some((seg) => seg.approval !== null);

  // For user messages, show simple bubble + attachments
  if (role === "user") {
    return (
      <div data-testid="chat-message-user" className="py-4 space-y-2">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {attachments.map((a) =>
              a.mimeType.startsWith("image/") && a.dataUrl ? (
                <div key={getAttachmentKey(a)} className="relative group">
                  <Image
                    src={a.dataUrl}
                    alt={a.name}
                    width={320}
                    height={192}
                    unoptimized
                    className="max-h-48 max-w-xs rounded-lg border object-cover"
                  />
                  {(a.id || a.dataUrl) && (
                    <div className="absolute top-1 right-1 flex items-center gap-1 rounded-md bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        data-attachment-key={getAttachmentKey(a)}
                        onClick={handleAttachmentViewClick}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-attachment-key={getAttachmentKey(a)}
                        onClick={handleAttachmentDownloadClick}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  key={getAttachmentKey(a)}
                  className="flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="max-w-[200px] truncate">{a.name}</span>
                  <button
                    type="button"
                    data-attachment-key={getAttachmentKey(a)}
                    onClick={handleAttachmentViewClick}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background"
                  >
                    <Eye className="h-3 w-3 text-muted-foreground" />
                    <span>View</span>
                  </button>
                  <button
                    type="button"
                    data-attachment-key={getAttachmentKey(a)}
                    onClick={handleAttachmentDownloadClick}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background"
                  >
                    <Download className="h-3 w-3 text-muted-foreground" />
                    <span>Download</span>
                  </button>
                </div>
              ),
            )}
          </div>
        )}
        <MessageBubble role="user" content={content} />
      </div>
    );
  }

  return (
    <div
      data-testid={role === "assistant" ? "chat-message-assistant" : undefined}
      className="py-4 space-y-3"
    >
      {/* Show segmented trace if there are approvals, otherwise show collapsed trace */}
      {hasTrace &&
        segments.length > 0 &&
        (hasApprovals ? (
          // Segmented display with approvals between segments
          <div className="space-y-3">
            {segments.map((segment, index) => {
              // Get integrations used in this segment
              const segmentIntegrations = Array.from(
                new Set(
                  segment.items
                    .filter((item) => item.integration)
                    .map((item) => item.integration as IntegrationType),
                ),
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
                      onToggleExpand={segmentToggleHandlers.get(segment.id) ?? NOOP}
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
                      onApprove={NOOP}
                      onDeny={NOOP}
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
                          .map((item) => item.integration as IntegrationType),
                      ),
                    ),
                  )
            }
            hasError={hasError}
            activityItems={segments.flatMap((seg) => seg.items)}
          />
        ))}

      {/* Show message bubble if there's text content */}
      {textContent && (
        <MessageBubble
          role="assistant"
          content={textContent}
          sandboxFiles={sandboxFiles}
          onFileClick={handleDownloadSandboxFile}
        />
      )}

      {/* Show sandbox files as downloadable attachments */}
      {sandboxFiles && sandboxFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {sandboxFiles.map((file) => (
            <button
              key={file.fileId}
              data-file-id={file.fileId}
              onClick={handleSandboxFileClick}
              className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors text-sm"
            >
              <FileIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{file.filename}</span>
              {file.sizeBytes && (
                <span className="text-xs text-muted-foreground">
                  ({formatFileSize(file.sizeBytes)})
                </span>
              )}
              <Download className="w-4 h-4 ml-1 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* If no text and no trace, show empty indicator */}
      {!textContent && !hasTrace && !sandboxFiles?.length && (
        <div className="text-sm text-muted-foreground italic">Task completed</div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

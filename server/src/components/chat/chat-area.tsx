"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageList, type Message, type MessagePart } from "./message-list";
import { ChatInput } from "./chat-input";
import { VoiceIndicator, VoiceHint } from "./voice-indicator";
import { ToolApprovalCard } from "./tool-approval-card";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import {
  useConversation,
  useTranscribe,
  useGeneration,
  useSubmitApproval,
  useActiveGeneration,
  useCancelGeneration,
  type GenerationPendingApprovalData,
} from "@/orpc/hooks";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { useRouter } from "next/navigation";
import { MessageSquare, AlertCircle, Activity } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import type { IntegrationType } from "@/lib/integration-icons";

// Trace state for tracking activity during a conversation turn
type TraceStatus = "streaming" | "complete" | "error" | "waiting_approval";

// Segment approval data
type SegmentApproval = {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  status: "pending" | "approved" | "denied";
};

// Activity segment - groups activities between approvals
type ActivitySegment = {
  id: string;
  items: ActivityItemData[];
  approval?: SegmentApproval;
  isExpanded: boolean;
};

type Props = {
  conversationId?: string;
};

export function ChatArea({ conversationId }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: existingConversation, isLoading } = useConversation(
    conversationId
  );
  const { startGeneration, subscribeToGeneration, abort } = useGeneration();
  const { mutateAsync: submitApproval, isPending: isApproving } = useSubmitApproval();
  const { mutateAsync: cancelGeneration } = useCancelGeneration();
  const { data: activeGeneration } = useActiveGeneration(conversationId);

  // Track current generation ID
  const currentGenerationIdRef = useRef<string | undefined>(undefined);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  // Segmented activity feed state
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [integrationsUsed, setIntegrationsUsed] = useState<Set<IntegrationType>>(new Set());
  const [traceStatus, setTraceStatus] = useState<TraceStatus>("complete");

  // Track tool call start times for duration display
  const toolCallStartTimes = useRef<Map<string, number>>(new Map());

  // Current conversation ID (may be set during streaming for new conversations)
  const currentConversationIdRef = useRef<string | undefined>(conversationId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const isNearBottomRef = useRef(true);

  // Voice recording
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  // Load existing messages
  useEffect(() => {
    const conv = existingConversation as {
      messages?: Array<{
        id: string;
        role: string;
        content: string;
        contentParts?: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
          | { type: "tool_result"; tool_use_id: string; content: unknown }
          | { type: "thinking"; id: string; content: string }
        >;
      }>;
    } | null | undefined;

    if (conv?.messages) {
      setMessages(
        conv.messages.map((m) => {
          // Convert contentParts to frontend parts format
          let parts: MessagePart[] | undefined;
          if (m.contentParts && m.contentParts.length > 0) {
            // Build a map of tool_use_id -> result for merging
            const toolResults = new Map<string, unknown>();
            for (const part of m.contentParts) {
              if (part.type === "tool_result") {
                toolResults.set(part.tool_use_id, part.content);
              }
            }
            // Convert parts, merging tool_result into tool_use
            parts = m.contentParts
              .filter((p) => p.type !== "tool_result")
              .map((p) => {
                if (p.type === "text") {
                  return { type: "text" as const, content: p.text };
                } else if (p.type === "thinking") {
                  return { type: "thinking" as const, id: p.id, content: p.content };
                } else {
                  // tool_use -> tool_call with result merged
                  return {
                    type: "tool_call" as const,
                    id: p.id,
                    name: p.name,
                    input: p.input,
                    result: toolResults.get(p.id),
                  };
                }
              });
          }
          return {
            id: m.id,
            role: m.role as Message["role"],
            content: m.content,
            parts,
          };
        })
      );
    }
  }, [existingConversation]);

  // Reset when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setStreamingParts([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("complete");
      currentGenerationIdRef.current = undefined;
    }
  }, [conversationId]);

  // Reconnect to active generation on mount
  useEffect(() => {
    if (
      activeGeneration?.generationId &&
      (activeGeneration.status === "generating" || activeGeneration.status === "awaiting_approval")
    ) {
      // There's an active generation - reconnect to it
      currentGenerationIdRef.current = activeGeneration.generationId;
      setIsStreaming(true);
      setTraceStatus(activeGeneration.status === "awaiting_approval" ? "waiting_approval" : "streaming");

      // Subscribe to the generation stream
      const allParts: MessagePart[] = [];
      const usedIntegrations = new Set<IntegrationType>();
      let toolCallCounter = 0;
      let activityCounter = 0;
      let segmentCounter = 0;

      const allSegments: ActivitySegment[] = [
        { id: `seg-${segmentCounter++}`, items: [], isExpanded: true },
      ];

      const getCurrentSegment = () => allSegments[allSegments.length - 1];

      const updateSegmentsState = () => {
        const clonedSegments = allSegments.map((seg, idx) => ({
          ...seg,
          items: [...seg.items],
          isExpanded: idx === allSegments.length - 1,
        }));
        setSegments(clonedSegments);
      };

      subscribeToGeneration(activeGeneration.generationId, {
        onText: (text) => {
          const lastPart = allParts[allParts.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.content += text;
          } else {
            allParts.push({ type: "text", content: text });
          }
          setStreamingParts([...allParts]);

          const currentSeg = getCurrentSegment();
          const lastTextActivity = currentSeg.items[currentSeg.items.length - 1];
          if (lastTextActivity && lastTextActivity.type === "text") {
            lastTextActivity.content += text;
          } else {
            currentSeg.items.push({
              id: `activity-${activityCounter++}`,
              timestamp: Date.now(),
              type: "text",
              content: text,
            });
          }
          updateSegmentsState();
        },
        onThinking: (data) => {
          allParts.push({ type: "thinking", id: data.thinkingId, content: data.content });
          setStreamingParts([...allParts]);
          getCurrentSegment().items.push({
            id: `activity-${activityCounter++}`,
            timestamp: Date.now(),
            type: "thinking",
            content: data.content,
          });
          updateSegmentsState();
        },
        onToolUse: (data) => {
          const toolId = data.toolUseId || `tc-${toolCallCounter++}`;
          allParts.push({
            type: "tool_call",
            id: toolId,
            name: data.toolName,
            input: data.toolInput,
            integration: data.integration,
            operation: data.operation,
            isWrite: data.isWrite,
          });
          setStreamingParts([...allParts]);

          if (data.integration) {
            usedIntegrations.add(data.integration as IntegrationType);
            setIntegrationsUsed(new Set(usedIntegrations));
          }

          getCurrentSegment().items.push({
            id: `activity-${activityCounter++}`,
            timestamp: Date.now(),
            type: "tool_call",
            content: data.toolName,
            toolName: data.toolName,
            integration: data.integration as IntegrationType | undefined,
            operation: data.operation,
            status: "running",
            input: data.toolInput,
          });
          updateSegmentsState();
        },
        onToolResult: (toolName, result) => {
          for (let i = allParts.length - 1; i >= 0; i--) {
            const part = allParts[i];
            if (part.type === "tool_call" && part.name === toolName && part.result === undefined) {
              part.result = result;
              break;
            }
          }
          setStreamingParts([...allParts]);

          for (let i = allSegments.length - 1; i >= 0; i--) {
            const seg = allSegments[i];
            const toolItem = [...seg.items].reverse().find(
              (item) => item.type === "tool_call" && item.content === toolName && item.status === "running"
            );
            if (toolItem) {
              toolItem.status = "complete";
              toolItem.result = result;
              break;
            }
          }
          updateSegmentsState();
        },
        onPendingApproval: (data) => {
          currentGenerationIdRef.current = data.generationId;

          const currentSeg = getCurrentSegment();
          currentSeg.approval = {
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            toolInput: data.toolInput,
            integration: data.integration,
            operation: data.operation,
            command: data.command,
            status: "pending",
          };

          currentSeg.isExpanded = false;
          allSegments.push({
            id: `seg-${segmentCounter++}`,
            items: [],
            isExpanded: true,
          });

          setTraceStatus("waiting_approval");
          updateSegmentsState();
        },
        onApprovalResult: (toolUseId, decision) => {
          for (const seg of allSegments) {
            if (seg.approval && seg.approval.toolUseId === toolUseId) {
              seg.approval.status = decision === "approved" ? "approved" : "denied";
              const toolItem = seg.items.find(
                (item) => item.type === "tool_call" && item.status === "running"
              );
              if (toolItem) {
                toolItem.status = decision === "approved" ? "complete" : "error";
              }
              break;
            }
          }
          setTraceStatus("streaming");
          updateSegmentsState();
        },
        onDone: (generationId, newConversationId, messageId, usage) => {
          const fullContent = allParts
            .filter((p): p is MessagePart & { type: "text" } => p.type === "text")
            .map((p) => p.content)
            .join("");

          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: fullContent,
              parts: allParts.length > 0 ? allParts : undefined,
              integrationsUsed: Array.from(usedIntegrations),
            } as Message & { integrationsUsed?: IntegrationType[] },
          ]);
          setStreamingParts([]);
          setIsStreaming(false);
          setSegments([]);
          setTraceStatus("complete");
          currentGenerationIdRef.current = undefined;
        },
        onError: (message) => {
          console.error("Generation error:", message);
          setIsStreaming(false);
          setTraceStatus("error");
          currentGenerationIdRef.current = undefined;
        },
        onCancelled: () => {
          setIsStreaming(false);
          setTraceStatus("complete");
          setSegments([]);
          currentGenerationIdRef.current = undefined;
        },
      });
    }
  }, [activeGeneration?.generationId, activeGeneration?.status, subscribeToGeneration]);

  // Track if user is near bottom of scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 100; // pixels from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;
  }, []);

  // Auto-scroll only if user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingParts]);

  const handleStop = useCallback(async () => {
    abort();
    // Cancel the generation on the backend too
    if (currentGenerationIdRef.current) {
      try {
        await cancelGeneration(currentGenerationIdRef.current);
      } catch (err) {
        console.error("Failed to cancel generation:", err);
      }
    }
    setIsStreaming(false);
    setStreamingParts([]);
    setTraceStatus("complete");
    setSegments([]);
    currentGenerationIdRef.current = undefined;
  }, [abort, cancelGeneration]);

  // Helper to toggle segment expansion
  const toggleSegmentExpand = useCallback((segmentId: string) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId ? { ...seg, isExpanded: !seg.isExpanded } : seg
      )
    );
  }, []);

  const handleSend = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingParts([]);

    // Reset segments for new message
    setSegments([]);
    setIntegrationsUsed(new Set());
    setTraceStatus("streaming");
    toolCallStartTimes.current.clear();

    const allParts: MessagePart[] = [];
    const usedIntegrations = new Set<IntegrationType>();
    let toolCallCounter = 0;
    let activityCounter = 0;
    let segmentCounter = 0;

    // Segment tracking - use mutable object for closure
    const allSegments: ActivitySegment[] = [
      { id: `seg-${segmentCounter++}`, items: [], isExpanded: true },
    ];

    // Helper to get current segment
    const getCurrentSegment = () => allSegments[allSegments.length - 1];

    // Helper to update segments state
    const updateSegmentsState = () => {
      // Clone segments for state update, ensuring only last segment is expanded
      const clonedSegments = allSegments.map((seg, idx) => ({
        ...seg,
        items: [...seg.items],
        isExpanded: idx === allSegments.length - 1,
      }));
      setSegments(clonedSegments);
    };

    const result = await startGeneration(
      { conversationId, content },
      {
        onText: (text) => {
          // Check if the last part is a text part - if so, append to it
          const lastPart = allParts[allParts.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.content += text;
          } else {
            // Create a new text part
            allParts.push({ type: "text", content: text });
          }
          setStreamingParts([...allParts]);

          // Add to current segment - update existing text item or create new one
          const currentSeg = getCurrentSegment();
          const lastTextActivity = currentSeg.items[currentSeg.items.length - 1];
          if (lastTextActivity && lastTextActivity.type === "text") {
            lastTextActivity.content += text;
          } else {
            const activityItem: ActivityItemData = {
              id: `activity-${activityCounter++}`,
              timestamp: Date.now(),
              type: "text",
              content: text,
            };
            currentSeg.items.push(activityItem);
          }
          updateSegmentsState();
        },
        onThinking: (data) => {
          // Create a new thinking part
          allParts.push({
            type: "thinking",
            id: data.thinkingId,
            content: data.content,
          });
          setStreamingParts([...allParts]);

          // Add to current segment
          const activityItem: ActivityItemData = {
            id: `activity-${activityCounter++}`,
            timestamp: Date.now(),
            type: "thinking",
            content: data.content,
          };
          getCurrentSegment().items.push(activityItem);
          updateSegmentsState();
        },
        onToolUse: (data) => {
          const toolId = data.toolUseId || `tc-${toolCallCounter++}`;
          const now = Date.now();
          toolCallStartTimes.current.set(toolId, now);

          allParts.push({
            type: "tool_call",
            id: toolId,
            name: data.toolName,
            input: data.toolInput,
            integration: data.integration,
            operation: data.operation,
            isWrite: data.isWrite,
          });
          setStreamingParts([...allParts]);

          // Track integration used
          if (data.integration) {
            usedIntegrations.add(data.integration as IntegrationType);
            setIntegrationsUsed(new Set(usedIntegrations));
          }

          // Add to current segment
          const activityItem: ActivityItemData = {
            id: `activity-${activityCounter++}`,
            timestamp: now,
            type: "tool_call",
            content: data.toolName,
            toolName: data.toolName,
            integration: data.integration as IntegrationType | undefined,
            operation: data.operation,
            status: "running",
            input: data.toolInput,
          };
          getCurrentSegment().items.push(activityItem);
          updateSegmentsState();
        },
        onToolResult: (toolName, result) => {
          // Find the last tool call with this name that doesn't have a result
          for (let i = allParts.length - 1; i >= 0; i--) {
            const part = allParts[i];
            if (part.type === "tool_call" && part.name === toolName && part.result === undefined) {
              part.result = result;
              break;
            }
          }
          setStreamingParts([...allParts]);

          // Find and update the tool call in segments
          for (let i = allSegments.length - 1; i >= 0; i--) {
            const seg = allSegments[i];
            const toolItem = [...seg.items].reverse().find(
              (item) => item.type === "tool_call" && item.content === toolName && item.status === "running"
            );
            if (toolItem) {
              toolItem.status = "complete";
              toolItem.result = result;
              break;
            }
          }
          updateSegmentsState();
        },
        onPendingApproval: (data) => {
          // Update the generation ID and conversation ID refs
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            currentConversationIdRef.current = data.conversationId;
          }

          // Find the pending tool in current segment and mark it
          const currentSeg = getCurrentSegment();
          const pendingTool = [...currentSeg.items].reverse().find(
            (item) => item.type === "tool_call" && item.status === "running"
          );
          if (pendingTool) {
            pendingTool.status = "running"; // Keep as running but approval will show
          }

          // Attach approval to current segment
          currentSeg.approval = {
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            toolInput: data.toolInput,
            integration: data.integration,
            operation: data.operation,
            command: data.command,
            status: "pending",
          };

          // Collapse current segment and create new one for subsequent activities
          currentSeg.isExpanded = false;
          allSegments.push({
            id: `seg-${segmentCounter++}`,
            items: [],
            isExpanded: true,
          });

          setTraceStatus("waiting_approval");
          updateSegmentsState();
        },
        onApprovalResult: (toolUseId, decision) => {
          // Find and update the approval status in segments
          for (const seg of allSegments) {
            if (seg.approval && seg.approval.toolUseId === toolUseId) {
              seg.approval.status = decision === "approved" ? "approved" : "denied";

              // Also update the tool call status
              const toolItem = seg.items.find(
                (item) => item.type === "tool_call" && item.status === "running"
              );
              if (toolItem) {
                toolItem.status = decision === "approved" ? "complete" : "error";
              }
              break;
            }
          }

          setTraceStatus("streaming");
          updateSegmentsState();
        },
        onDone: (generationId, newConversationId, messageId) => {
          // Compute full content from text parts
          const fullContent = allParts
            .filter((p): p is MessagePart & { type: "text" } => p.type === "text")
            .map((p) => p.content)
            .join("");

          // Build final parts array including approval parts
          const finalParts: MessagePart[] = [];
          for (const seg of allSegments) {
            // Add all activity items as parts
            for (const item of seg.items) {
              if (item.type === "tool_call") {
                // Find the corresponding part to get full info
                const part = allParts.find(
                  (p) => p.type === "tool_call" && p.name === item.toolName
                );
                if (part && part.type === "tool_call") {
                  finalParts.push(part);
                }
              } else if (item.type === "thinking") {
                const part = allParts.find(
                  (p) => p.type === "thinking" && p.content === item.content
                );
                if (part) {
                  finalParts.push(part);
                }
              } else if (item.type === "text") {
                // Text parts are already tracked in allParts in order
              }
            }

            // Add approval part if exists and resolved
            if (seg.approval && seg.approval.status !== "pending") {
              finalParts.push({
                type: "approval",
                toolUseId: seg.approval.toolUseId,
                toolName: seg.approval.toolName,
                toolInput: seg.approval.toolInput,
                integration: seg.approval.integration,
                operation: seg.approval.operation,
                command: seg.approval.command,
                status: seg.approval.status,
              });
            }
          }

          // Use allParts directly since it maintains correct order
          // and add approval parts at correct positions
          const partsWithApprovals: MessagePart[] = [];
          let approvalIndex = 0;
          const approvalParts: MessagePart[] = allSegments
            .filter((seg): seg is ActivitySegment & { approval: SegmentApproval & { status: "approved" | "denied" } } =>
              seg.approval !== undefined && seg.approval.status !== "pending")
            .map((seg) => ({
              type: "approval" as const,
              toolUseId: seg.approval.toolUseId,
              toolName: seg.approval.toolName,
              toolInput: seg.approval.toolInput,
              integration: seg.approval.integration,
              operation: seg.approval.operation,
              command: seg.approval.command,
              status: seg.approval.status,
            }));

          // Insert approval parts after their corresponding tool calls
          for (const part of allParts) {
            partsWithApprovals.push(part);
            // Check if this tool call has an approval
            if (part.type === "tool_call" && approvalIndex < approvalParts.length) {
              const approval = approvalParts[approvalIndex];
              if (approval.type === "approval" && approval.toolUseId === part.id) {
                partsWithApprovals.push(approval);
                approvalIndex++;
              }
            }
          }

          // Add assistant message to list with integrations used
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: fullContent,
              parts: partsWithApprovals.length > 0 ? partsWithApprovals : allParts,
              integrationsUsed: Array.from(usedIntegrations),
            } as Message & { integrationsUsed?: IntegrationType[] },
          ]);
          setStreamingParts([]);
          setIsStreaming(false);
          setSegments([]); // Clear segments when done
          setTraceStatus("complete");
          currentGenerationIdRef.current = undefined;

          // Update the ref and navigate to new conversation if this was a new chat
          if (!conversationId && newConversationId) {
            currentConversationIdRef.current = newConversationId;
            queryClient.invalidateQueries({ queryKey: ["conversation"] });
            router.push(`/chat/${newConversationId}`);
          }
        },
        onError: (message) => {
          console.error("Generation error:", message);
          setIsStreaming(false);
          setTraceStatus("error");
          currentGenerationIdRef.current = undefined;
          // Keep last segment expanded on error
          if (allSegments.length > 0) {
            allSegments[allSegments.length - 1].isExpanded = true;
            updateSegmentsState();
          }
          // Add error message
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: `Error: ${message}`,
            },
          ]);
        },
        onCancelled: () => {
          setIsStreaming(false);
          setTraceStatus("complete");
          setSegments([]);
          currentGenerationIdRef.current = undefined;
        },
      }
    );

    // Store the generation ID from the result
    if (result) {
      currentGenerationIdRef.current = result.generationId;
      if (!conversationId && result.conversationId) {
        currentConversationIdRef.current = result.conversationId;
        // Invalidate immediately so sidebar shows the new conversation right away
        queryClient.invalidateQueries({ queryKey: ["conversation"] });
      }
    }
  }, [conversationId, router, startGeneration, queryClient]);

  // Handle approval/denial of tool use
  const handleApprove = useCallback(
    async (toolUseId: string) => {
      const genId = currentGenerationIdRef.current;
      if (!genId) return;

      try {
        await submitApproval({
          generationId: genId,
          toolUseId,
          decision: "approve",
        });
        // Update local segment state
        setSegments((prev) =>
          prev.map((seg) =>
            seg.approval?.toolUseId === toolUseId
              ? { ...seg, approval: { ...seg.approval, status: "approved" as const } }
              : seg
          )
        );
      } catch (err) {
        console.error("Failed to approve tool use:", err);
      }
    },
    [submitApproval]
  );

  const handleDeny = useCallback(
    async (toolUseId: string) => {
      const genId = currentGenerationIdRef.current;
      if (!genId) return;

      try {
        await submitApproval({
          generationId: genId,
          toolUseId,
          decision: "deny",
        });
        // Update local segment state
        setSegments((prev) =>
          prev.map((seg) =>
            seg.approval?.toolUseId === toolUseId
              ? { ...seg, approval: { ...seg.approval, status: "denied" as const } }
              : seg
          )
        );
      } catch (err) {
        console.error("Failed to deny tool use:", err);
      }
    },
    [submitApproval]
  );

  // Voice recording: stop and transcribe
  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) return;

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        handleSend(result.text.trim());
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe, handleSend]);

  // Start recording handler (for both keyboard and button)
  const handleStartRecording = useCallback(() => {
    if (!isRecordingRef.current && !isStreaming && !isProcessingVoice) {
      isRecordingRef.current = true;
      startRecording();
    }
  }, [startRecording, isStreaming, isProcessingVoice]);

  // Push-to-talk: Ctrl/Cmd + M - start recording on keydown
  useHotkeys(
    "mod+m",
    handleStartRecording,
    { keydown: true, keyup: false, preventDefault: true },
    [handleStartRecording]
  );

  // Push-to-talk: stop recording when any part of the hotkey combo is released
  // On Mac, releasing M while Cmd is held doesn't always fire keyup for M,
  // so we also stop when Meta/Ctrl is released
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;

      const isHotkeyRelease =
        e.key === "m" ||
        e.key === "M" ||
        e.code === "KeyM" ||
        e.key === "Meta" ||
        e.key === "Control";

      if (isHotkeyRelease) {
        stopRecordingAndTranscribe();
      }
    };

    document.addEventListener("keyup", handleKeyUp);
    return () => document.removeEventListener("keyup", handleKeyUp);
  }, [stopRecordingAndTranscribe]);

  if (conversationId && isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4"
      >
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">How can I help you?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask me anything or use your connected integrations
                </p>
              </div>
            </div>
          ) : (
            <>
              <MessageList messages={messages} />

              {isStreaming && (
                <div className="py-4 space-y-4">
                  {segments.length === 0 && (
                    <div className="rounded-lg border border-border/50 bg-muted/30">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Creating agent...</span>
                        <div className="flex gap-1 ml-auto">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
                        </div>
                      </div>
                    </div>
                  )}
                  {segments.map((segment, index) => {
                    // Get integrations used in this segment
                    const segmentIntegrations = Array.from(
                      new Set(
                        segment.items
                          .filter((item) => item.integration)
                          .map((item) => item.integration as IntegrationType)
                      )
                    );

                    return (
                      <div key={segment.id} className="space-y-4">
                        {/* Only render activity feed if segment has items */}
                        {segment.items.length > 0 && (
                          <ActivityFeed
                            items={segment.items}
                            isStreaming={isStreaming && index === segments.length - 1 && !segment.approval}
                            isExpanded={segment.isExpanded}
                            onToggleExpand={() => toggleSegmentExpand(segment.id)}
                            integrationsUsed={segmentIntegrations}
                          />
                        )}

                        {/* Render approval card if segment has one */}
                        {segment.approval && (
                          <ToolApprovalCard
                            toolUseId={segment.approval.toolUseId}
                            toolName={segment.approval.toolName}
                            toolInput={segment.approval.toolInput}
                            integration={segment.approval.integration}
                            operation={segment.approval.operation}
                            command={segment.approval.command}
                            status={segment.approval.status}
                            isLoading={isApproving}
                            onApprove={() => handleApprove(segment.approval!.toolUseId)}
                            onDeny={() => handleDeny(segment.approval!.toolUseId)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {(isRecording || isProcessingVoice || voiceError) && (
            <VoiceIndicator
              isRecording={isRecording}
              isProcessing={isProcessingVoice}
              error={voiceError}
            />
          )}
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            disabled={isStreaming || isRecording || isProcessingVoice}
            isStreaming={isStreaming}
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={stopRecordingAndTranscribe}
          />
          <VoiceHint className="text-center" />
        </div>
      </div>
    </div>
  );
}

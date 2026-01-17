"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList, type Message, type MessagePart } from "./message-list";
import { ChatInput } from "./chat-input";
import { VoiceIndicator, VoiceHint } from "./voice-indicator";
import { ToolApprovalCard } from "./tool-approval-card";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import {
  useChatStream,
  useConversation,
  useTranscribe,
  useApproveToolUse,
  type PendingApprovalData,
} from "@/orpc/hooks";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import type { IntegrationType } from "@/lib/integration-icons";

// Pending approval state
type PendingApproval = PendingApprovalData & {
  status: "pending" | "approved" | "denied";
};

// Trace state for tracking activity during a conversation turn
type TraceStatus = "streaming" | "complete" | "error" | "waiting_approval";

type Props = {
  conversationId?: string;
};

export function ChatArea({ conversationId }: Props) {
  const router = useRouter();
  const { data: existingConversation, isLoading } = useConversation(
    conversationId
  );
  const { sendMessage, abort } = useChatStream();
  const { mutateAsync: approveToolUse, isPending: isApproving } = useApproveToolUse();

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Activity feed state
  const [activityItems, setActivityItems] = useState<ActivityItemData[]>([]);
  const [integrationsUsed, setIntegrationsUsed] = useState<Set<IntegrationType>>(new Set());
  const [isActivityFeedExpanded, setIsActivityFeedExpanded] = useState(false);
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
      setActivityItems([]);
      setIntegrationsUsed(new Set());
      setIsActivityFeedExpanded(false);
      setTraceStatus("complete");
    }
  }, [conversationId]);

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

  const handleStop = useCallback(() => {
    abort();
    setIsStreaming(false);
    setStreamingParts([]);
    setTraceStatus("complete");
    setIsActivityFeedExpanded(false);
  }, [abort]);

  const handleSend = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingParts([]);
    setPendingApprovals([]); // Clear any previous pending approvals

    // Reset activity feed state for new message
    setActivityItems([]);
    setIntegrationsUsed(new Set());
    setIsActivityFeedExpanded(false);
    setTraceStatus("streaming");
    toolCallStartTimes.current.clear();

    const allParts: MessagePart[] = [];
    const allActivityItems: ActivityItemData[] = [];
    const usedIntegrations = new Set<IntegrationType>();
    let toolCallCounter = 0;
    let activityCounter = 0;

    await sendMessage(
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
          // Note: Text content goes to message bubbles, not activity feed
        },
        onThinking: (data) => {
          // Create a new thinking part
          allParts.push({
            type: "thinking",
            id: data.thinkingId,
            content: data.content,
          });
          setStreamingParts([...allParts]);

          // Add to activity feed
          const activityItem: ActivityItemData = {
            id: `activity-${activityCounter++}`,
            timestamp: Date.now(),
            type: "thinking",
            content: data.content,
          };
          allActivityItems.push(activityItem);
          setActivityItems([...allActivityItems]);
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

          // Add to activity feed
          const activityItem: ActivityItemData = {
            id: `activity-${activityCounter++}`,
            timestamp: now,
            type: "tool_call",
            content: data.toolName,
            toolName: data.operation || data.toolName,
            integration: data.integration as IntegrationType | undefined,
            status: "running",
          };
          allActivityItems.push(activityItem);
          setActivityItems([...allActivityItems]);
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

          // Update the corresponding activity item status to complete
          const lastToolActivity = [...allActivityItems].reverse().find(
            (item) => item.type === "tool_call" && item.content === toolName && item.status === "running"
          );
          if (lastToolActivity) {
            lastToolActivity.status = "complete";
            setActivityItems([...allActivityItems]);
          }
        },
        onPendingApproval: (data) => {
          // Add to pending approvals
          setPendingApprovals((prev) => [
            ...prev,
            { ...data, status: "pending" },
          ]);
          setTraceStatus("waiting_approval");
        },
        onApprovalResult: (toolUseId, decision) => {
          // Update the status of the approval
          setPendingApprovals((prev) =>
            prev.map((a) =>
              a.toolUseId === toolUseId
                ? { ...a, status: decision === "approved" ? "approved" : "denied" }
                : a
            )
          );
          setTraceStatus("streaming");
        },
        onDone: (newConversationId, messageId) => {
          // Compute full content from text parts
          const fullContent = allParts
            .filter((p): p is MessagePart & { type: "text" } => p.type === "text")
            .map((p) => p.content)
            .join("");

          // Add assistant message to list with integrations used
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: fullContent,
              parts: allParts,
              integrationsUsed: Array.from(usedIntegrations),
            } as Message & { integrationsUsed?: IntegrationType[] },
          ]);
          setStreamingParts([]);
          setIsStreaming(false);
          setPendingApprovals([]); // Clear pending approvals when done
          setTraceStatus("complete");
          setIsActivityFeedExpanded(false); // Auto-collapse on complete

          // Update the ref and navigate to new conversation if this was a new chat
          if (!conversationId && newConversationId) {
            currentConversationIdRef.current = newConversationId;
            router.push(`/chat/${newConversationId}`);
          }
        },
        onError: (message) => {
          console.error("Chat error:", message);
          setIsStreaming(false);
          setPendingApprovals([]);
          setTraceStatus("error");
          setIsActivityFeedExpanded(true); // Keep expanded on error
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
      }
    );
  }, [conversationId, router, sendMessage]);

  // Handle approval/denial of tool use
  const handleApprove = useCallback(
    async (toolUseId: string) => {
      const convId = currentConversationIdRef.current || conversationId;
      if (!convId) return;

      try {
        await approveToolUse({
          conversationId: convId,
          toolUseId,
          decision: "allow",
        });
        // Update local state
        setPendingApprovals((prev) =>
          prev.map((a) =>
            a.toolUseId === toolUseId ? { ...a, status: "approved" } : a
          )
        );
      } catch (err) {
        console.error("Failed to approve tool use:", err);
      }
    },
    [conversationId, approveToolUse]
  );

  const handleDeny = useCallback(
    async (toolUseId: string) => {
      const convId = currentConversationIdRef.current || conversationId;
      if (!convId) return;

      try {
        await approveToolUse({
          conversationId: convId,
          toolUseId,
          decision: "deny",
        });
        // Update local state
        setPendingApprovals((prev) =>
          prev.map((a) =>
            a.toolUseId === toolUseId ? { ...a, status: "denied" } : a
          )
        );
      } catch (err) {
        console.error("Failed to deny tool use:", err);
      }
    },
    [conversationId, approveToolUse]
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
                  {/* Activity Feed - shows thinking and tool activity */}
                  <ActivityFeed
                    items={activityItems}
                    isStreaming={isStreaming}
                    isExpanded={isActivityFeedExpanded}
                    onToggleExpand={() => setIsActivityFeedExpanded(!isActivityFeedExpanded)}
                    integrationsUsed={Array.from(integrationsUsed)}
                  />

                  {/* Pending approval cards */}
                  {pendingApprovals.length > 0 && (
                    <div className="space-y-2">
                      {pendingApprovals.map((approval) => (
                        <ToolApprovalCard
                          key={approval.toolUseId}
                          toolUseId={approval.toolUseId}
                          toolName={approval.toolName}
                          toolInput={approval.toolInput}
                          integration={approval.integration}
                          operation={approval.operation}
                          command={approval.command}
                          status={approval.status}
                          isLoading={isApproving}
                          onApprove={() => handleApprove(approval.toolUseId)}
                          onDeny={() => handleDeny(approval.toolUseId)}
                        />
                      ))}
                    </div>
                  )}
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

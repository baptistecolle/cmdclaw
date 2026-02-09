"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageList, type Message, type MessagePart, type AttachmentData } from "./message-list";
import { ChatInput } from "./chat-input";
import { ModelSelector } from "./model-selector";
import { DeviceSelector } from "./device-selector";
import { VoiceIndicator, VoiceHint } from "./voice-indicator";
import { ToolApprovalCard } from "./tool-approval-card";
import { AuthRequestCard } from "./auth-request-card";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import {
  useConversation,
  useTranscribe,
  useGeneration,
  useSubmitApproval,
  useSubmitAuthResult,
  useGetAuthUrl,
  useActiveGeneration,
  useCancelGeneration,
  useUpdateAutoApprove,
  type SandboxFileData,
} from "@/orpc/hooks";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { MessageSquare, AlertCircle, Activity, CircleCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useHotkeys } from "react-hotkeys-hook";
import type { IntegrationType } from "@/lib/integration-icons";
import {
  createGenerationRuntime,
  type GenerationRuntime,
  type RuntimeActivitySegment,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";

type TraceStatus = RuntimeSnapshot["traceStatus"];
type ActivitySegment = Omit<RuntimeActivitySegment, "items"> & { items: ActivityItemData[] };

type Props = {
  conversationId?: string;
};

export function ChatArea({ conversationId }: Props) {
  const queryClient = useQueryClient();
  const { data: existingConversation, isLoading } = useConversation(
    conversationId
  );
  const { startGeneration, subscribeToGeneration, abort } = useGeneration();
  const { mutateAsync: submitApproval, isPending: isApproving } = useSubmitApproval();
  const { mutateAsync: submitAuthResult, isPending: isSubmittingAuth } = useSubmitAuthResult();
  const { mutateAsync: getAuthUrl } = useGetAuthUrl();
  const { mutateAsync: cancelGeneration } = useCancelGeneration();
  const { data: activeGeneration } = useActiveGeneration(conversationId);

  // Track current generation ID
  const currentGenerationIdRef = useRef<string | undefined>(undefined);
  const runtimeRef = useRef<GenerationRuntime | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [localAutoApprove, setLocalAutoApprove] = useState(false);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-20250514");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  // Segmented activity feed state
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [integrationsUsed, setIntegrationsUsed] = useState<Set<IntegrationType>>(new Set());
  const [traceStatus, setTraceStatus] = useState<TraceStatus>("complete");

  // Sandbox files collected during streaming
  const [streamingSandboxFiles, setStreamingSandboxFiles] = useState<SandboxFileData[]>([]);

  // Current conversation ID (may be set during streaming for new conversations)
  const currentConversationIdRef = useRef<string | undefined>(conversationId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userScrolledUpRef = useRef(false);

  const syncFromRuntime = useCallback((runtime: GenerationRuntime) => {
    const snapshot = runtime.snapshot;
    setStreamingParts(snapshot.parts as MessagePart[]);
    setSegments(
      snapshot.segments.map((seg) => ({
        ...seg,
        items: seg.items.map((item) => ({
          ...item,
          integration: item.integration as IntegrationType | undefined,
        })),
      }))
    );
    setIntegrationsUsed(new Set(snapshot.integrationsUsed as IntegrationType[]));
    setStreamingSandboxFiles(snapshot.sandboxFiles as SandboxFileData[]);
    setTraceStatus(snapshot.traceStatus);
  }, []);

  // Auto-approve mutation
  const { mutateAsync: updateAutoApprove } = useUpdateAutoApprove();

  // Voice recording
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  // Load existing messages
  useEffect(() => {
    // Don't load messages for new chat - let the reset effect handle clearing
    if (!conversationId) {
      return;
    }

    const conv = existingConversation as {
      model?: string;
      messages?: Array<{
        id: string;
        role: string;
        content: string;
        contentParts?: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; integration?: string; operation?: string }
          | { type: "tool_result"; tool_use_id: string; content: unknown }
          | { type: "thinking"; id: string; content: string }
        >;
      }>;
    } | null | undefined;

    // Sync model from existing conversation
    if (conv?.model) {
      setSelectedModel(conv.model);
    }

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
                    integration: p.integration,
                    operation: p.operation,
                  };
                }
              });
          }
          // Map persisted attachments
          let attachments: AttachmentData[] | undefined;
          const mAny = m as Record<string, unknown>;
          if (Array.isArray(mAny.attachments) && (mAny.attachments as unknown[]).length > 0) {
            attachments = (mAny.attachments as Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>).map((a) => ({
              id: a.id,
              name: a.filename,
              mimeType: a.mimeType,
              dataUrl: "", // No data URL for persisted attachments
            }));
          }

          // Map persisted sandbox files
          let sandboxFiles: SandboxFileData[] | undefined;
          if (Array.isArray(mAny.sandboxFiles) && (mAny.sandboxFiles as unknown[]).length > 0) {
            sandboxFiles = (mAny.sandboxFiles as Array<{ fileId: string; path: string; filename: string; mimeType: string; sizeBytes: number | null }>).map((f) => ({
              fileId: f.fileId,
              path: f.path,
              filename: f.filename,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
            }));
          }

          return {
            id: m.id,
            role: m.role as Message["role"],
            content: m.content,
            parts,
            attachments,
            sandboxFiles,
          };
        })
      );
    }
  }, [existingConversation, conversationId]);

  // Reset when conversation changes
  useEffect(() => {
    // Always sync the ref with the prop
    currentConversationIdRef.current = conversationId;

    if (!conversationId) {
      runtimeRef.current = null;
      setMessages([]);
      setStreamingParts([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("complete");
      setIsStreaming(false);
      setStreamError(null);
      setStreamingSandboxFiles([]);
      currentGenerationIdRef.current = undefined;
    }
  }, [conversationId]);

  // Listen for "new-chat" event to reset state when user clicks New Chat
  useEffect(() => {
    const handleNewChat = () => {
      abort();
      runtimeRef.current = null;
      setMessages([]);
      setStreamingParts([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("complete");
      setIsStreaming(false);
      setStreamError(null);
      setStreamingSandboxFiles([]);
      currentGenerationIdRef.current = undefined;
      currentConversationIdRef.current = undefined;
    };
    window.addEventListener("new-chat", handleNewChat);
    return () => window.removeEventListener("new-chat", handleNewChat);
  }, [abort]);

  // Reconnect to active generation on mount
  useEffect(() => {
    if (
      activeGeneration?.generationId &&
      (activeGeneration.status === "generating" || activeGeneration.status === "awaiting_approval" || activeGeneration.status === "awaiting_auth")
    ) {
      // There's an active generation - reconnect to it
      currentGenerationIdRef.current = activeGeneration.generationId;
      setIsStreaming(true);
      setTraceStatus(
        activeGeneration.status === "awaiting_approval" ? "waiting_approval" :
        activeGeneration.status === "awaiting_auth" ? "waiting_auth" : "streaming"
      );

      const runtime = createGenerationRuntime();
      runtimeRef.current = runtime;
      runtime.setStatus(
        activeGeneration.status === "awaiting_approval"
          ? "waiting_approval"
          : activeGeneration.status === "awaiting_auth"
            ? "waiting_auth"
            : "streaming"
      );
      syncFromRuntime(runtime);

      subscribeToGeneration(activeGeneration.generationId, {
        onText: (text) => {
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onThinking: (data) => {
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result) => {
          runtime.handleToolResult(toolName, result);
          syncFromRuntime(runtime);
        },
        onPendingApproval: (data) => {
          console.log("[ApprovalCard] Showing approval card", { toolUseId: data.toolUseId, toolName: data.toolName, integration: data.integration, operation: data.operation, command: data.command });
          currentGenerationIdRef.current = data.generationId;
          runtime.handlePendingApproval(data);
          syncFromRuntime(runtime);
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            currentConversationIdRef.current = data.conversationId;
          }
          runtime.handleAuthNeeded(data);
          syncFromRuntime(runtime);
        },
        onAuthProgress: (connected, remaining) => {
          runtime.handleAuthProgress(connected, remaining);
          syncFromRuntime(runtime);
        },
        onAuthResult: (success) => {
          runtime.handleAuthResult(success);
          syncFromRuntime(runtime);
        },
        onSandboxFile: (file) => {
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onDone: (generationId, newConversationId, messageId, usage) => {
          runtime.handleDone({ generationId, conversationId: newConversationId, messageId });
          const assistant = runtime.buildAssistantMessage();

          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: assistant.content,
              parts: assistant.parts as MessagePart[],
              integrationsUsed: assistant.integrationsUsed,
              sandboxFiles: assistant.sandboxFiles,
            } as Message & { integrationsUsed?: IntegrationType[]; sandboxFiles?: SandboxFileData[] },
          ]);
          setStreamingParts([]);
          setStreamingSandboxFiles([]);
          setIsStreaming(false);
          setSegments([]);
          setTraceStatus("complete");
          setStreamError(null);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
        },
        onError: (message) => {
          runtime.handleError();
          syncFromRuntime(runtime);
          console.error("Generation error:", message);
          setIsStreaming(false);
          setStreamError(message || "Streaming failed. Please retry.");
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
        },
        onCancelled: () => {
          runtime.handleCancelled();
          syncFromRuntime(runtime);
          setIsStreaming(false);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
        },
      });
    }
  }, [activeGeneration?.generationId, activeGeneration?.status, subscribeToGeneration, syncFromRuntime]);

  // Track if user is near bottom of scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 100; // pixels from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;

    // If user scrolls back to bottom, reset the scrolled-up flag
    if (isNearBottomRef.current) {
      userScrolledUpRef.current = false;
    }
  }, []);

  // Detect user-initiated scroll up via wheel/touch
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleUserScroll = () => {
      // Check after a tick so the scroll position has updated
      requestAnimationFrame(() => {
        if (!isNearBottomRef.current) {
          userScrolledUpRef.current = true;
        }
      });
    };

    container.addEventListener("wheel", handleUserScroll, { passive: true });
    container.addEventListener("touchmove", handleUserScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleUserScroll);
      container.removeEventListener("touchmove", handleUserScroll);
    };
  }, []);

  // Auto-scroll only if user hasn't scrolled up
  useEffect(() => {
    if (isNearBottomRef.current && !userScrolledUpRef.current) {
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

    // Update segments: mark running items as interrupted, add system message
    setSegments((prevSegments) => {
      if (prevSegments.length === 0) return prevSegments;

      return prevSegments.map((segment, index) => {
        // Mark any running items as interrupted
        const updatedItems = segment.items.map((item) =>
          item.status === "running" ? { ...item, status: "interrupted" as const } : item
        );

        // Add interruption message to last segment
        if (index === prevSegments.length - 1) {
          updatedItems.push({
            id: `interrupted-${Date.now()}`,
            timestamp: Date.now(),
            type: "system" as const,
            content: "Interrupted by user",
          });
        }

        return { ...segment, items: updatedItems, isExpanded: true };
      });
    });

    setIsStreaming(false);
    setStreamingParts([]);
    setTraceStatus("complete");
    currentGenerationIdRef.current = undefined;
    runtimeRef.current = null;
  }, [abort, cancelGeneration]);

  // Helper to toggle segment expansion
  const toggleSegmentExpand = useCallback((segmentId: string) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId ? { ...seg, isExpanded: !seg.isExpanded } : seg
      )
    );
  }, []);

  const handleSend = useCallback(async (content: string, attachments?: AttachmentData[]) => {
    // Reset scroll lock so auto-scroll works for the new response
    userScrolledUpRef.current = false;
    setStreamError(null);
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      attachments,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);

    // Reset segments for new message
    setSegments([]);
    setIntegrationsUsed(new Set());
    setTraceStatus("streaming");

    const runtime = createGenerationRuntime();
    runtimeRef.current = runtime;
    syncFromRuntime(runtime);

    const effectiveConversationId = currentConversationIdRef.current ?? conversationId;
    const result = await startGeneration(
      { conversationId: effectiveConversationId, content, model: selectedModel, autoApprove: !effectiveConversationId ? localAutoApprove : undefined, deviceId: selectedDeviceId, attachments },
      {
        onStarted: (generationId, newConversationId) => {
          currentGenerationIdRef.current = generationId;
          if (!conversationId && newConversationId) {
            currentConversationIdRef.current = newConversationId;
          }
        },
        onText: (text) => {
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onThinking: (data) => {
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result) => {
          runtime.handleToolResult(toolName, result);
          syncFromRuntime(runtime);
        },
        onPendingApproval: (data) => {
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            currentConversationIdRef.current = data.conversationId;
          }
          runtime.handlePendingApproval(data);
          syncFromRuntime(runtime);
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            currentConversationIdRef.current = data.conversationId;
          }
          runtime.handleAuthNeeded(data);
          syncFromRuntime(runtime);
        },
        onAuthProgress: (connected, remaining) => {
          runtime.handleAuthProgress(connected, remaining);
          syncFromRuntime(runtime);
        },
        onAuthResult: (success) => {
          runtime.handleAuthResult(success);
          syncFromRuntime(runtime);
        },
        onSandboxFile: (file) => {
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onDone: (generationId, newConversationId, messageId) => {
          runtime.handleDone({ generationId, conversationId: newConversationId, messageId });
          const assistant = runtime.buildAssistantMessage();

          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: assistant.content,
              parts: assistant.parts as MessagePart[],
              integrationsUsed: assistant.integrationsUsed,
              sandboxFiles: assistant.sandboxFiles as SandboxFileData[] | undefined,
            } as Message & { integrationsUsed?: IntegrationType[]; sandboxFiles?: SandboxFileData[] },
          ]);
          setStreamingParts([]);
          setStreamingSandboxFiles([]);
          setIsStreaming(false);
          setSegments([]); // Clear segments when done
          setTraceStatus("complete");
          setStreamError(null);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;

          // Invalidate conversation queries to refresh sidebar
          queryClient.invalidateQueries({ queryKey: ["conversation"] });

          // Update URL for new conversations without remounting
          if (!conversationId && newConversationId) {
            window.history.replaceState(null, "", `/chat/${newConversationId}`);
          }
        },
        onError: (message) => {
          runtime.handleError();
          syncFromRuntime(runtime);
          console.error("Generation error:", message);
          setIsStreaming(false);
          setStreamError(message || "Streaming failed. Please retry.");
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
          // Add error message
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: `Error: ${typeof message === 'string' ? message : JSON.stringify(message, null, 2)}`,
            },
          ]);
        },
        onCancelled: () => {
          runtime.handleCancelled();
          syncFromRuntime(runtime);
          setIsStreaming(false);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
        },
      }
    );

  }, [conversationId, startGeneration, queryClient, selectedModel, localAutoApprove, selectedDeviceId, syncFromRuntime]);

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
        if (runtimeRef.current) {
          runtimeRef.current.setApprovalStatus(toolUseId, "approved");
          syncFromRuntime(runtimeRef.current);
        }
      } catch (err) {
        console.error("Failed to approve tool use:", err);
      }
    },
    [submitApproval, syncFromRuntime]
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
        if (runtimeRef.current) {
          runtimeRef.current.setApprovalStatus(toolUseId, "denied");
          syncFromRuntime(runtimeRef.current);
        }
      } catch (err) {
        console.error("Failed to deny tool use:", err);
      }
    },
    [submitApproval, syncFromRuntime]
  );

  // Handle auth connect - redirect to OAuth
  const handleAuthConnect = useCallback(
    async (integration: string) => {
      const genId = currentGenerationIdRef.current;
      const convId = currentConversationIdRef.current;
      if (!genId || !convId) return;

      if (runtimeRef.current) {
        runtimeRef.current.setAuthConnecting();
        syncFromRuntime(runtimeRef.current);
      }

      try {
        // Get auth URL and redirect
        const result = await getAuthUrl({
          type: integration as "gmail" | "google_calendar" | "google_docs" | "google_sheets" | "google_drive" | "notion" | "linear" | "github" | "airtable" | "slack" | "hubspot" | "linkedin",
          redirectUrl: `${window.location.origin}/chat/${convId}?auth_complete=${integration}&generation_id=${genId}`,
        });
        window.location.href = result.authUrl;
      } catch (err) {
        console.error("Failed to get auth URL:", err);
        if (runtimeRef.current) {
          runtimeRef.current.setAuthPending();
          syncFromRuntime(runtimeRef.current);
        }
      }
    },
    [getAuthUrl, syncFromRuntime]
  );

  // Handle auth cancel
  const handleAuthCancel = useCallback(
    async () => {
      const genId = currentGenerationIdRef.current;
      if (!genId) return;

      // Find first pending integration
      const seg = segments.find((s) => s.auth?.status === "pending");
      const integration = seg?.auth?.integrations[0];
      if (!integration) return;

      try {
        await submitAuthResult({
          generationId: genId,
          integration,
          success: false,
        });

        if (runtimeRef.current) {
          runtimeRef.current.setAuthCancelled();
          syncFromRuntime(runtimeRef.current);
        }
      } catch (err) {
        console.error("Failed to cancel auth:", err);
      }
    },
    [submitAuthResult, segments, syncFromRuntime]
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

  // Push-to-talk: Ctrl/Cmd + K - start recording on keydown
  useHotkeys(
    "mod+k",
    handleStartRecording,
    { keydown: true, keyup: false, preventDefault: true, enableOnFormTags: true },
    [handleStartRecording]
  );

  // Push-to-talk: stop recording when any part of the hotkey combo is released
  // On Mac, releasing M while Cmd is held doesn't always fire keyup for M,
  // so we also stop when Meta/Ctrl is released
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return;

      const isHotkeyRelease =
        e.key === "k" ||
        e.key === "K" ||
        e.code === "KeyK" ||
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
    <div className="flex flex-1 flex-col min-h-0">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 min-h-0"
      >
        <div className="mx-auto max-w-3xl">
          {streamError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{streamError}</span>
            </div>
          )}
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

              {(isStreaming || segments.length > 0) && (
                <div className="py-4 space-y-4">
                  {isStreaming && segments.length === 0 && (
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
                            isStreaming={isStreaming && index === segments.length - 1 && !segment.approval && !segment.auth}
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

                        {/* Render auth request card if segment has one */}
                        {segment.auth && (
                          <AuthRequestCard
                            integrations={segment.auth.integrations}
                            connectedIntegrations={segment.auth.connectedIntegrations}
                            reason={segment.auth.reason}
                            status={segment.auth.status}
                            isLoading={isSubmittingAuth}
                            onConnect={handleAuthConnect}
                            onCancel={handleAuthCancel}
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
        <div className="mx-auto max-w-4xl space-y-2">
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                disabled={isStreaming}
              />
              <DeviceSelector
                selectedDeviceId={selectedDeviceId}
                onSelect={setSelectedDeviceId}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="auto-approve"
                checked={
                  conversationId
                    ? (existingConversation as { autoApprove?: boolean } | undefined)?.autoApprove ?? false
                    : localAutoApprove
                }
                onCheckedChange={(checked) => {
                  if (conversationId) {
                    updateAutoApprove({ id: conversationId, autoApprove: checked });
                  } else {
                    setLocalAutoApprove(checked);
                  }
                }}
              />
              <label
                htmlFor="auto-approve"
                className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
              >
                <CircleCheck className="h-3.5 w-3.5" />
                <span>Auto-approve</span>
              </label>
              <VoiceHint />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

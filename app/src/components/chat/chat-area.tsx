"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, AlertCircle, Activity, CircleCheck } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { IntegrationType } from "@/lib/integration-icons";
import { Switch } from "@/components/ui/switch";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import {
  createGenerationRuntime,
  type GenerationRuntime,
  type RuntimeActivitySegment,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { PREFERRED_ZEN_FREE_MODEL } from "@/lib/zen-models";
import { client } from "@/orpc/client";
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
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import { AuthRequestCard } from "./auth-request-card";
import { ChatInput } from "./chat-input";
import { DeviceSelector } from "./device-selector";
import { MessageList, type Message, type MessagePart, type AttachmentData } from "./message-list";
import { ModelSelector } from "./model-selector";
import { ToolApprovalCard } from "./tool-approval-card";
import { VoiceIndicator, VoiceHint } from "./voice-indicator";

type TraceStatus = RuntimeSnapshot["traceStatus"];
type ActivitySegment = Omit<RuntimeActivitySegment, "items"> & {
  items: ActivityItemData[];
};

type Props = {
  conversationId?: string;
};

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";

type PersistedContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentParts?: PersistedContentPart[];
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles?: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
  }>;
};

function mapPersistedMessageToChatMessage(m: PersistedConversationMessage): Message {
  let parts: MessagePart[] | undefined;
  if (m.contentParts && m.contentParts.length > 0) {
    const toolResults = new Map<string, unknown>();
    for (const part of m.contentParts) {
      if (part.type === "tool_result") {
        toolResults.set(part.tool_use_id, part.content);
      }
    }
    parts = m.contentParts
      .filter((p) => p.type !== "tool_result")
      .map((p) => {
        if (p.type === "text") {
          return { type: "text" as const, content: p.text };
        }
        if (p.type === "thinking") {
          return {
            type: "thinking" as const,
            id: p.id,
            content: p.content,
          };
        }
        if (p.type === "system") {
          return { type: "system" as const, content: p.content };
        }
        return {
          type: "tool_call" as const,
          id: p.id,
          name: p.name,
          input: p.input,
          result: toolResults.get(p.id),
          integration: p.integration,
          operation: p.operation,
        };
      });
  }

  const attachments =
    m.attachments && m.attachments.length > 0
      ? m.attachments.map((a) => ({
          id: a.id,
          name: a.filename,
          mimeType: a.mimeType,
          dataUrl: "",
        }))
      : undefined;

  const sandboxFiles =
    m.sandboxFiles && m.sandboxFiles.length > 0
      ? m.sandboxFiles.map((f) => ({
          fileId: f.fileId,
          path: f.path,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        }))
      : undefined;

  return {
    id: m.id,
    role: m.role as Message["role"],
    content: m.content,
    parts,
    attachments,
    sandboxFiles,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAgentInitLabel(status: string | null): string {
  switch (status) {
    case "agent_init_started":
      return "Preparing agent...";
    case "agent_init_sandbox_checking_cache":
      return "Checking sandbox...";
    case "agent_init_sandbox_reused":
      return "Reusing sandbox...";
    case "agent_init_sandbox_creating":
      return "Creating sandbox...";
    case "agent_init_sandbox_created":
      return "Sandbox created...";
    case "agent_init_opencode_starting":
      return "Starting agent server...";
    case "agent_init_opencode_waiting_ready":
      return "Waiting for agent server...";
    case "agent_init_opencode_ready":
      return "Agent server ready...";
    case "agent_init_session_reused":
      return "Reusing agent session...";
    case "agent_init_session_creating":
      return "Creating agent session...";
    case "agent_init_session_created":
      return "Agent session created...";
    case "agent_init_session_replay_started":
      return "Restoring previous context...";
    case "agent_init_session_replay_completed":
      return "Context restored...";
    case "agent_init_session_init_completed":
      return "Finalizing agent...";
    case "agent_init_ready":
      return "Agent ready...";
    case "agent_init_failed":
      return "Agent initialization failed...";
    default:
      return "Creating agent...";
  }
}

export function ChatArea({ conversationId }: Props) {
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const { data: existingConversation, isLoading } = useConversation(conversationId);
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
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  // Segmented activity feed state
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [, setIntegrationsUsed] = useState<Set<IntegrationType>>(new Set());
  const [, setTraceStatus] = useState<TraceStatus>("complete");
  const [agentInitStatus, setAgentInitStatus] = useState<string | null>(null);

  // Sandbox files collected during streaming
  const [, setStreamingSandboxFiles] = useState<SandboxFileData[]>([]);

  // Current conversation ID (may be set during streaming for new conversations)
  const currentConversationIdRef = useRef<string | undefined>(conversationId);
  const autoApproveEnabled = useMemo(() => localAutoApprove, [localAutoApprove]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userScrolledUpRef = useRef(false);
  const initTrackingStartedAtRef = useRef<number | null>(null);
  const initSignalReceivedAtRef = useRef<number | null>(null);
  const initSignalEventTypeRef = useRef<string | null>(null);
  const initTimeoutEventSentRef = useRef(false);
  const initWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInitTracking = useCallback(() => {
    initTrackingStartedAtRef.current = null;
    initSignalReceivedAtRef.current = null;
    initSignalEventTypeRef.current = null;
    initTimeoutEventSentRef.current = false;
    if (initWatchdogTimerRef.current) {
      clearTimeout(initWatchdogTimerRef.current);
      initWatchdogTimerRef.current = null;
    }
    setAgentInitStatus(null);
  }, []);

  const beginInitTracking = useCallback(
    (source: "new_generation" | "reconnect") => {
      const startedAt = Date.now();
      resetInitTracking();
      initTrackingStartedAtRef.current = startedAt;
      setAgentInitStatus("agent_init_started");
      console.info(
        `[AgentInit][Client] started source=${source} conversationId=${currentConversationIdRef.current ?? "new"}`,
      );
      posthog?.capture("agent_creation_started", {
        source,
        startedAtMs: startedAt,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: selectedModel,
      });

      initWatchdogTimerRef.current = setTimeout(() => {
        if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
          return;
        }
        initTimeoutEventSentRef.current = true;
        const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
        console.warn(
          `[AgentInit][Client] timeout_no_init elapsedMs=${elapsedMs} conversationId=${currentConversationIdRef.current ?? "new"} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
        );
        posthog?.capture("agent_init_timeout", {
          elapsedMs,
          conversationId: currentConversationIdRef.current ?? null,
          generationId: currentGenerationIdRef.current ?? null,
          model: selectedModel,
        });
      }, 20_000);
    },
    [posthog, resetInitTracking, selectedModel],
  );

  const markInitSignal = useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }
      const now = Date.now();
      const elapsedMs = now - initTrackingStartedAtRef.current;
      initSignalReceivedAtRef.current = now;
      initSignalEventTypeRef.current = eventType;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      console.info(
        `[AgentInit][Client] init_signal_received event=${eventType} elapsedMs=${elapsedMs} conversationId=${currentConversationIdRef.current ?? "new"} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      posthog?.capture("agent_init_signal_received", {
        eventType,
        elapsedMs,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: selectedModel,
        ...metadata,
      });
    },
    [posthog, selectedModel],
  );

  const markInitMissingAtEnd = useCallback(
    (endReason: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }

      const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      console.error(
        `[AgentInit][Client] missing_init endReason=${endReason} elapsedMs=${elapsedMs} conversationId=${currentConversationIdRef.current ?? "new"} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      posthog?.capture("agent_init_missing", {
        endReason,
        elapsedMs,
        didTimeout: initTimeoutEventSentRef.current,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: selectedModel,
        ...metadata,
      });
    },
    [posthog, selectedModel],
  );

  const handleInitStatusChange = useCallback(
    (status: string) => {
      console.info(
        `[AgentInit][Client] status_change status=${status} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      if (!status.startsWith("agent_init_")) {
        return;
      }

      setAgentInitStatus(status);
      posthog?.capture("agent_init_status", {
        status,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: selectedModel,
      });

      if (status === "agent_init_ready") {
        markInitSignal("agent_init_ready");
      } else if (status === "agent_init_failed") {
        markInitMissingAtEnd("agent_init_failed");
      }
    },
    [markInitMissingAtEnd, markInitSignal, posthog, selectedModel],
  );

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
      })),
    );
    setIntegrationsUsed(new Set(snapshot.integrationsUsed as IntegrationType[]));
    setStreamingSandboxFiles(snapshot.sandboxFiles as SandboxFileData[]);
    setTraceStatus(snapshot.traceStatus);
  }, []);

  const upsertMessageById = useCallback((nextMessage: Message) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((message) => message.id === nextMessage.id);
      if (existingIndex === -1) {
        return [...prev, nextMessage];
      }
      const updated = [...prev];
      updated[existingIndex] = nextMessage;
      return updated;
    });
  }, []);

  const hydrateAssistantMessage = useCallback(
    async (newConversationId: string, messageId: string, fallback: Message): Promise<Message> => {
      const maxAttempts = 6;
      const retryDelayMs = 300;
      const fallbackHasFiles =
        (fallback.attachments?.length ?? 0) > 0 || (fallback.sandboxFiles?.length ?? 0) > 0;

      const attemptHydration = async (attempt: number): Promise<Message> => {
        try {
          const conversation = await client.conversation.get({ id: newConversationId });
          queryClient.setQueryData(["conversation", "get", newConversationId], conversation);

          const persisted = conversation.messages.find((m) => m.id === messageId);
          if (persisted) {
            const mapped = mapPersistedMessageToChatMessage(
              persisted as PersistedConversationMessage,
            );
            const mappedHasFiles =
              (mapped.attachments?.length ?? 0) > 0 || (mapped.sandboxFiles?.length ?? 0) > 0;

            if (mappedHasFiles || fallbackHasFiles || attempt === maxAttempts - 1) {
              return mapped;
            }
          }
        } catch (error) {
          if (attempt === maxAttempts - 1) {
            console.error("Failed to hydrate assistant message after completion:", error);
          }
        }

        if (attempt < maxAttempts - 1) {
          await sleep(retryDelayMs);
          return attemptHydration(attempt + 1);
        }
        return fallback;
      };

      return attemptHydration(0);
    },
    [queryClient],
  );

  const notifyConversationIdSync = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent(CHAT_CONVERSATION_ID_SYNC_EVENT, {
        detail: { conversationId: id },
      }),
    );
  }, []);

  const persistInterruptedRuntimeMessage = useCallback(
    (runtime: GenerationRuntime, messageId?: string) => {
      runtime.handleCancelled();
      const assistant = runtime.buildAssistantMessage();
      setMessages((prev) => [
        ...prev,
        {
          id: messageId ?? `cancelled-${Date.now()}`,
          role: "assistant",
          content: assistant.content || "Interrupted by user",
          parts: assistant.parts as MessagePart[],
          integrationsUsed: assistant.integrationsUsed,
          sandboxFiles: assistant.sandboxFiles as SandboxFileData[] | undefined,
        } as Message & {
          integrationsUsed?: IntegrationType[];
          sandboxFiles?: SandboxFileData[];
        },
      ]);
    },
    [],
  );

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

    const conv = existingConversation as
      | {
          model?: string;
          autoApprove?: boolean;
          messages?: PersistedConversationMessage[];
        }
      | null
      | undefined;

    // Sync model from existing conversation
    if (conv?.model) {
      setSelectedModel(conv.model);
    }
    if (typeof conv?.autoApprove === "boolean") {
      setLocalAutoApprove(conv.autoApprove);
    }

    if (conv?.messages) {
      setMessages(conv.messages.map((m) => mapPersistedMessageToChatMessage(m)));
    }
  }, [existingConversation, conversationId]);

  useEffect(() => () => resetInitTracking(), [resetInitTracking]);

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
      setSelectedModel(PREFERRED_ZEN_FREE_MODEL);
      currentGenerationIdRef.current = undefined;
      resetInitTracking();
    }
  }, [conversationId, resetInitTracking]);

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
      setSelectedModel(PREFERRED_ZEN_FREE_MODEL);
      currentGenerationIdRef.current = undefined;
      currentConversationIdRef.current = undefined;
      resetInitTracking();
    };
    window.addEventListener("new-chat", handleNewChat);
    return () => window.removeEventListener("new-chat", handleNewChat);
  }, [abort, resetInitTracking]);

  // Reconnect to active generation on mount
  useEffect(() => {
    if (
      activeGeneration?.generationId &&
      (activeGeneration.status === "generating" ||
        activeGeneration.status === "awaiting_approval" ||
        activeGeneration.status === "awaiting_auth")
    ) {
      if (runtimeRef.current && currentGenerationIdRef.current === activeGeneration.generationId) {
        return;
      }

      // There's an active generation - reconnect to it
      currentGenerationIdRef.current = activeGeneration.generationId;
      setIsStreaming(true);
      beginInitTracking("reconnect");
      setTraceStatus(
        activeGeneration.status === "awaiting_approval"
          ? "waiting_approval"
          : activeGeneration.status === "awaiting_auth"
            ? "waiting_auth"
            : "streaming",
      );

      const runtime = createGenerationRuntime();
      runtimeRef.current = runtime;
      runtime.setStatus(
        activeGeneration.status === "awaiting_approval"
          ? "waiting_approval"
          : activeGeneration.status === "awaiting_auth"
            ? "waiting_auth"
            : "streaming",
      );
      syncFromRuntime(runtime);

      subscribeToGeneration(activeGeneration.generationId, {
        onText: (text) => {
          markInitSignal("text");
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onThinking: (data) => {
          markInitSignal("thinking");
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          markInitSignal("tool_use", { toolName: data.toolName });
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result, toolUseId) => {
          markInitSignal("tool_result", { toolName });
          runtime.handleToolResult(toolName, result, toolUseId);
          syncFromRuntime(runtime);
        },
        onPendingApproval: async (data) => {
          markInitSignal("pending_approval", { toolName: data.toolName });
          console.log("[ApprovalCard] Showing approval card", {
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            integration: data.integration,
            operation: data.operation,
            command: data.command,
          });
          currentGenerationIdRef.current = data.generationId;
          runtime.handlePendingApproval(data);
          syncFromRuntime(runtime);
          if (autoApproveEnabled) {
            try {
              await submitApproval({
                generationId: data.generationId,
                toolUseId: data.toolUseId,
                decision: "approve",
              });
            } catch (err) {
              console.error("Failed to auto-approve tool use:", err);
            }
          }
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          markInitSignal("auth_needed", { integrations: data.integrations });
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
          markInitSignal("sandbox_file", { filename: file.filename });
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onStatusChange: (status) => {
          handleInitStatusChange(status);
        },
        onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
          markInitSignal("done");
          runtime.handleDone({
            generationId,
            conversationId: newConversationId,
            messageId,
          });
          const assistant = runtime.buildAssistantMessage();
          const fallbackAssistant: Message = {
            id: messageId,
            role: "assistant",
            content: assistant.content,
            parts: assistant.parts as MessagePart[],
            integrationsUsed: assistant.integrationsUsed,
            attachments: artifacts?.attachments?.map((attachment) => ({
              id: attachment.id,
              name: attachment.filename,
              mimeType: attachment.mimeType,
              dataUrl: "",
            })),
            sandboxFiles:
              artifacts?.sandboxFiles ?? (assistant.sandboxFiles as SandboxFileData[] | undefined),
          };
          const hydratedAssistant = await hydrateAssistantMessage(
            newConversationId,
            messageId,
            fallbackAssistant,
          );

          upsertMessageById(hydratedAssistant);
          setStreamingParts([]);
          setStreamingSandboxFiles([]);
          setIsStreaming(false);
          setSegments([]);
          setTraceStatus("complete");
          setStreamError(null);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
          resetInitTracking();
        },
        onError: (message) => {
          runtime.handleError();
          syncFromRuntime(runtime);
          console.error("Generation error:", message);
          markInitMissingAtEnd("error", { message });
          setIsStreaming(false);
          setStreamError(message || "Streaming failed. Please retry.");
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
          resetInitTracking();
        },
        onCancelled: (data) => {
          if (runtimeRef.current === runtime) {
            persistInterruptedRuntimeMessage(runtime, data.messageId);
          }
          markInitMissingAtEnd("cancelled");
          setIsStreaming(false);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
          resetInitTracking();
        },
      });
    }
  }, [
    activeGeneration?.generationId,
    activeGeneration?.status,
    autoApproveEnabled,
    beginInitTracking,
    handleInitStatusChange,
    markInitMissingAtEnd,
    markInitSignal,
    persistInterruptedRuntimeMessage,
    resetInitTracking,
    submitApproval,
    subscribeToGeneration,
    syncFromRuntime,
    hydrateAssistantMessage,
    upsertMessageById,
  ]);

  // Track if user is near bottom of scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const threshold = 100; // pixels from bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;

    // If user scrolls back to bottom, reset the scrolled-up flag
    if (isNearBottomRef.current) {
      userScrolledUpRef.current = false;
    }
  }, []);

  // Detect user-initiated scroll up via wheel/touch
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleUserScroll = () => {
      // Check after a tick so the scroll position has updated
      requestAnimationFrame(() => {
        if (!isNearBottomRef.current) {
          userScrolledUpRef.current = true;
        }
      });
    };

    container.addEventListener("wheel", handleUserScroll, { passive: true });
    container.addEventListener("touchmove", handleUserScroll, {
      passive: true,
    });
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
    const runtime = runtimeRef.current;
    const generationId = currentGenerationIdRef.current;
    if (runtime) {
      persistInterruptedRuntimeMessage(runtime);
    }
    runtimeRef.current = null;
    currentGenerationIdRef.current = undefined;

    abort();
    // Cancel the generation on the backend too
    if (generationId) {
      try {
        await cancelGeneration(generationId);
      } catch (err) {
        console.error("Failed to cancel generation:", err);
      }
    }

    setIsStreaming(false);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setSegments([]);
    setTraceStatus("complete");
    markInitMissingAtEnd("user_stopped");
    resetInitTracking();
  }, [
    abort,
    cancelGeneration,
    markInitMissingAtEnd,
    persistInterruptedRuntimeMessage,
    resetInitTracking,
  ]);

  // Helper to toggle segment expansion
  const toggleSegmentExpand = useCallback((segmentId: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? { ...seg, isExpanded: !seg.isExpanded } : seg)),
    );
  }, []);
  const segmentToggleHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of segments) {
      handlers.set(segment.id, () => {
        toggleSegmentExpand(segment.id);
      });
    }
    return handlers;
  }, [segments, toggleSegmentExpand]);

  const handleSend = useCallback(
    async (content: string, attachments?: AttachmentData[]) => {
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
      beginInitTracking("new_generation");

      const runtime = createGenerationRuntime();
      runtimeRef.current = runtime;
      syncFromRuntime(runtime);

      const effectiveConversationId = currentConversationIdRef.current ?? conversationId;
      await startGeneration(
        {
          conversationId: effectiveConversationId,
          content,
          model: selectedModel,
          autoApprove: autoApproveEnabled,
          deviceId: selectedDeviceId,
          attachments,
        },
        {
          onStarted: (generationId, newConversationId) => {
            currentGenerationIdRef.current = generationId;
            console.info(
              `[AgentInit][Client] generation_started generationId=${generationId} conversationId=${newConversationId}`,
            );
            if (!conversationId && newConversationId) {
              currentConversationIdRef.current = newConversationId;
              notifyConversationIdSync(newConversationId);
            }
          },
          onText: (text) => {
            markInitSignal("text");
            runtime.handleText(text);
            syncFromRuntime(runtime);
          },
          onThinking: (data) => {
            markInitSignal("thinking");
            runtime.handleThinking(data);
            syncFromRuntime(runtime);
          },
          onToolUse: (data) => {
            markInitSignal("tool_use", { toolName: data.toolName });
            runtime.handleToolUse(data);
            syncFromRuntime(runtime);
          },
          onToolResult: (toolName, result, toolUseId) => {
            markInitSignal("tool_result", { toolName });
            runtime.handleToolResult(toolName, result, toolUseId);
            syncFromRuntime(runtime);
          },
          onPendingApproval: async (data) => {
            markInitSignal("pending_approval", { toolName: data.toolName });
            currentGenerationIdRef.current = data.generationId;
            if (data.conversationId) {
              currentConversationIdRef.current = data.conversationId;
              notifyConversationIdSync(data.conversationId);
            }
            runtime.handlePendingApproval(data);
            syncFromRuntime(runtime);
            if (autoApproveEnabled) {
              try {
                await submitApproval({
                  generationId: data.generationId,
                  toolUseId: data.toolUseId,
                  decision: "approve",
                });
              } catch (err) {
                console.error("Failed to auto-approve tool use:", err);
              }
            }
          },
          onApprovalResult: (toolUseId, decision) => {
            runtime.handleApprovalResult(toolUseId, decision);
            syncFromRuntime(runtime);
          },
          onAuthNeeded: (data) => {
            markInitSignal("auth_needed", { integrations: data.integrations });
            currentGenerationIdRef.current = data.generationId;
            if (data.conversationId) {
              currentConversationIdRef.current = data.conversationId;
              notifyConversationIdSync(data.conversationId);
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
            markInitSignal("sandbox_file", { filename: file.filename });
            runtime.handleSandboxFile(file);
            syncFromRuntime(runtime);
          },
          onStatusChange: (status) => {
            handleInitStatusChange(status);
          },
          onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
            markInitSignal("done");
            runtime.handleDone({
              generationId,
              conversationId: newConversationId,
              messageId,
            });
            const assistant = runtime.buildAssistantMessage();
            const fallbackAssistant: Message = {
              id: messageId,
              role: "assistant",
              content: assistant.content,
              parts: assistant.parts as MessagePart[],
              integrationsUsed: assistant.integrationsUsed,
              attachments: artifacts?.attachments?.map((attachment) => ({
                id: attachment.id,
                name: attachment.filename,
                mimeType: attachment.mimeType,
                dataUrl: "",
              })),
              sandboxFiles:
                artifacts?.sandboxFiles ??
                (assistant.sandboxFiles as SandboxFileData[] | undefined),
            };
            const hydratedAssistant = await hydrateAssistantMessage(
              newConversationId,
              messageId,
              fallbackAssistant,
            );

            upsertMessageById(hydratedAssistant);
            setStreamingParts([]);
            setStreamingSandboxFiles([]);
            setIsStreaming(false);
            setSegments([]); // Clear segments when done
            setTraceStatus("complete");
            setStreamError(null);
            currentGenerationIdRef.current = undefined;
            runtimeRef.current = null;
            resetInitTracking();

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
            markInitMissingAtEnd("error", { message });
            setIsStreaming(false);
            setStreamError(message || "Streaming failed. Please retry.");
            currentGenerationIdRef.current = undefined;
            runtimeRef.current = null;
            resetInitTracking();
            // Add error message
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: "assistant",
                content: `Error: ${typeof message === "string" ? message : JSON.stringify(message, null, 2)}`,
              },
            ]);
          },
          onCancelled: (data) => {
            if (runtimeRef.current === runtime) {
              persistInterruptedRuntimeMessage(runtime, data.messageId);
            }
            markInitMissingAtEnd("cancelled");
            setIsStreaming(false);
            currentGenerationIdRef.current = undefined;
            runtimeRef.current = null;
            resetInitTracking();
          },
        },
      );
    },
    [
      beginInitTracking,
      autoApproveEnabled,
      conversationId,
      handleInitStatusChange,
      markInitMissingAtEnd,
      markInitSignal,
      persistInterruptedRuntimeMessage,
      queryClient,
      resetInitTracking,
      selectedDeviceId,
      selectedModel,
      startGeneration,
      submitApproval,
      syncFromRuntime,
      notifyConversationIdSync,
      hydrateAssistantMessage,
      upsertMessageById,
    ],
  );

  // Handle approval/denial of tool use
  const handleApprove = useCallback(
    async (toolUseId: string, questionAnswers?: string[][]) => {
      const genId = currentGenerationIdRef.current;
      if (!genId) {
        return;
      }

      try {
        await submitApproval({
          generationId: genId,
          toolUseId,
          decision: "approve",
          questionAnswers,
        });
        if (runtimeRef.current) {
          runtimeRef.current.setApprovalStatus(toolUseId, "approved");
          syncFromRuntime(runtimeRef.current);
        }
      } catch (err) {
        console.error("Failed to approve tool use:", err);
      }
    },
    [submitApproval, syncFromRuntime],
  );

  const handleDeny = useCallback(
    async (toolUseId: string) => {
      const genId = currentGenerationIdRef.current;
      if (!genId) {
        return;
      }

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
    [submitApproval, syncFromRuntime],
  );

  // Handle auth connect - redirect to OAuth
  const handleAuthConnect = useCallback(
    async (integration: string) => {
      const genId = currentGenerationIdRef.current;
      const convId = currentConversationIdRef.current;
      if (!genId || !convId) {
        return;
      }

      if (runtimeRef.current) {
        runtimeRef.current.setAuthConnecting();
        syncFromRuntime(runtimeRef.current);
      }

      try {
        // Get auth URL and redirect
        const result = await getAuthUrl({
          type: integration as
            | "gmail"
            | "google_calendar"
            | "google_docs"
            | "google_sheets"
            | "google_drive"
            | "notion"
            | "linear"
            | "github"
            | "airtable"
            | "slack"
            | "hubspot"
            | "linkedin",
          redirectUrl: `${window.location.origin}/chat/${convId}?auth_complete=${integration}&generation_id=${genId}`,
        });
        window.location.href = result.authUrl;
      } catch (err) {
        console.error("Failed to get auth URL:", err);
        setStreamError(
          isUnipileMissingCredentialsError(err)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : "Failed to start integration connection. Please try again.",
        );
        if (runtimeRef.current) {
          runtimeRef.current.setAuthPending();
          syncFromRuntime(runtimeRef.current);
        }
      }
    },
    [getAuthUrl, syncFromRuntime],
  );

  // Handle auth cancel
  const handleAuthCancel = useCallback(async () => {
    const genId = currentGenerationIdRef.current;
    if (!genId) {
      return;
    }

    // Find first pending integration
    const seg = segments.find((s) => s.auth?.status === "pending");
    const integration = seg?.auth?.integrations[0];
    if (!integration) {
      return;
    }

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
  }, [submitAuthResult, segments, syncFromRuntime]);
  const segmentApproveHandlers = useMemo(() => {
    const handlers = new Map<string, (questionAnswers?: string[][]) => void>();
    for (const segment of segments) {
      const toolUseId = segment.approval?.toolUseId;
      if (!toolUseId) {
        continue;
      }
      handlers.set(segment.id, (questionAnswers?: string[][]) => {
        void handleApprove(toolUseId, questionAnswers);
      });
    }
    return handlers;
  }, [handleApprove, segments]);
  const segmentDenyHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of segments) {
      const toolUseId = segment.approval?.toolUseId;
      if (!toolUseId) {
        continue;
      }
      handlers.set(segment.id, () => {
        void handleDeny(toolUseId);
      });
    }
    return handlers;
  }, [handleDeny, segments]);
  const handleAutoApproveChange = useCallback(
    (checked: boolean) => {
      setLocalAutoApprove(checked);
      if (conversationId) {
        updateAutoApprove({
          id: conversationId,
          autoApprove: checked,
        });
      }
    },
    [conversationId, updateAutoApprove],
  );

  // Voice recording: stop and transcribe
  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

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
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: true,
    },
    [handleStartRecording],
  );

  // Push-to-talk: stop recording when any part of the hotkey combo is released
  // On Mac, releasing M while Cmd is held doesn't always fire keyup for M,
  // so we also stop when Meta/Ctrl is released
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) {
        return;
      }

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <div className="mx-auto max-w-3xl">
          {streamError && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{streamError}</span>
            </div>
          )}
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
              <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
                <MessageSquare className="text-muted-foreground h-8 w-8" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">How can I help you?</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Ask me anything or use your connected integrations
                </p>
              </div>
            </div>
          ) : (
            <>
              <MessageList messages={messages} />

              {(isStreaming || segments.length > 0) && (
                <div className="space-y-4 py-4">
                  {isStreaming && segments.length === 0 && (
                    <div className="border-border/50 bg-muted/30 rounded-lg border">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <Activity className="text-muted-foreground h-4 w-4" />
                        <span className="text-muted-foreground text-sm">
                          {getAgentInitLabel(agentInitStatus)}
                        </span>
                        <div className="ml-auto flex gap-1">
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                          <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full" />
                        </div>
                      </div>
                    </div>
                  )}
                  {(() => {
                    const renderedSegments = [];

                    for (let index = 0; index < segments.length; index += 1) {
                      const segment = segments[index];
                      const nextSegment = segments[index + 1];
                      const deferredApproval = segment.approval;
                      const shouldDeferApprovalAfterNextActivity =
                        !!deferredApproval &&
                        segment.items.length === 0 &&
                        !!nextSegment &&
                        nextSegment.items.length > 0 &&
                        !nextSegment.approval &&
                        !nextSegment.auth;

                      if (shouldDeferApprovalAfterNextActivity && nextSegment && deferredApproval) {
                        const nextSegmentIntegrations = Array.from(
                          new Set(
                            nextSegment.items
                              .filter((item) => item.integration)
                              .map((item) => item.integration as IntegrationType),
                          ),
                        );

                        renderedSegments.push(
                          <div key={`${segment.id}-${nextSegment.id}`} className="space-y-4">
                            <ActivityFeed
                              items={nextSegment.items}
                              isStreaming={isStreaming && index + 1 === segments.length - 1}
                              isExpanded={nextSegment.isExpanded}
                              onToggleExpand={segmentToggleHandlers.get(nextSegment.id)!}
                              integrationsUsed={nextSegmentIntegrations}
                            />
                            <ToolApprovalCard
                              toolUseId={deferredApproval.toolUseId}
                              toolName={deferredApproval.toolName}
                              toolInput={deferredApproval.toolInput}
                              integration={deferredApproval.integration}
                              operation={deferredApproval.operation}
                              command={deferredApproval.command}
                              status={deferredApproval.status}
                              isLoading={isApproving}
                              onApprove={segmentApproveHandlers.get(segment.id)!}
                              onDeny={segmentDenyHandlers.get(segment.id)!}
                            />
                          </div>,
                        );
                        index += 1;
                        continue;
                      }

                      const segmentIntegrations = Array.from(
                        new Set(
                          segment.items
                            .filter((item) => item.integration)
                            .map((item) => item.integration as IntegrationType),
                        ),
                      );

                      renderedSegments.push(
                        <div key={segment.id} className="space-y-4">
                          {segment.items.length > 0 && (
                            <ActivityFeed
                              items={segment.items}
                              isStreaming={
                                isStreaming &&
                                index === segments.length - 1 &&
                                !segment.approval &&
                                !segment.auth
                              }
                              isExpanded={segment.isExpanded}
                              onToggleExpand={segmentToggleHandlers.get(segment.id)!}
                              integrationsUsed={segmentIntegrations}
                            />
                          )}

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
                              onApprove={segmentApproveHandlers.get(segment.id)!}
                              onDeny={segmentDenyHandlers.get(segment.id)!}
                            />
                          )}

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
                        </div>,
                      );
                    }

                    return renderedSegments;
                  })()}
                </div>
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="bg-background border-t p-4">
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
              <DeviceSelector selectedDeviceId={selectedDeviceId} onSelect={setSelectedDeviceId} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="auto-approve"
                checked={autoApproveEnabled}
                onCheckedChange={handleAutoApproveChange}
              />
              <label
                htmlFor="auto-approve"
                className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none"
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

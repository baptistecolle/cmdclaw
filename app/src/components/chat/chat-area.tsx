"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  AlertCircle,
  Activity,
  Check,
  CircleCheck,
  Ellipsis,
  ListTree,
  PenLine,
  Search,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { IntegrationType } from "@/lib/integration-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { isModelAccessibleForNewChat } from "@/lib/chat-model-access";
import {
  resolveDefaultChatModel,
  shouldMigrateLegacyDefaultModel,
} from "@/lib/chat-model-defaults";
import {
  createGenerationRuntime,
  type GenerationRuntime,
  type RuntimeActivityStats,
  type RuntimeActivitySegment,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
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
  useDetectUserMessageLanguage,
  usePlatformSkillList,
  useSkillList,
  useUpdateAutoApprove,
  useProviderAuthStatus,
  useOpencodeFreeModels,
  type SandboxFileData,
} from "@/orpc/hooks";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import { AuthRequestCard } from "./auth-request-card";
import { ChatInput } from "./chat-input";
import { useChatModelStore } from "./chat-model-store";
import { formatDuration } from "./chat-performance-metrics";
import { useChatSkillStore } from "./chat-skill-store";
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

type QueuedMessage = {
  id: string;
  content: string;
  attachments?: AttachmentData[];
  selectedSkillKeys?: string[];
};

type InputPrefillRequest = {
  id: string;
  text: string;
  mode?: "replace" | "append";
};

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";
const EMPTY_SELECTED_SKILLS: string[] = [];
const CUSTOM_SKILL_PREFIX = "custom:";

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
  timing?: {
    endToEndDurationMs?: number;
    sandboxStartupDurationMs?: number;
    sandboxStartupMode?: "created" | "reused" | "unknown";
    generationDurationMs?: number;
    phaseDurationsMs?: {
      sandboxConnectOrCreateMs?: number;
      opencodeReadyMs?: number;
      sessionReadyMs?: number;
      agentInitMs?: number;
      prePromptSetupMs?: number;
      agentReadyToPromptMs?: number;
      waitForFirstEventMs?: number;
      modelStreamMs?: number;
      postProcessingMs?: number;
    };
    phaseTimestamps?: Array<{
      phase: string;
      at: string;
      elapsedMs: number;
    }>;
    activityDurationsMs?: {
      totalToolCalls?: number;
      completedToolCalls?: number;
      totalToolDurationMs?: number;
      maxToolDurationMs?: number;
      perToolUseIdMs?: Record<string, number>;
    };
  };
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
    timing: m.timing,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withEndToEndDuration(
  timing: Message["timing"] | undefined,
  startedAtMs: number | undefined,
  completedAtMs = Date.now(),
): Message["timing"] | undefined {
  if (!startedAtMs) {
    return timing;
  }
  return {
    ...timing,
    endToEndDurationMs: Math.max(0, completedAtMs - startedAtMs),
  };
}

function withActivityDurations(
  timing: Message["timing"] | undefined,
  stats: RuntimeActivityStats,
): Message["timing"] | undefined {
  if (stats.totalToolCalls === 0) {
    return timing;
  }
  return {
    ...timing,
    activityDurationsMs: {
      ...timing?.activityDurationsMs,
      totalToolCalls: stats.totalToolCalls,
      completedToolCalls: stats.completedToolCalls,
      totalToolDurationMs: stats.totalToolDurationMs,
      maxToolDurationMs: stats.maxToolDurationMs,
      perToolUseIdMs: {
        ...timing?.activityDurationsMs?.perToolUseIdMs,
        ...stats.perToolUseIdMs,
      },
    },
  };
}

function buildSkillInstructionBlock(skillSlugs: string[], isFrench: boolean): string {
  const heading = isFrench
    ? "Utilise les skills suivants pour résoudre la tâche:"
    : "use the following skills to solve the task:";
  const skillsList = skillSlugs.map((skillSlug) => `- "${skillSlug}"`).join("\n");
  return `${heading}\n${skillsList}`;
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
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } = usePlatformSkillList();
  const { data: personalSkills, isLoading: isPersonalSkillsLoading } = useSkillList();
  const { data: existingConversation, isLoading } = useConversation(conversationId);
  const { startGeneration, subscribeToGeneration, abort } = useGeneration();
  const { mutateAsync: submitApproval, isPending: isApproving } = useSubmitApproval();
  const { mutateAsync: submitAuthResult, isPending: isSubmittingAuth } = useSubmitAuthResult();
  const { mutateAsync: getAuthUrl } = useGetAuthUrl();
  const { mutateAsync: cancelGeneration } = useCancelGeneration();
  const { mutateAsync: detectUserMessageLanguage } = useDetectUserMessageLanguage();
  const { data: activeGeneration } = useActiveGeneration(conversationId);
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: opencodeFreeModelsData } = useOpencodeFreeModels();

  // Track current generation ID
  const currentGenerationIdRef = useRef<string | undefined>(undefined);
  const runtimeRef = useRef<GenerationRuntime | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [localAutoApprove, setLocalAutoApprove] = useState(false);
  const selectedModel = useChatModelStore((state) => state.selectedModel);
  const setSelectedModel = useChatModelStore((state) => state.setSelectedModel);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  const [queueingEnabled, setQueueingEnabled] = useState(true);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [inputPrefillRequest, setInputPrefillRequest] = useState<InputPrefillRequest | null>(null);
  const [draftConversationId, setDraftConversationId] = useState<string | undefined>(
    conversationId,
  );
  const skillSelectionScopeKey = useMemo(
    () => draftConversationId ?? conversationId ?? "new-chat",
    [conversationId, draftConversationId],
  );
  const selectedSkillSlugsByScope = useChatSkillStore((state) => state.selectedSkillSlugsByScope);
  const selectedSkillKeys =
    selectedSkillSlugsByScope[skillSelectionScopeKey] ?? EMPTY_SELECTED_SKILLS;
  const toggleSelectedSkillSlug = useChatSkillStore((state) => state.toggleSelectedSkillSlug);
  const clearSelectedSkillSlugs = useChatSkillStore((state) => state.clearSelectedSkillSlugs);
  const connectedProviders = providerAuthStatus?.connected;

  // Segmented activity feed state
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [, setIntegrationsUsed] = useState<Set<IntegrationType>>(new Set());
  const [, setTraceStatus] = useState<TraceStatus>("complete");
  const [agentInitStatus, setAgentInitStatus] = useState<string | null>(null);
  const [streamClockNow, setStreamClockNow] = useState(() => Date.now());

  // Sandbox files collected during streaming
  const [, setStreamingSandboxFiles] = useState<SandboxFileData[]>([]);

  // Current conversation ID (may be set during streaming for new conversations)
  const currentConversationIdRef = useRef<string | undefined>(conversationId);
  const viewedConversationIdRef = useRef<string | undefined>(conversationId);
  const streamScopeRef = useRef(0);
  const queuedMessageRef = useRef<QueuedMessage | null>(null);
  const runGenerationRef = useRef<(content: string, attachments?: AttachmentData[]) => void>(
    () => {},
  );
  const autoApproveEnabled = useMemo(() => localAutoApprove, [localAutoApprove]);
  const isOpenAIConnected = Boolean(connectedProviders?.openai);
  const resolvedDefaultModel = useMemo(
    () =>
      resolveDefaultChatModel({
        isOpenAIConnected,
        availableOpencodeFreeModelIDs: (opencodeFreeModelsData?.models ?? []).map(
          (model) => model.id,
        ),
      }),
    [isOpenAIConnected, opencodeFreeModelsData],
  );
  const conversationModel = (
    existingConversation as
      | {
          model?: string;
        }
      | null
      | undefined
  )?.model;
  const showModelSwitchWarning = Boolean(
    conversationId && conversationModel && selectedModel !== conversationModel,
  );

  useEffect(() => {
    viewedConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (conversationId) {
      return;
    }

    const shouldMigrateLegacyModel = shouldMigrateLegacyDefaultModel({
      currentModel: selectedModel,
      isOpenAIConnected,
    });
    const isAccessible = isModelAccessibleForNewChat({
      model: selectedModel,
      isOpenAIConnected,
      availableOpencodeFreeModelIDs: (opencodeFreeModelsData?.models ?? []).map(
        (model) => model.id,
      ),
    });

    if ((shouldMigrateLegacyModel || !isAccessible) && resolvedDefaultModel !== selectedModel) {
      setSelectedModel(resolvedDefaultModel);
    }
  }, [
    conversationId,
    isOpenAIConnected,
    opencodeFreeModelsData,
    resolvedDefaultModel,
    selectedModel,
    setSelectedModel,
  ]);

  useEffect(() => {
    const shouldRunStreamTimer = isStreaming && initTrackingStartedAtRef.current !== null;
    if (!shouldRunStreamTimer) {
      return;
    }
    const interval = window.setInterval(() => setStreamClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  const isStreamEventForActiveScope = useCallback(
    ({
      scope,
      streamGenerationId,
      eventGenerationId,
      eventConversationId,
    }: {
      scope: number;
      streamGenerationId?: string;
      eventGenerationId?: string;
      eventConversationId?: string;
    }): boolean => {
      if (streamScopeRef.current !== scope) {
        return false;
      }

      const activeGenerationId = currentGenerationIdRef.current;
      const generationId = eventGenerationId ?? streamGenerationId;
      if (activeGenerationId && generationId && activeGenerationId !== generationId) {
        return false;
      }

      const viewedConversationId = viewedConversationIdRef.current;
      if (
        viewedConversationId &&
        eventConversationId &&
        viewedConversationId !== eventConversationId
      ) {
        return false;
      }

      return true;
    },
    [],
  );

  useEffect(() => {
    queuedMessageRef.current = queuedMessage;
  }, [queuedMessage]);

  const maybeSendQueuedWhenReady = useCallback(() => {
    const queued = queuedMessageRef.current;
    if (!queued) {
      return;
    }
    setQueuedMessage(null);
    runGenerationRef.current(queued.content, queued.attachments);
  }, []);

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
    (source: "new_generation" | "reconnect", startedAtMs?: number) => {
      const startedAt = startedAtMs ?? Date.now();
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

  const streamElapsedMs = useMemo(() => {
    if (!initTrackingStartedAtRef.current) {
      return null;
    }
    return Math.max(0, streamClockNow - initTrackingStartedAtRef.current);
  }, [streamClockNow]);

  const initElapsedLabel = useMemo(() => {
    if (!isStreaming || segments.length > 0 || streamElapsedMs === null) {
      return null;
    }
    return formatDuration(streamElapsedMs);
  }, [isStreaming, segments.length, streamElapsedMs]);

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

  const syncConversationForNewChat = useCallback(
    (id: string) => {
      currentConversationIdRef.current = id;
      setDraftConversationId(id);
      notifyConversationIdSync(id);
      if (!conversationId) {
        window.history.replaceState(null, "", `/chat/${id}`);
      }
    },
    [conversationId, notifyConversationIdSync],
  );

  const persistInterruptedRuntimeMessage = useCallback(
    (runtime: GenerationRuntime, messageId?: string, timing?: Message["timing"]) => {
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
          timing,
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
  }, [existingConversation, conversationId, setSelectedModel]);

  useEffect(() => () => resetInitTracking(), [resetInitTracking]);

  // Reset when conversation changes
  useEffect(() => {
    streamScopeRef.current += 1;
    abort();

    // Always sync the ref with the prop
    currentConversationIdRef.current = conversationId;
    setDraftConversationId(conversationId);
    runtimeRef.current = null;
    setStreamingParts([]);
    setSegments([]);
    setIntegrationsUsed(new Set());
    setTraceStatus("complete");
    setIsStreaming(false);
    setStreamError(null);
    setStreamingSandboxFiles([]);
    currentGenerationIdRef.current = undefined;
    resetInitTracking();

    if (!conversationId) {
      setMessages([]);
    }
  }, [abort, conversationId, resetInitTracking]);

  // Listen for "new-chat" event to reset state when user clicks New Chat
  useEffect(() => {
    const handleNewChat = () => {
      streamScopeRef.current += 1;
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
      viewedConversationIdRef.current = undefined;
      setDraftConversationId(undefined);
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
      const reconnectStartedAtMs = activeGeneration.startedAt
        ? Date.parse(activeGeneration.startedAt)
        : NaN;
      beginInitTracking(
        "reconnect",
        Number.isFinite(reconnectStartedAtMs) ? reconnectStartedAtMs : undefined,
      );
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
      const streamScope = streamScopeRef.current;
      const streamGenerationId = activeGeneration.generationId;

      subscribeToGeneration(activeGeneration.generationId, {
        onText: (text) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          markInitSignal("text");
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onThinking: (data) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          markInitSignal("thinking");
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          markInitSignal("tool_use", { toolName: data.toolName });
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result, toolUseId) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          markInitSignal("tool_result", { toolName });
          runtime.handleToolResult(toolName, result, toolUseId);
          syncFromRuntime(runtime);
        },
        onPendingApproval: async (data) => {
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("pending_approval", { toolName: data.toolName });
          console.log("[ApprovalCard] Showing approval card", {
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            integration: data.integration,
            operation: data.operation,
            command: data.command,
          });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
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
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("auth_needed", { integrations: data.integrations });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
          }
          runtime.handleAuthNeeded(data);
          syncFromRuntime(runtime);
        },
        onAuthProgress: (connected, remaining) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          runtime.handleAuthProgress(connected, remaining);
          syncFromRuntime(runtime);
        },
        onAuthResult: (success) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          runtime.handleAuthResult(success);
          syncFromRuntime(runtime);
        },
        onSandboxFile: (file) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          markInitSignal("sandbox_file", { filename: file.filename });
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onStatusChange: (status) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
          handleInitStatusChange(status);
        },
        onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          const timing = artifacts?.timing;
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
            timing,
          };
          upsertMessageById(fallbackAssistant);
          setStreamingParts([]);
          setStreamingSandboxFiles([]);
          setIsStreaming(false);
          setSegments([]);
          setTraceStatus("complete");
          setStreamError(null);
          currentGenerationIdRef.current = undefined;
          runtimeRef.current = null;
          resetInitTracking();
          const hydratedAssistant = await hydrateAssistantMessage(
            newConversationId,
            messageId,
            fallbackAssistant,
          );
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          upsertMessageById(hydratedAssistant);
          if (!conversationId && newConversationId) {
            syncConversationForNewChat(newConversationId);
          }
          maybeSendQueuedWhenReady();
        },
        onError: (message) => {
          if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
            return;
          }
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
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
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
    activeGeneration?.startedAt,
    activeGeneration?.status,
    autoApproveEnabled,
    beginInitTracking,
    conversationId,
    handleInitStatusChange,
    markInitMissingAtEnd,
    markInitSignal,
    persistInterruptedRuntimeMessage,
    resetInitTracking,
    submitApproval,
    subscribeToGeneration,
    syncFromRuntime,
    syncConversationForNewChat,
    hydrateAssistantMessage,
    maybeSendQueuedWhenReady,
    isStreamEventForActiveScope,
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

  const runGeneration = useCallback(
    async (
      content: string,
      attachments?: AttachmentData[],
      selectedSkillKeysOverride?: string[],
    ) => {
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
      const streamScope = streamScopeRef.current;
      let streamGenerationId: string | undefined;
      const generationRequestStartedAtMs = Date.now();

      const selectedKeys = selectedSkillKeysOverride ?? selectedSkillKeys;
      const selectedPlatformSkillSlugs = selectedKeys.filter(
        (key) => !key.startsWith(CUSTOM_SKILL_PREFIX),
      );
      const effectiveConversationId = currentConversationIdRef.current ?? conversationId;
      await startGeneration(
        {
          conversationId: effectiveConversationId,
          content,
          model: selectedModel,
          autoApprove: autoApproveEnabled,
          deviceId: selectedDeviceId,
          selectedPlatformSkillSlugs,
          fileAttachments: attachments,
        },
        {
          onStarted: (generationId, newConversationId) => {
            if (streamScopeRef.current !== streamScope) {
              return;
            }
            streamGenerationId = generationId;
            currentGenerationIdRef.current = generationId;
            console.info(
              `[AgentInit][Client] generation_started generationId=${generationId} conversationId=${newConversationId}`,
            );
            if (!conversationId && newConversationId) {
              syncConversationForNewChat(newConversationId);
            }
          },
          onText: (text) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            markInitSignal("text");
            runtime.handleText(text);
            syncFromRuntime(runtime);
          },
          onThinking: (data) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            markInitSignal("thinking");
            runtime.handleThinking(data);
            syncFromRuntime(runtime);
          },
          onToolUse: (data) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            markInitSignal("tool_use", { toolName: data.toolName });
            runtime.handleToolUse(data);
            syncFromRuntime(runtime);
          },
          onToolResult: (toolName, result, toolUseId) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            markInitSignal("tool_result", { toolName });
            runtime.handleToolResult(toolName, result, toolUseId);
            syncFromRuntime(runtime);
          },
          onPendingApproval: async (data) => {
            if (
              !isStreamEventForActiveScope({
                scope: streamScope,
                streamGenerationId,
                eventGenerationId: data.generationId,
                eventConversationId: data.conversationId,
              })
            ) {
              return;
            }
            markInitSignal("pending_approval", { toolName: data.toolName });
            currentGenerationIdRef.current = data.generationId;
            if (data.conversationId) {
              syncConversationForNewChat(data.conversationId);
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
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            runtime.handleApprovalResult(toolUseId, decision);
            syncFromRuntime(runtime);
          },
          onAuthNeeded: (data) => {
            if (
              !isStreamEventForActiveScope({
                scope: streamScope,
                streamGenerationId,
                eventGenerationId: data.generationId,
                eventConversationId: data.conversationId,
              })
            ) {
              return;
            }
            markInitSignal("auth_needed", { integrations: data.integrations });
            currentGenerationIdRef.current = data.generationId;
            if (data.conversationId) {
              syncConversationForNewChat(data.conversationId);
            }
            runtime.handleAuthNeeded(data);
            syncFromRuntime(runtime);
          },
          onAuthProgress: (connected, remaining) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            runtime.handleAuthProgress(connected, remaining);
            syncFromRuntime(runtime);
          },
          onAuthResult: (success) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            runtime.handleAuthResult(success);
            syncFromRuntime(runtime);
          },
          onSandboxFile: (file) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            markInitSignal("sandbox_file", { filename: file.filename });
            runtime.handleSandboxFile(file);
            syncFromRuntime(runtime);
          },
          onStatusChange: (status) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
            handleInitStatusChange(status);
          },
          onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
            if (
              !isStreamEventForActiveScope({
                scope: streamScope,
                streamGenerationId,
                eventGenerationId: generationId,
                eventConversationId: newConversationId,
              })
            ) {
              return;
            }
            const doneAtMs = Date.now();
            const timing = withActivityDurations(
              withEndToEndDuration(artifacts?.timing, generationRequestStartedAtMs, doneAtMs),
              runtime.getActivityStats(),
            );
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
              timing,
            };
            upsertMessageById(fallbackAssistant);
            setStreamingParts([]);
            setStreamingSandboxFiles([]);
            setIsStreaming(false);
            setSegments([]); // Clear segments when done
            setTraceStatus("complete");
            setStreamError(null);
            currentGenerationIdRef.current = undefined;
            runtimeRef.current = null;
            resetInitTracking();
            const hydratedAssistant = await hydrateAssistantMessage(
              newConversationId,
              messageId,
              fallbackAssistant,
            );
            if (
              !isStreamEventForActiveScope({
                scope: streamScope,
                streamGenerationId,
                eventGenerationId: generationId,
                eventConversationId: newConversationId,
              })
            ) {
              return;
            }
            upsertMessageById(hydratedAssistant);

            // Invalidate conversation queries to refresh sidebar
            queryClient.invalidateQueries({ queryKey: ["conversation"] });

            // Update URL for new conversations without remounting
            if (!conversationId && newConversationId) {
              syncConversationForNewChat(newConversationId);
            }
            maybeSendQueuedWhenReady();
          },
          onError: (message) => {
            if (!isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })) {
              return;
            }
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
            if (
              !isStreamEventForActiveScope({
                scope: streamScope,
                streamGenerationId,
                eventGenerationId: data.generationId,
                eventConversationId: data.conversationId,
              })
            ) {
              return;
            }
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
      selectedSkillKeys,
      selectedModel,
      startGeneration,
      submitApproval,
      syncFromRuntime,
      syncConversationForNewChat,
      hydrateAssistantMessage,
      maybeSendQueuedWhenReady,
      isStreamEventForActiveScope,
      upsertMessageById,
    ],
  );

  useEffect(() => {
    runGenerationRef.current = (content: string, attachments?: AttachmentData[]) => {
      void runGeneration(content, attachments);
    };
  }, [runGeneration]);

  const buildOutgoingContent = useCallback(
    async (content: string, selectedSkillNames: string[]): Promise<string> => {
      if (selectedSkillNames.length === 0) {
        return content;
      }

      let isFrench = false;
      try {
        const result = await detectUserMessageLanguage({ text: content });
        isFrench = result.language === "french";
      } catch (error) {
        console.error("Failed to detect user message language:", error);
      }

      const instructions = buildSkillInstructionBlock(selectedSkillNames, isFrench);
      return `${content}\n\n${instructions}`;
    },
    [detectUserMessageLanguage],
  );

  const handleSend = useCallback(
    (content: string, attachments?: AttachmentData[]) => {
      const send = async () => {
        const selectedSkillKeysSnapshot = [...selectedSkillKeys];
        const selectedSkillNamesSnapshot = selectedSkillKeysSnapshot.map((key) =>
          key.startsWith(CUSTOM_SKILL_PREFIX) ? key.slice(CUSTOM_SKILL_PREFIX.length) : key,
        );
        const outgoingContent = await buildOutgoingContent(content, selectedSkillNamesSnapshot);

        if (isStreaming) {
          if (!queueingEnabled) {
            setStreamError("Queueing is off. Wait for the current response or stop it first.");
            return;
          }
          setQueuedMessage((prev) => ({
            id: prev?.id ?? `queued-${Date.now()}`,
            content: outgoingContent,
            attachments,
            selectedSkillKeys: selectedSkillKeysSnapshot,
          }));
          clearSelectedSkillSlugs(skillSelectionScopeKey);
          return;
        }

        clearSelectedSkillSlugs(skillSelectionScopeKey);
        await runGeneration(outgoingContent, attachments, selectedSkillKeysSnapshot);
      };

      void send();
    },
    [
      buildOutgoingContent,
      clearSelectedSkillSlugs,
      isStreaming,
      queueingEnabled,
      runGeneration,
      selectedSkillKeys,
      skillSelectionScopeKey,
    ],
  );

  const handleSendQueuedNow = useCallback(() => {
    const queued = queuedMessageRef.current;
    if (!queued) {
      return;
    }
    setQueuedMessage(null);
    void runGeneration(queued.content, queued.attachments, queued.selectedSkillKeys);
  }, [runGeneration]);

  const handleClearQueued = useCallback(() => {
    setQueuedMessage(null);
  }, []);

  const handleEditQueuedMessage = useCallback(() => {
    const queued = queuedMessageRef.current;
    if (!queued) {
      return;
    }
    setQueuedMessage(null);
    setInputPrefillRequest({
      id: `prefill-${Date.now()}`,
      text: queued.content,
    });
  }, []);

  const handleToggleQueueingEnabled = useCallback(() => {
    setQueueingEnabled((prev) => !prev);
  }, []);

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

  const selectedSkillLabel = useMemo(() => {
    const selectableSkills = [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        searchable: `${skill.title} ${skill.slug}`.toLowerCase(),
      })),
      ...((personalSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          searchable: `${skill.displayName} ${skill.name}`.toLowerCase(),
        })) ?? []),
    ];

    if (selectedSkillKeys.length === 0) {
      return "Skills";
    }
    if (selectedSkillKeys.length === 1) {
      const only = selectableSkills.find((skill) => skill.key === selectedSkillKeys[0]);
      const fallback = selectedSkillKeys[0] ?? "1 skill";
      return only?.title ?? fallback.replace(CUSTOM_SKILL_PREFIX, "");
    }
    return `${selectedSkillKeys.length} skills`;
  }, [platformSkills, personalSkills, selectedSkillKeys]);

  const filteredSelectableSkills = useMemo(() => {
    const selectableSkills = [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        searchable: `${skill.title} ${skill.slug}`.toLowerCase(),
      })),
      ...((personalSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          searchable: `${skill.displayName} ${skill.name}`.toLowerCase(),
        })) ?? []),
    ];
    const query = skillSearchQuery.trim().toLowerCase();
    if (!query) {
      return selectableSkills;
    }
    return selectableSkills.filter((skill) => skill.searchable.includes(query));
  }, [platformSkills, personalSkills, skillSearchQuery]);

  const handleSkillDropdownSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement | null;
      const key = target?.dataset.skillSlug;
      if (!key) {
        return;
      }
      toggleSelectedSkillSlug(skillSelectionScopeKey, key);
    },
    [skillSelectionScopeKey, toggleSelectedSkillSlug],
  );

  const handleSkillSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSkillSearchQuery(event.target.value);
  }, []);

  const handleCloseSkillsMenu = useCallback(() => {
    setSkillsMenuOpen(false);
  }, []);

  const handleClearSelectedSkills = useCallback(() => {
    clearSelectedSkillSlugs(skillSelectionScopeKey);
  }, [clearSelectedSkillSlugs, skillSelectionScopeKey]);

  const handleOpenSkillsChange = useCallback((open: boolean) => {
    setSkillsMenuOpen(open);
    if (!open) {
      setSkillSearchQuery("");
    }
  }, []);

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
        setInputPrefillRequest({
          id: `voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe]);

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

  useHotkeys(
    "mod+enter",
    () => {
      if (queuedMessageRef.current) {
        handleSendQueuedNow();
      }
    },
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: true,
    },
    [handleSendQueuedNow],
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
          {showModelSwitchWarning && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Changing model mid-conversation can degrade performance.</span>
            </div>
          )}
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
                        <div className="flex-1" />
                        {initElapsedLabel && (
                          <div className="text-muted-foreground/70 inline-flex items-center gap-1 text-xs">
                            <Timer className="h-3 w-3" />
                            <span>{initElapsedLabel}</span>
                          </div>
                        )}
                        <div className="flex gap-1">
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
                              elapsedMs={streamElapsedMs ?? undefined}
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
                              elapsedMs={streamElapsedMs ?? undefined}
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
        <div className="mx-auto w-full space-y-2">
          <div className="mx-auto w-full max-w-[1276px]">
            <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[52px_minmax(0,896px)_52px] md:justify-center">
              <div className="min-w-0 space-y-2 md:col-span-2">
                {(isRecording || isProcessingVoice || voiceError) && (
                  <VoiceIndicator
                    isRecording={isRecording}
                    isProcessing={isProcessingVoice}
                    error={voiceError}
                  />
                )}
                {queuedMessage && (
                  <div className="from-muted/75 to-background rounded-3xl border bg-gradient-to-b px-4 py-3 shadow-[0_1px_0_0_hsl(var(--background))_inset,0_12px_24px_-22px_hsl(var(--foreground)/0.5)]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="bg-background/80 border-border/70 inline-flex size-7 items-center justify-center rounded-full border">
                          <ListTree className="text-muted-foreground h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm leading-none font-medium">
                            {queuedMessage.content ||
                              `${queuedMessage.attachments?.length ?? 0} queued attachment${(queuedMessage.attachments?.length ?? 0) === 1 ? "" : "s"}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          className="h-8 rounded-full px-3"
                          variant="secondary"
                          onClick={handleSendQueuedNow}
                        >
                          Steer
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={handleClearQueued}
                          aria-label="Delete queued message"
                          className="rounded-full"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" className="rounded-full">
                              <Ellipsis className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56 rounded-2xl p-1.5">
                            <DropdownMenuItem onClick={handleEditQueuedMessage}>
                              <PenLine className="h-4 w-4" />
                              Edit message
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleToggleQueueingEnabled}>
                              <ListTree className="h-4 w-4" />
                              {queueingEnabled ? "Turn off queueing" : "Turn on queueing"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[1276px]">
            <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[52px_minmax(0,896px)_52px] md:justify-center">
              <div className="min-w-0 self-start md:col-start-1">
                <div className="bg-muted/50 border-input flex h-[52px] items-center justify-center rounded-lg border p-2">
                  <DropdownMenu open={skillsMenuOpen} onOpenChange={handleOpenSkillsChange}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={selectedSkillLabel}
                        className="relative h-9 w-9 px-0"
                      >
                        <Sparkles className="h-4 w-4" />
                        {selectedSkillKeys.length > 0 ? (
                          <span className="bg-foreground text-background absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium">
                            {selectedSkillKeys.length}
                          </span>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="center"
                      sideOffset={16}
                      className="border-border/80 bg-background/95 flex h-[360px] w-[320px] flex-col rounded-xl p-0 shadow-xl backdrop-blur-sm"
                    >
                      <DropdownMenuLabel className="px-3 py-2.5">
                        <div className="relative">
                          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
                          <Input
                            value={skillSearchQuery}
                            onChange={handleSkillSearchChange}
                            placeholder="Search skills..."
                            className="h-9 pl-8"
                          />
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <div className="min-h-0 flex-1 overflow-y-auto p-1">
                        {isPlatformSkillsLoading || isPersonalSkillsLoading ? (
                          <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
                        ) : filteredSelectableSkills.length === 0 ? (
                          <DropdownMenuItem disabled>No skills found</DropdownMenuItem>
                        ) : (
                          filteredSelectableSkills.map((skill) => {
                            const isSelected = selectedSkillKeys.includes(skill.key);
                            return (
                              <DropdownMenuItem
                                key={skill.key}
                                data-skill-slug={skill.key}
                                onSelect={handleSkillDropdownSelect}
                              >
                                <Check
                                  className={
                                    isSelected ? "h-4 w-4 opacity-100" : "h-4 w-4 opacity-0"
                                  }
                                />
                                <span className="truncate">{skill.title}</span>
                              </DropdownMenuItem>
                            );
                          })
                        )}
                      </div>
                      <DropdownMenuSeparator />
                      <div className="grid grid-cols-2 items-center gap-0 p-1">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleClearSelectedSkills}
                          disabled={selectedSkillKeys.length === 0}
                          className="h-10 rounded-md"
                        >
                          Clear
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleCloseSkillsMenu}
                          className="h-10 rounded-md"
                        >
                          Close
                        </Button>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="min-w-0 md:col-start-2">
                <ChatInput
                  onSend={handleSend}
                  onStop={handleStop}
                  disabled={isRecording || isProcessingVoice}
                  isStreaming={isStreaming}
                  isRecording={isRecording}
                  onStartRecording={handleStartRecording}
                  onStopRecording={stopRecordingAndTranscribe}
                  prefillRequest={inputPrefillRequest}
                  conversationId={draftConversationId}
                />
              </div>
              <div className="hidden md:col-start-3 md:block" aria-hidden="true" />
            </div>
          </div>
          <div className="mx-auto w-full max-w-4xl">
            <div className="flex items-center justify-between gap-2">
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
    </div>
  );
}

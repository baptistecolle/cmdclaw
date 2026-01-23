"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { client } from "./client";
import type { ChatEvent } from "@/server/orpc/routers/chat";

// Types for chat event callbacks
export type ToolUseData = {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type PendingApprovalData = {
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type ThinkingData = {
  content: string;
  thinkingId: string;
};

export type ChatCallbacks = {
  onText?: (content: string) => void;
  onThinking?: (data: ThinkingData) => void;
  onToolUse?: (data: ToolUseData) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onPendingApproval?: (data: PendingApprovalData) => void;
  onApprovalResult?: (toolUseId: string, decision: "approved" | "denied") => void;
  onDone?: (
    conversationId: string,
    messageId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalCostUsd: number;
    }
  ) => void;
  onError?: (message: string) => void;
};

// Hook for streaming chat
export function useChatStream() {
  const queryClient = useQueryClient();
  const abortControllerRef = { current: null as AbortController | null };

  return {
    sendMessage: async (
      input: { conversationId?: string; content: string; model?: string },
      callbacks: ChatCallbacks
    ) => {
      // Create a new AbortController for this request
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        const iterator = await client.chat.sendMessage(input, { signal });

        for await (const event of iterator) {
          // Check if aborted before processing each event
          if (signal.aborted) {
            break;
          }

          switch (event.type) {
            case "text":
              callbacks.onText?.(event.content);
              break;
            case "thinking":
              callbacks.onThinking?.({
                content: event.content,
                thinkingId: event.thinkingId,
              });
              break;
            case "tool_use":
              callbacks.onToolUse?.({
                toolName: event.toolName,
                toolInput: event.toolInput,
                toolUseId: event.toolUseId,
                integration: event.integration,
                operation: event.operation,
                isWrite: event.isWrite,
              });
              break;
            case "tool_result":
              callbacks.onToolResult?.(event.toolName, event.result);
              break;
            case "pending_approval":
              callbacks.onPendingApproval?.({
                conversationId: event.conversationId,
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                toolInput: event.toolInput,
                integration: event.integration,
                operation: event.operation,
                command: event.command,
              });
              break;
            case "approval_result":
              callbacks.onApprovalResult?.(event.toolUseId, event.decision);
              break;
            case "done":
              callbacks.onDone?.(
                event.conversationId,
                event.messageId,
                event.usage
              );
              queryClient.invalidateQueries({ queryKey: ["conversation"] });
              break;
            case "error":
              callbacks.onError?.(event.message);
              break;
          }
        }
      } catch (error) {
        // Don't report abort errors
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        callbacks.onError?.(
          error instanceof Error ? error.message : "Unknown error"
        );
      } finally {
        abortControllerRef.current = null;
      }
    },
    abort: () => {
      abortControllerRef.current?.abort();
    },
  };
}

// Hook for approving/denying tool usage
export function useApproveToolUse() {
  return useMutation({
    mutationFn: ({
      conversationId,
      toolUseId,
      decision,
    }: {
      conversationId: string;
      toolUseId: string;
      decision: "allow" | "deny";
    }) => client.chat.approveToolUse({ conversationId, toolUseId, decision }),
  });
}

// Hook for listing conversations
export function useConversationList(options?: { limit?: number }) {
  return useQuery({
    queryKey: ["conversation", "list", options?.limit],
    queryFn: () => client.conversation.list({ limit: options?.limit ?? 50 }),
  });
}

// Hook for getting a single conversation
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ["conversation", "get", id],
    queryFn: () => client.conversation.get({ id: id! }),
    enabled: !!id,
  });
}

// Hook for deleting a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.conversation.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation title
export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      client.conversation.updateTitle({ id, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation auto-approve setting
export function useUpdateAutoApprove() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, autoApprove }: { id: string; autoApprove: boolean }) =>
      client.conversation.updateAutoApprove({ id, autoApprove }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for listing integrations
export function useIntegrationList() {
  return useQuery({
    queryKey: ["integration", "list"],
    queryFn: () => client.integration.list(),
  });
}

// Hook for toggling integration
export function useToggleIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      client.integration.toggle({ id, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for disconnecting integration
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.integration.disconnect({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for getting OAuth URL
export function useGetAuthUrl() {
  return useMutation({
    mutationFn: ({
      type,
      redirectUrl,
    }: {
      type: "gmail" | "google_calendar" | "google_docs" | "google_sheets" | "google_drive" | "notion" | "linear" | "github" | "airtable" | "slack" | "hubspot" | "linkedin" | "salesforce";
      redirectUrl: string;
    }) => client.integration.getAuthUrl({ type, redirectUrl }),
  });
}

// Hook for linking LinkedIn account after redirect
export function useLinkLinkedIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => client.integration.linkLinkedIn({ accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for voice transcription
export function useTranscribe() {
  return useMutation({
    mutationFn: ({ audio, mimeType }: { audio: string; mimeType: string }) =>
      client.voice.transcribe({ audio, mimeType }),
  });
}

// ========== SKILL HOOKS ==========

// Hook for listing skills
export function useSkillList() {
  return useQuery({
    queryKey: ["skill", "list"],
    queryFn: () => client.skill.list(),
  });
}

// Hook for getting a single skill
export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skill", "get", id],
    queryFn: () => client.skill.get({ id: id! }),
    enabled: !!id,
  });
}

// Hook for creating a skill
export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ displayName, description }: { displayName: string; description: string }) =>
      client.skill.create({ displayName, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a skill
export function useUpdateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name,
      displayName,
      description,
      icon,
      enabled,
    }: {
      id: string;
      name?: string;
      displayName?: string;
      description?: string;
      icon?: string | null;
      enabled?: boolean;
    }) => client.skill.update({ id, name, displayName, description, icon, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for deleting a skill
export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for adding a file to a skill
export function useAddSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      skillId,
      path,
      content,
    }: {
      skillId: string;
      path: string;
      content: string;
    }) => client.skill.addFile({ skillId, path, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for updating a file
export function useUpdateSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      client.skill.updateFile({ id, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for deleting a file
export function useDeleteSkillFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteFile({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== SKILL DOCUMENT HOOKS ==========

// Hook for uploading a document
export function useUploadSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      skillId,
      filename,
      mimeType,
      content,
      description,
    }: {
      skillId: string;
      filename: string;
      mimeType: string;
      content: string; // base64
      description?: string;
    }) =>
      client.skill.uploadDocument({
        skillId,
        filename,
        mimeType,
        content,
        description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for getting document download URL
export function useGetDocumentUrl() {
  return useMutation({
    mutationFn: (id: string) => client.skill.getDocumentUrl({ id }),
  });
}

// Hook for deleting a document
export function useDeleteSkillDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.skill.deleteDocument({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// ========== USER HOOKS ==========

// Hook for getting current user
export function useCurrentUser() {
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: () => client.user.me(),
  });
}

// Hook for completing onboarding
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.user.completeOnboarding(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
}

// ========== GENERATION HOOKS ==========

export type GenerationPendingApprovalData = {
  generationId: string;
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type AuthNeededData = {
  generationId: string;
  conversationId: string;
  integrations: string[];
  reason?: string;
};

export type GenerationCallbacks = {
  onText?: (content: string) => void;
  onThinking?: (data: ThinkingData) => void;
  onToolUse?: (data: ToolUseData) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onPendingApproval?: (data: GenerationPendingApprovalData) => void;
  onApprovalResult?: (toolUseId: string, decision: "approved" | "denied") => void;
  onAuthNeeded?: (data: AuthNeededData) => void;
  onAuthProgress?: (connected: string, remaining: string[]) => void;
  onAuthResult?: (success: boolean, integrations?: string[]) => void;
  onDone?: (
    generationId: string,
    conversationId: string,
    messageId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalCostUsd: number;
    }
  ) => void;
  onError?: (message: string) => void;
  onCancelled?: () => void;
  onStatusChange?: (status: string) => void;
};

// Hook for generation-based streaming (new persistent generation system)
export function useGeneration() {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  const startGeneration = useCallback(async (
      input: { conversationId?: string; content: string; model?: string; autoApprove?: boolean },
      callbacks: GenerationCallbacks
    ): Promise<{ generationId: string; conversationId: string } | null> => {
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // Start the generation
        const { generationId, conversationId } = await client.generation.startGeneration(input);

        // Subscribe to the generation stream
        const iterator = await client.generation.subscribeGeneration(
          { generationId },
          { signal }
        );

        for await (const event of iterator) {
          if (signal.aborted) {
            break;
          }

          switch (event.type) {
            case "text":
              callbacks.onText?.(event.content);
              break;
            case "thinking":
              callbacks.onThinking?.({
                content: event.content,
                thinkingId: event.thinkingId,
              });
              break;
            case "tool_use":
              callbacks.onToolUse?.({
                toolName: event.toolName,
                toolInput: event.toolInput,
                toolUseId: event.toolUseId,
                integration: event.integration,
                operation: event.operation,
                isWrite: event.isWrite,
              });
              break;
            case "tool_result":
              callbacks.onToolResult?.(event.toolName, event.result);
              break;
            case "pending_approval":
              callbacks.onPendingApproval?.({
                generationId: event.generationId,
                conversationId: event.conversationId,
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                toolInput: event.toolInput,
                integration: event.integration,
                operation: event.operation,
                command: event.command,
              });
              break;
            case "approval_result":
              callbacks.onApprovalResult?.(event.toolUseId, event.decision);
              break;
            case "auth_needed":
              callbacks.onAuthNeeded?.({
                generationId: event.generationId,
                conversationId: event.conversationId,
                integrations: event.integrations,
                reason: event.reason,
              });
              break;
            case "auth_progress":
              callbacks.onAuthProgress?.(event.connected, event.remaining);
              break;
            case "auth_result":
              callbacks.onAuthResult?.(event.success, event.integrations);
              break;
            case "done":
              callbacks.onDone?.(
                event.generationId,
                event.conversationId,
                event.messageId,
                event.usage
              );
              queryClient.invalidateQueries({ queryKey: ["conversation"] });
              break;
            case "error":
              callbacks.onError?.(event.message);
              break;
            case "cancelled":
              callbacks.onCancelled?.();
              break;
            case "status_change":
              callbacks.onStatusChange?.(event.status);
              break;
          }
        }

        return { generationId, conversationId };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return null;
        }
        callbacks.onError?.(
          error instanceof Error ? error.message : "Unknown error"
        );
        return null;
      } finally {
        abortControllerRef.current = null;
      }
  }, [queryClient]);

  const subscribeToGeneration = useCallback(async (
    generationId: string,
    callbacks: GenerationCallbacks
  ) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const iterator = await client.generation.subscribeGeneration(
        { generationId },
        { signal }
      );

      for await (const event of iterator) {
        if (signal.aborted) {
          break;
        }

        switch (event.type) {
          case "text":
            callbacks.onText?.(event.content);
            break;
          case "thinking":
            callbacks.onThinking?.({
              content: event.content,
              thinkingId: event.thinkingId,
            });
            break;
          case "tool_use":
            callbacks.onToolUse?.({
              toolName: event.toolName,
              toolInput: event.toolInput,
              toolUseId: event.toolUseId,
              integration: event.integration,
              operation: event.operation,
              isWrite: event.isWrite,
            });
            break;
          case "tool_result":
            callbacks.onToolResult?.(event.toolName, event.result);
            break;
          case "pending_approval":
            callbacks.onPendingApproval?.({
              generationId: event.generationId,
              conversationId: event.conversationId,
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              toolInput: event.toolInput,
              integration: event.integration,
              operation: event.operation,
              command: event.command,
            });
            break;
          case "approval_result":
            callbacks.onApprovalResult?.(event.toolUseId, event.decision);
            break;
          case "auth_needed":
            callbacks.onAuthNeeded?.({
              generationId: event.generationId,
              conversationId: event.conversationId,
              integrations: event.integrations,
              reason: event.reason,
            });
            break;
          case "auth_progress":
            callbacks.onAuthProgress?.(event.connected, event.remaining);
            break;
          case "auth_result":
            callbacks.onAuthResult?.(event.success, event.integrations);
            break;
          case "done":
            callbacks.onDone?.(
              event.generationId,
              event.conversationId,
              event.messageId,
              event.usage
            );
            queryClient.invalidateQueries({ queryKey: ["conversation"] });
            break;
          case "error":
            callbacks.onError?.(event.message);
            break;
          case "cancelled":
            callbacks.onCancelled?.();
            break;
          case "status_change":
            callbacks.onStatusChange?.(event.status);
            break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      callbacks.onError?.(
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      abortControllerRef.current = null;
    }
  }, [queryClient]);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { startGeneration, subscribeToGeneration, abort };
}

// Hook for canceling a generation
export function useCancelGeneration() {
  return useMutation({
    mutationFn: (generationId: string) =>
      client.generation.cancelGeneration({ generationId }),
  });
}

// Hook for submitting tool approval (new generation system)
export function useSubmitApproval() {
  return useMutation({
    mutationFn: ({
      generationId,
      toolUseId,
      decision,
    }: {
      generationId: string;
      toolUseId: string;
      decision: "approve" | "deny";
    }) => client.generation.submitApproval({ generationId, toolUseId, decision }),
  });
}

// Hook for submitting auth result (after OAuth completes)
export function useSubmitAuthResult() {
  return useMutation({
    mutationFn: ({
      generationId,
      integration,
      success,
    }: {
      generationId: string;
      integration: string;
      success: boolean;
    }) => client.generation.submitAuthResult({ generationId, integration, success }),
  });
}

// Hook for getting active generation for a conversation
export function useActiveGeneration(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["generation", "active", conversationId],
    queryFn: () => client.generation.getActiveGeneration({ conversationId: conversationId! }),
    enabled: !!conversationId,
    refetchInterval: (query) => {
      // Poll while generating or awaiting auth
      const status = query.state.data?.status;
      if (status === "generating" || status === "awaiting_approval" || status === "awaiting_auth") {
        return 2000;
      }
      return false;
    },
  });
}

// Hook for getting generation status
export function useGenerationStatus(generationId: string | undefined) {
  return useQuery({
    queryKey: ["generation", "status", generationId],
    queryFn: () => client.generation.getGenerationStatus({ generationId: generationId! }),
    enabled: !!generationId,
  });
}

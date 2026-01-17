"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
      type: "gmail" | "google_calendar" | "google_docs" | "google_sheets" | "google_drive" | "notion" | "linear" | "github" | "airtable" | "slack" | "hubspot";
      redirectUrl: string;
    }) => client.integration.getAuthUrl({ type, redirectUrl }),
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

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./client";
import type { ChatEvent } from "@/server/orpc/routers/chat";

// Hook for streaming chat
export function useChatStream() {
  const queryClient = useQueryClient();

  return {
    sendMessage: async (
      input: { conversationId?: string; content: string; model?: string },
      callbacks: {
        onText?: (content: string) => void;
        onToolUse?: (toolName: string, input: unknown) => void;
        onToolResult?: (toolName: string, result: unknown) => void;
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
      }
    ) => {
      try {
        const iterator = await client.chat.sendMessage(input);

        for await (const event of iterator) {
          switch (event.type) {
            case "text":
              callbacks.onText?.(event.content);
              break;
            case "tool_use":
              callbacks.onToolUse?.(event.toolName, event.toolInput);
              break;
            case "tool_result":
              callbacks.onToolResult?.(event.toolName, event.result);
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
        callbacks.onError?.(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    },
  };
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
      type: "gmail" | "notion" | "linear" | "github" | "airtable" | "slack";
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
      enabled,
    }: {
      id: string;
      name?: string;
      displayName?: string;
      description?: string;
      enabled?: boolean;
    }) => client.skill.update({ id, name, displayName, description, enabled }),
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

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useORPC } from "./provider";
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
              // Invalidate conversation queries
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
  const orpc = useORPC();
  return useQuery(
    orpc.conversation.list.queryOptions({
      input: { limit: options?.limit ?? 50 },
    })
  );
}

// Hook for getting a single conversation
export function useConversation(id: string | undefined) {
  const orpc = useORPC();
  return useQuery({
    ...orpc.conversation.get.queryOptions({
      input: { id: id ?? "" },
    }),
    enabled: !!id,
  });
}

// Hook for deleting a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return client.conversation.delete({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for updating conversation title
export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      return client.conversation.updateTitle({ id, title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
}

// Hook for listing integrations
export function useIntegrationList() {
  const orpc = useORPC();
  return useQuery(orpc.integration.list.queryOptions({ input: undefined }));
}

// Hook for toggling integration
export function useToggleIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return client.integration.toggle({ id, enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for disconnecting integration
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return client.integration.disconnect({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration"] });
    },
  });
}

// Hook for getting OAuth URL
export function useGetAuthUrl() {
  return useMutation({
    mutationFn: async ({
      type,
      redirectUrl,
    }: {
      type: "gmail" | "notion" | "linear" | "github" | "airtable" | "slack";
      redirectUrl: string;
    }) => {
      return client.integration.getAuthUrl({ type, redirectUrl });
    },
  });
}

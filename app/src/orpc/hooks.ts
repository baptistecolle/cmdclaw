"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import {
  runGenerationStream,
  type ToolUseData,
  type ThinkingData,
  type GenerationPendingApprovalData,
  type AuthNeededData,
  type SandboxFileData,
  type GenerationCallbacks,
} from "@/lib/generation-stream";
import { client } from "./client";

const STREAM_NOT_READY_ERROR =
  "Generation is still processing but cannot be streamed from this server yet. Please refresh shortly.";
const STREAM_RETRY_DELAY_MS = 1500;
const STREAM_MAX_RETRIES = 80;

function isStreamNotReadyError(message: string | undefined): boolean {
  return (message ?? "").trim() === STREAM_NOT_READY_ERROR;
}

async function waitForRetry(signal: AbortSignal, delayMs: number): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type {
  ToolUseData,
  ThinkingData,
  GenerationPendingApprovalData,
  AuthNeededData,
  SandboxFileData,
  GenerationCallbacks,
};

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
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
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
      type:
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
        | "linkedin"
        | "salesforce"
        | "reddit"
        | "twitter";
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

// ========== CUSTOM INTEGRATION HOOKS ==========

export function useCustomIntegrationList() {
  return useQuery({
    queryKey: ["customIntegration", "list"],
    queryFn: () => client.integration.listCustomIntegrations(),
  });
}

export function useCustomIntegration(slug: string | undefined) {
  return useQuery({
    queryKey: ["customIntegration", "get", slug],
    queryFn: () => client.integration.getCustomIntegration({ slug: slug! }),
    enabled: !!slug,
  });
}

export function useCreateCustomIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      slug: string;
      name: string;
      description: string;
      iconUrl?: string | null;
      baseUrl: string;
      authType: "oauth2" | "api_key" | "bearer_token";
      oauthConfig?: {
        authUrl: string;
        tokenUrl: string;
        scopes: string[];
        pkce?: boolean;
        authStyle?: "header" | "params";
        extraAuthParams?: Record<string, string>;
      } | null;
      apiKeyConfig?: {
        method: "header" | "query";
        headerName?: string;
        queryParam?: string;
      } | null;
      cliCode?: string;
      cliInstructions?: string;
      permissions?: { readOps: string[]; writeOps: string[] };
      clientId?: string | null;
      clientSecret?: string | null;
      apiKey?: string | null;
    }) => client.integration.createCustomIntegration(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customIntegration"] });
    },
  });
}

export function useSetCustomCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      customIntegrationId: string;
      clientId?: string | null;
      clientSecret?: string | null;
      apiKey?: string | null;
      displayName?: string | null;
    }) => client.integration.setCustomCredentials(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customIntegration"] });
    },
  });
}

export function useDisconnectCustomIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (customIntegrationId: string) =>
      client.integration.disconnectCustomIntegration({ customIntegrationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customIntegration"] });
    },
  });
}

export function useToggleCustomIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      customIntegrationId,
      enabled,
    }: {
      customIntegrationId: string;
      enabled: boolean;
    }) =>
      client.integration.toggleCustomIntegration({
        customIntegrationId,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customIntegration"] });
    },
  });
}

export function useDeleteCustomIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.integration.deleteCustomIntegration({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customIntegration"] });
    },
  });
}

export function useGetCustomAuthUrl() {
  return useMutation({
    mutationFn: ({ slug, redirectUrl }: { slug: string; redirectUrl: string }) =>
      client.integration.getCustomAuthUrl({ slug, redirectUrl }),
  });
}

// ========== INTEGRATION SKILL HOOKS ==========

export function useIntegrationSkillListBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ["integrationSkill", "listBySlug", slug],
    queryFn: () => client.integrationSkill.listBySlug({ slug: slug! }),
    enabled: !!slug,
  });
}

export function useResolvedIntegrationSkill(slug: string | undefined) {
  return useQuery({
    queryKey: ["integrationSkill", "resolved", slug],
    queryFn: () => client.integrationSkill.getResolvedForUser({ slug: slug! }),
    enabled: !!slug,
  });
}

export function useCreateIntegrationSkillFromChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      slug: string;
      title: string;
      description: string;
      files?: Array<{ path: string; content: string }>;
      setAsPreferred?: boolean;
    }) => client.integrationSkill.createFromChat(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrationSkill"] });
    },
  });
}

export function useSetIntegrationSkillPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      slug: string;
      preferredSource: "official" | "community";
      preferredSkillId?: string;
    }) => client.integrationSkill.setPreference(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrationSkill"] });
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
    }) =>
      client.skill.update({
        id,
        name,
        displayName,
        description,
        icon,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skill"] });
    },
  });
}

// Hook for deleting a skill
export function useDeleteSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
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
    mutationFn: ({ skillId, path, content }: { skillId: string; path: string; content: string }) =>
      client.skill.addFile({ skillId, path, content }),
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

// ========== WORKFLOW HOOKS ==========

export function useWorkflowList() {
  return useQuery({
    queryKey: ["workflow", "list"],
    queryFn: () => client.workflow.list(),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ["workflow", "get", id],
    queryFn: () => client.workflow.get({ id: id! }),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name?: string;
      triggerType: string;
      prompt: string;
      promptDo?: string;
      promptDont?: string;
      autoApprove?: boolean;
      allowedIntegrations: (
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
        | "linkedin"
        | "salesforce"
        | "reddit"
        | "twitter"
      )[];
    }) => client.workflow.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
  });
}

export type WorkflowSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      status?: "on" | "off";
      triggerType?: string;
      prompt?: string;
      promptDo?: string | null;
      promptDont?: string | null;
      autoApprove?: boolean;
      allowedIntegrations?: (
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
        | "linkedin"
        | "salesforce"
        | "reddit"
        | "twitter"
      )[];
      schedule?: WorkflowSchedule | null;
    }) => client.workflow.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- ORPC client delete, not a Drizzle query
    mutationFn: (id: string) => client.workflow.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
  });
}

export function useTriggerWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; payload?: unknown }) => client.workflow.trigger(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
  });
}

export function useWorkflowRun(id: string | undefined) {
  return useQuery({
    queryKey: ["workflow", "run", id],
    queryFn: () => client.workflow.getRun({ id: id! }),
    enabled: !!id,
  });
}

export function useWorkflowRuns(workflowId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ["workflow", "runs", workflowId, limit],
    queryFn: () => client.workflow.listRuns({ workflowId: workflowId!, limit }),
    enabled: !!workflowId,
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

// ========== PROVIDER AUTH HOOKS ==========

type SubscriptionProvider = "openai" | "google" | "kimi";
type OAuthSubscriptionProvider = "openai" | "google";

// Hook for getting connected subscription providers status
export function useProviderAuthStatus() {
  return useQuery({
    queryKey: ["providerAuth", "status"],
    queryFn: () => client.providerAuth.status(),
  });
}

// Hook for fetching free models available on OpenCode Zen
export function useOpencodeFreeModels() {
  return useQuery({
    queryKey: ["providerAuth", "freeModels"],
    queryFn: () => client.providerAuth.freeModels(),
    staleTime: 5 * 60 * 1000,
  });
}

// Hook for initiating subscription provider OAuth connection
export function useConnectProvider() {
  return useMutation({
    mutationFn: (provider: OAuthSubscriptionProvider) => client.providerAuth.connect({ provider }),
  });
}

// Hook for disconnecting a subscription provider
export function useDisconnectProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: SubscriptionProvider) => client.providerAuth.disconnect({ provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

// Hook for storing an API key-based subscription provider
export function useSetProviderApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: "kimi"; apiKey: string }) =>
      client.providerAuth.setApiKey({ provider, apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
    },
  });
}

// ========== GENERATION HOOKS ==========

// Hook for generation-based streaming (new persistent generation system)
export function useGeneration() {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  const startGeneration = useCallback(
    async (
      input: {
        conversationId?: string;
        content: string;
        model?: string;
        autoApprove?: boolean;
        deviceId?: string;
        attachments?: { name: string; mimeType: string; dataUrl: string }[];
      },
      callbacks: GenerationCallbacks,
    ): Promise<{ generationId: string; conversationId: string } | null> => {
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      let currentGenerationId: string | undefined;
      let currentConversationId: string | undefined;
      let retries = 0;

      try {
        const streamUntilDone = async (): Promise<{
          generationId: string;
          conversationId: string;
        } | null> => {
          if (signal.aborted) {
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }

          let streamNotReady = false;
          const result = await runGenerationStream({
            client,
            input: currentGenerationId ? undefined : input,
            generationId: currentGenerationId,
            signal,
            callbacks: {
              ...callbacks,
              onStarted: (generationId, conversationId) => {
                currentGenerationId = generationId;
                currentConversationId = conversationId;
                callbacks.onStarted?.(generationId, conversationId);
                queryClient.invalidateQueries({
                  queryKey: ["conversation", "list"],
                });
              },
              onDone: (generationId, conversationId, messageId, usage) => {
                callbacks.onDone?.(generationId, conversationId, messageId, usage);
                queryClient.invalidateQueries({ queryKey: ["conversation"] });
              },
              onError: (message) => {
                if (isStreamNotReadyError(message)) {
                  streamNotReady = true;
                  return;
                }
                callbacks.onError?.(message);
              },
            },
          });

          if (result) {
            currentGenerationId = result.generationId;
            currentConversationId = result.conversationId;
          }

          if (!streamNotReady) {
            return (
              result ??
              (currentGenerationId && currentConversationId
                ? {
                    generationId: currentGenerationId,
                    conversationId: currentConversationId,
                  }
                : null)
            );
          }

          if (retries >= STREAM_MAX_RETRIES) {
            callbacks.onError?.(STREAM_NOT_READY_ERROR);
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }

          retries += 1;
          const shouldContinue = await waitForRetry(signal, STREAM_RETRY_DELAY_MS);
          if (!shouldContinue) {
            return currentGenerationId && currentConversationId
              ? {
                  generationId: currentGenerationId,
                  conversationId: currentConversationId,
                }
              : null;
          }
          return streamUntilDone();
        };

        return streamUntilDone();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return null;
        }
        callbacks.onError?.(error instanceof Error ? error.message : "Unknown error");
        return null;
      } finally {
        abortControllerRef.current = null;
      }
    },
    [queryClient],
  );

  const subscribeToGeneration = useCallback(
    async (generationId: string, callbacks: GenerationCallbacks) => {
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      const currentGenerationId: string | undefined = generationId;
      let retries = 0;

      try {
        const streamUntilDone = async (): Promise<void> => {
          if (signal.aborted || !currentGenerationId) {
            return;
          }

          let streamNotReady = false;
          await runGenerationStream({
            client,
            generationId: currentGenerationId,
            signal,
            callbacks: {
              ...callbacks,
              onDone: (doneGenerationId, doneConversationId, messageId, usage) => {
                callbacks.onDone?.(doneGenerationId, doneConversationId, messageId, usage);
                queryClient.invalidateQueries({ queryKey: ["conversation"] });
              },
              onError: (message) => {
                if (isStreamNotReadyError(message)) {
                  streamNotReady = true;
                  return;
                }
                callbacks.onError?.(message);
              },
            },
          });

          if (!streamNotReady) {
            return;
          }

          if (retries >= STREAM_MAX_RETRIES) {
            callbacks.onError?.(STREAM_NOT_READY_ERROR);
            return;
          }

          retries += 1;
          const shouldContinue = await waitForRetry(signal, STREAM_RETRY_DELAY_MS);
          if (!shouldContinue) {
            return;
          }
          return streamUntilDone();
        };

        await streamUntilDone();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        callbacks.onError?.(error instanceof Error ? error.message : "Unknown error");
      } finally {
        abortControllerRef.current = null;
      }
    },
    [queryClient],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { startGeneration, subscribeToGeneration, abort };
}

// Hook for canceling a generation
export function useCancelGeneration() {
  return useMutation({
    mutationFn: (generationId: string) => client.generation.cancelGeneration({ generationId }),
  });
}

// Hook for submitting tool approval (new generation system)
export function useSubmitApproval() {
  return useMutation({
    mutationFn: ({
      generationId,
      toolUseId,
      decision,
      questionAnswers,
    }: {
      generationId: string;
      toolUseId: string;
      decision: "approve" | "deny";
      questionAnswers?: string[][];
    }) => client.generation.submitApproval({ generationId, toolUseId, decision, questionAnswers }),
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
    }) =>
      client.generation.submitAuthResult({
        generationId,
        integration,
        success,
      }),
  });
}

// Hook for getting active generation for a conversation
export function useActiveGeneration(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["generation", "active", conversationId],
    queryFn: () =>
      client.generation.getActiveGeneration({
        conversationId: conversationId!,
      }),
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

// Hook for downloading an attachment (returns presigned URL)
export function useDownloadAttachment() {
  return useMutation({
    mutationFn: (attachmentId: string) => client.conversation.downloadAttachment({ attachmentId }),
  });
}

// Hook for downloading a sandbox file (returns presigned URL)
export function useDownloadSandboxFile() {
  return useMutation({
    mutationFn: (fileId: string) => client.conversation.downloadSandboxFile({ fileId }),
  });
}

// Hook for getting sandbox files for a conversation
export function useSandboxFiles(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["sandboxFiles", conversationId],
    queryFn: () => client.conversation.getSandboxFiles({ conversationId: conversationId! }),
    enabled: !!conversationId,
  });
}

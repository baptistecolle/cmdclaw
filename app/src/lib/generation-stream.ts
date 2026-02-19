import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "../server/orpc";

export type ToolUseData = {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type ThinkingData = {
  content: string;
  thinkingId: string;
};

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

export type SandboxFileData = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type DoneArtifactsData = {
  timing?: {
    sandboxStartupDurationMs?: number;
    sandboxStartupMode?: "created" | "reused" | "unknown";
    generationDurationMs?: number;
    phaseDurationsMs?: {
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
  };
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles: SandboxFileData[];
};

export type GenerationStartInput = {
  conversationId?: string;
  content: string;
  model?: string;
  autoApprove?: boolean;
  deviceId?: string;
  selectedPlatformSkillSlugs?: string[];
  attachments?: { name: string; mimeType: string; dataUrl: string }[];
};

export type GenerationCallbacks = {
  onText?: (content: string) => void | Promise<void>;
  onThinking?: (data: ThinkingData) => void | Promise<void>;
  onToolUse?: (data: ToolUseData) => void | Promise<void>;
  onToolResult?: (toolName: string, result: unknown, toolUseId?: string) => void | Promise<void>;
  onPendingApproval?: (data: GenerationPendingApprovalData) => void | Promise<void>;
  onApprovalResult?: (toolUseId: string, decision: "approved" | "denied") => void | Promise<void>;
  onAuthNeeded?: (data: AuthNeededData) => void | Promise<void>;
  onAuthProgress?: (connected: string, remaining: string[]) => void | Promise<void>;
  onAuthResult?: (success: boolean, integrations?: string[]) => void | Promise<void>;
  onSandboxFile?: (data: SandboxFileData) => void | Promise<void>;
  onDone?: (
    generationId: string,
    conversationId: string,
    messageId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalCostUsd: number;
    },
    artifacts?: DoneArtifactsData,
  ) => void | Promise<void>;
  onStarted?: (generationId: string, conversationId: string) => void | Promise<void>;
  onError?: (message: string) => void | Promise<void>;
  onCancelled?: (data: {
    generationId: string;
    conversationId: string;
    messageId?: string;
  }) => void | Promise<void>;
  onStatusChange?: (status: string) => void | Promise<void>;
};

type RunGenerationStreamParams = {
  client: RouterClient<AppRouter>;
  input?: GenerationStartInput;
  generationId?: string;
  signal?: AbortSignal;
  callbacks: GenerationCallbacks;
};

export async function runGenerationStream(
  params: RunGenerationStreamParams,
): Promise<{ generationId: string; conversationId: string } | null> {
  const { client, input, callbacks, signal } = params;
  let generationId = params.generationId;
  let conversationId: string | undefined;

  if (input) {
    const started = await client.generation.startGeneration(input);
    generationId = started.generationId;
    conversationId = started.conversationId;
    await callbacks.onStarted?.(started.generationId, started.conversationId);
  }

  if (!generationId) {
    throw new Error("runGenerationStream requires either input or generationId");
  }

  const iterator = signal
    ? await client.generation.subscribeGeneration({ generationId }, { signal })
    : await client.generation.subscribeGeneration({ generationId });

  for await (const event of iterator) {
    if (signal?.aborted) {
      break;
    }

    switch (event.type) {
      case "text":
        await callbacks.onText?.(event.content);
        break;
      case "thinking":
        await callbacks.onThinking?.({
          content: event.content,
          thinkingId: event.thinkingId,
        });
        break;
      case "tool_use":
        await callbacks.onToolUse?.({
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolUseId: event.toolUseId,
          integration: event.integration,
          operation: event.operation,
          isWrite: event.isWrite,
        });
        break;
      case "tool_result":
        await callbacks.onToolResult?.(event.toolName, event.result, event.toolUseId);
        break;
      case "pending_approval":
        conversationId = event.conversationId;
        await callbacks.onPendingApproval?.({
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
        await callbacks.onApprovalResult?.(event.toolUseId, event.decision);
        break;
      case "auth_needed":
        conversationId = event.conversationId;
        await callbacks.onAuthNeeded?.({
          generationId: event.generationId,
          conversationId: event.conversationId,
          integrations: event.integrations,
          reason: event.reason,
        });
        break;
      case "auth_progress":
        await callbacks.onAuthProgress?.(event.connected, event.remaining);
        break;
      case "auth_result":
        await callbacks.onAuthResult?.(event.success, event.integrations);
        break;
      case "sandbox_file":
        await callbacks.onSandboxFile?.({
          fileId: event.fileId,
          path: event.path,
          filename: event.filename,
          mimeType: event.mimeType,
          sizeBytes: event.sizeBytes,
        });
        break;
      case "done":
        conversationId = event.conversationId;
        await callbacks.onDone?.(
          event.generationId,
          event.conversationId,
          event.messageId,
          event.usage,
          event.artifacts,
        );
        break;
      case "error":
        await callbacks.onError?.(event.message);
        break;
      case "cancelled":
        await callbacks.onCancelled?.({
          generationId: event.generationId,
          conversationId: event.conversationId,
          messageId: event.messageId,
        });
        break;
      case "status_change":
        await callbacks.onStatusChange?.(event.status);
        break;
    }
  }

  return conversationId && generationId ? { generationId, conversationId } : null;
}

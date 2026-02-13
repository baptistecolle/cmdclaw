import type {
  Event as OpencodeEvent,
  OpencodeClient,
  Part as OpencodePart,
  PermissionRequest,
  QuestionRequest,
  ToolPart,
} from "@opencode-ai/sdk/v2/client";
import type { Sandbox } from "e2b";
import { eq, asc } from "drizzle-orm";
import { and } from "drizzle-orm";
import path from "path";
import type { LLMBackend, ChatMessage, ContentBlock } from "@/server/ai/llm-backend";
import type { IntegrationType } from "@/server/oauth/config";
import type { SandboxBackend } from "@/server/sandbox/types";
import { env } from "@/env";
import { resolveDefaultOpencodeFreeModel } from "@/lib/zen-models";
import { AnthropicBackend } from "@/server/ai/anthropic-backend";
import { LocalLLMBackend } from "@/server/ai/local-backend";
import { OpenAIBackend } from "@/server/ai/openai-backend";
import { isOpencodeFreeModel } from "@/server/ai/opencode-models";
import { checkToolPermissions, parseBashCommand } from "@/server/ai/permission-checker";
import { getDirectModeTools, toolCallToCommand } from "@/server/ai/tools";
import { db } from "@/server/db/client";
import {
  conversation,
  generation,
  message,
  messageAttachment,
  workflowRun,
  workflowRunEvent,
  type ContentPart,
  type PendingApproval,
  type PendingAuth,
} from "@/server/db/schema";
import { customIntegrationCredential } from "@/server/db/schema";
import {
  getCliEnvForUser,
  getCliInstructions,
  getCliInstructionsWithCustom,
  getEnabledIntegrationTypes,
} from "@/server/integrations/cli-env";
import {
  getOrCreateSession,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox,
  getIntegrationSkillsSystemPrompt,
  resetOpencodeSession,
} from "@/server/sandbox/e2b";
import { getSandboxBackend } from "@/server/sandbox/factory";
import {
  createCommunityIntegrationSkill,
  resolvePreferredCommunitySkillsForUser,
} from "@/server/services/integration-skill-service";
import {
  buildMemorySystemPrompt,
  type MemoryFileType,
  readMemoryFile,
  searchMemoryWithSessions,
  syncMemoryToSandbox,
  writeMemoryEntry,
  writeSessionTranscriptFromConversation,
} from "@/server/services/memory-service";
import {
  uploadSandboxFile,
  collectNewSandboxFiles,
  collectNewE2BFiles,
  readSandboxFileAsBuffer,
} from "@/server/services/sandbox-file-service";
import {
  COMPACTION_SUMMARY_PREFIX,
  SESSION_BOUNDARY_PREFIX,
} from "@/server/services/session-constants";
import { generateConversationTitle } from "@/server/utils/generate-title";
import { createTraceId, logServerEvent } from "@/server/utils/observability";

function parseMemoryFileType(input: unknown): MemoryFileType | undefined {
  return input === "daily" || input === "longterm" ? input : undefined;
}

let cachedDefaultWorkflowModelPromise: Promise<string> | undefined;

async function resolveWorkflowModel(model?: string): Promise<string> {
  const configured = model?.trim();
  if (configured) {
    return configured;
  }

  if (!cachedDefaultWorkflowModelPromise) {
    cachedDefaultWorkflowModelPromise = resolveDefaultOpencodeFreeModel();
  }

  return cachedDefaultWorkflowModelPromise;
}

// Event types for generation stream
export type GenerationEvent =
  | { type: "text"; content: string }
  | {
      type: "tool_use";
      toolName: string;
      toolInput: unknown;
      toolUseId?: string;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "tool_result"; toolName: string; result: unknown; toolUseId?: string }
  | { type: "thinking"; content: string; thinkingId: string }
  | {
      type: "pending_approval";
      generationId: string;
      conversationId: string;
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
      integration: string;
      operation: string;
      command?: string;
    }
  | {
      type: "approval_result";
      toolUseId: string;
      decision: "approved" | "denied";
    }
  | {
      type: "auth_needed";
      generationId: string;
      conversationId: string;
      integrations: string[];
      reason?: string;
    }
  | {
      type: "auth_progress";
      connected: string;
      remaining: string[];
    }
  | { type: "auth_result"; success: boolean; integrations?: string[] }
  | {
      type: "sandbox_file";
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
      sizeBytes: number | null;
    }
  | {
      type: "done";
      generationId: string;
      conversationId: string;
      messageId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalCostUsd: number;
      };
    }
  | { type: "error"; message: string }
  | {
      type: "cancelled";
      generationId: string;
      conversationId: string;
      messageId?: string;
    }
  | { type: "status_change"; status: string };

type GenerationStatus =
  | "running"
  | "awaiting_approval"
  | "awaiting_auth"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

interface Subscriber {
  id: string;
  callback: (event: GenerationEvent) => void;
}

type BackendType = "opencode" | "direct";
type OpenCodeTrackedEvent = Extract<
  OpencodeEvent,
  {
    type: "message.updated" | "message.part.updated" | "session.updated" | "session.status";
  }
>;
type OpenCodeActionableEvent = Extract<
  OpencodeEvent,
  { type: "message.part.updated" | "permission.asked" | "question.asked" }
>;
type PendingOpenCodeApprovalRequest =
  | { kind: "permission"; request: PermissionRequest }
  | { kind: "question"; request: QuestionRequest; defaultAnswers: string[][] };

interface GenerationContext {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  sandboxId?: string;
  status: GenerationStatus;
  contentParts: ContentPart[];
  assistantContent: string;
  subscribers: Map<string, Subscriber>;
  abortController: AbortController;
  pendingApproval: PendingApproval | null;
  approvalTimeoutId?: ReturnType<typeof setTimeout>;
  approvalResolver?: (decision: "allow" | "deny") => void;
  pendingAuth: PendingAuth | null;
  authTimeoutId?: ReturnType<typeof setTimeout>;
  authResolver?: (result: { success: boolean; userId?: string }) => void;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  sessionId?: string;
  errorMessage?: string;
  startedAt: Date;
  lastSaveAt: Date;
  saveDebounceId?: ReturnType<typeof setTimeout>;
  isNewConversation: boolean;
  model: string;
  userMessageContent: string;
  // File attachments from user
  attachments?: { name: string; mimeType: string; dataUrl: string }[];
  // Track assistant message IDs to filter out user message parts
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<string, OpencodePart[]>;
  // BYOC fields
  backendType: BackendType;
  deviceId?: string;
  // Workflow fields
  workflowRunId?: string;
  allowedIntegrations?: IntegrationType[];
  autoApprove: boolean;
  // OpenCode approval request fields (for forwarding user decisions to OpenCode SDK)
  opencodePendingApprovalRequest?: PendingOpenCodeApprovalRequest;
  opencodeClient?: OpencodeClient;
  allowedCustomIntegrations?: string[];
  workflowPrompt?: string;
  workflowPromptDo?: string;
  workflowPromptDont?: string;
  triggerPayload?: unknown;
  // Sandbox file collection
  generationMarkerTime?: number;
  sandbox?: SandboxBackend;
  e2bSandbox?: import("e2b").Sandbox;
  sentFilePaths?: Set<string>;
  uploadedSandboxFileIds?: Set<string>;
  agentInitStartedAt?: number;
  agentInitReadyAt?: number;
  agentInitFailedAt?: number;
}

// Approval timeout: 5 minutes before pausing sandbox
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
// Auth timeout: 10 minutes for OAuth flow
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;
const AGENT_PREPARING_TIMEOUT_MS = (() => {
  const seconds = Number(process.env.AGENT_PREPARING_TIMEOUT_SECONDS ?? "300");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5 * 60 * 1000;
  }
  return Math.floor(seconds * 1000);
})();
// Save debounce interval for text chunks
const SAVE_DEBOUNCE_MS = 2000;
// Compaction + memory flush defaults
const COMPACTION_TRIGGER_TOKENS = 120_000;
const COMPACTION_KEEP_LAST_MESSAGES = 12;
const COMPACTION_MIN_MESSAGES = 8;
const MEMORY_FLUSH_TRIGGER_TOKENS = 100_000;
const COMPACTION_SUMMARY_MAX_TOKENS = 1800;
const MEMORY_FLUSH_MAX_ITERATIONS = 4;
const SESSION_RESET_COMMANDS = new Set(["/new"]);

const MEMORY_FLUSH_SYSTEM_PROMPT = [
  "You are performing a silent memory flush before compaction.",
  "Review the conversation and write durable facts, preferences, decisions, and TODOs using memory_write.",
  "Do not call any tools other than memory_write/memory_search/memory_get.",
  "Respond with NO_REPLY when finished.",
].join("\n");

const COMPACTION_SUMMARY_SYSTEM_PROMPT = [
  "Summarize the conversation so far for future context.",
  "Capture decisions, preferences, TODOs, open questions, important constraints, and key tool outputs.",
  "Be concise, factual, and keep the summary under 400 words.",
].join("\n");

function normalizePermissionPattern(pattern: string): string {
  return pattern.replace(/[\s*]+$/g, "").replace(/\/+$/, "");
}

function shouldAutoApproveOpenCodePermission(
  permissionType: string,
  patterns: string[] | undefined,
): boolean {
  if (!patterns?.length) {
    return false;
  }

  return patterns.every((pattern) => {
    const normalized = normalizePermissionPattern(pattern);

    // Always allow access to staged uploads directory.
    if (normalized.startsWith("/home/user/uploads")) {
      return true;
    }

    // OpenCode may ask external_directory for user files directly in /home/user.
    if (permissionType === "external_directory" && normalized.startsWith("/home/user")) {
      return true;
    }

    return false;
  });
}

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function isOpenCodeTrackedEvent(event: OpencodeEvent): event is OpenCodeTrackedEvent {
  return (
    event.type === "message.updated" ||
    event.type === "message.part.updated" ||
    event.type === "session.updated" ||
    event.type === "session.status"
  );
}

function isOpenCodeActionableEvent(event: OpencodeEvent): event is OpenCodeActionableEvent {
  return (
    event.type === "message.part.updated" ||
    event.type === "permission.asked" ||
    event.type === "question.asked"
  );
}

function buildDefaultQuestionAnswers(request: QuestionRequest): string[][] {
  return request.questions.map((question) => {
    const firstOptionLabel = question.options[0]?.label;
    if (firstOptionLabel) {
      return [firstOptionLabel];
    }
    if (question.custom === false) {
      return [];
    }
    return ["default answer"];
  });
}

function buildQuestionCommand(request: QuestionRequest): string {
  return request.questions
    .map((question) => {
      const options = question.options.map((option) => option.label).filter(Boolean);
      const optionsText = options.length > 0 ? ` [${options.join(" | ")}]` : "";
      return `${question.header}: ${question.question}${optionsText}`;
    })
    .join(" || ");
}

type MessageRow = typeof message.$inferSelect;

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function estimateTokensFromContentParts(parts: ContentPart[] | null | undefined): number {
  if (!parts || parts.length === 0) {
    return 0;
  }
  let total = 0;
  for (const part of parts) {
    switch (part.type) {
      case "text":
        total += estimateTokensFromText(part.text);
        break;
      case "tool_use":
        total += estimateTokensFromText(JSON.stringify(part.input ?? {}));
        break;
      case "tool_result":
        total += estimateTokensFromText(
          typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? {}),
        );
        break;
      case "thinking":
        total += estimateTokensFromText(part.content);
        break;
    }
  }
  return total;
}

function estimateTokensForMessageRow(m: MessageRow): number {
  const contentTokens = estimateTokensFromText(m.content || "");
  const partsTokens = estimateTokensFromContentParts(m.contentParts as ContentPart[] | undefined);
  return Math.max(contentTokens, partsTokens);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

class GenerationManager {
  private activeGenerations = new Map<string, GenerationContext>();
  private conversationToGeneration = new Map<string, string>();

  /**
   * Start a new generation for a conversation
   */
  async startGeneration(params: {
    conversationId?: string;
    content: string;
    model?: string;
    userId: string;
    autoApprove?: boolean;
    allowedIntegrations?: IntegrationType[];
    deviceId?: string;
    attachments?: { name: string; mimeType: string; dataUrl: string }[];
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model, autoApprove } = params;
    const traceId = createTraceId();
    const startGenerationStartedAt = Date.now();
    const logContext = {
      source: "generation-manager",
      traceId,
      userId,
      conversationId: params.conversationId,
    };
    logServerEvent(
      "info",
      "START_GENERATION_REQUESTED",
      {
        hasConversationId: Boolean(params.conversationId),
        hasDeviceId: Boolean(params.deviceId),
        hasAllowedIntegrations: params.allowedIntegrations !== undefined,
        attachmentsCount: params.attachments?.length ?? 0,
      },
      logContext,
    );

    // Check for existing active generation on this conversation
    if (params.conversationId) {
      const existingGenId = this.conversationToGeneration.get(params.conversationId);
      if (existingGenId) {
        const existing = this.activeGenerations.get(existingGenId);
        if (existing && existing.status === "running") {
          throw new Error("Generation already in progress for this conversation");
        }
      }
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "active_generation_check",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      logContext,
    );

    // Get or create conversation
    let conv: typeof conversation.$inferSelect;
    let isNewConversation = false;

    if (params.conversationId) {
      const existing = await db.query.conversation.findFirst({
        where: eq(conversation.id, params.conversationId),
      });
      if (!existing) {
        throw new Error("Conversation not found");
      }
      if (existing.userId !== userId) {
        throw new Error("Access denied");
      }
      if (typeof autoApprove === "boolean" && existing.autoApprove !== autoApprove) {
        const [updatedConversation] = await db
          .update(conversation)
          .set({ autoApprove })
          .where(eq(conversation.id, existing.id))
          .returning();
        conv = updatedConversation ?? { ...existing, autoApprove };
      } else {
        conv = existing;
      }
    } else {
      isNewConversation = true;
      const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      const [newConv] = await db
        .insert(conversation)
        .values({
          userId,
          title,
          type: "chat",
          model: model ?? "claude-sonnet-4-20250514",
          autoApprove: autoApprove ?? false,
        })
        .returning();
      conv = newConv;
    }
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_ready",
        elapsedMs: Date.now() - startGenerationStartedAt,
        resolvedConversationId: conv.id,
        isNewConversation,
      },
      { ...logContext, conversationId: conv.id },
    );

    // Save user message
    const [userMsg] = await db
      .insert(message)
      .values({
        conversationId: conv.id,
        role: "user",
        content,
      })
      .returning();
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "message_saved",
        elapsedMs: Date.now() - startGenerationStartedAt,
        messageId: userMsg.id,
      },
      { ...logContext, conversationId: conv.id },
    );

    // Upload attachments to S3 and save metadata
    if (params.attachments && params.attachments.length > 0) {
      try {
        const { uploadToS3, ensureBucket } = await import("@/server/storage/s3-client");
        await ensureBucket();
        await Promise.all(
          params.attachments.map(async (a) => {
            const base64Data = a.dataUrl.split(",")[1] || "";
            const buffer = Buffer.from(base64Data, "base64");
            const sanitizedFilename = a.name.replace(/[^a-zA-Z0-9.-]/g, "_");
            const storageKey = `attachments/${conv.id}/${userMsg.id}/${Date.now()}-${sanitizedFilename}`;
            await uploadToS3(storageKey, buffer, a.mimeType);
            await db.insert(messageAttachment).values({
              messageId: userMsg.id,
              filename: a.name,
              mimeType: a.mimeType,
              sizeBytes: buffer.length,
              storageKey,
            });
          }),
        );
        logServerEvent(
          "info",
          "START_GENERATION_PHASE_DONE",
          {
            phase: "attachments_uploaded",
            elapsedMs: Date.now() - startGenerationStartedAt,
            attachmentsCount: params.attachments.length,
          },
          { ...logContext, conversationId: conv.id },
        );
      } catch (err) {
        logServerEvent(
          "error",
          "START_GENERATION_ATTACHMENTS_UPLOAD_FAILED",
          {
            elapsedMs: Date.now() - startGenerationStartedAt,
            error: formatErrorMessage(err),
          },
          { ...logContext, conversationId: conv.id },
        );
      }
    }

    // Create generation record
    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: conv.id,
        status: "running",
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
      })
      .returning();
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "generation_record_created",
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: genRecord.id,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    // Update conversation status
    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: genRecord.id,
      })
      .where(eq(conversation.id, conv.id));
    logServerEvent(
      "info",
      "START_GENERATION_PHASE_DONE",
      {
        phase: "conversation_status_updated",
        elapsedMs: Date.now() - startGenerationStartedAt,
      },
      { ...logContext, conversationId: conv.id, generationId: genRecord.id },
    );

    // Determine backend type: if deviceId is provided, use direct mode
    const backendType: BackendType = params.deviceId ? "direct" : "opencode";

    // Create generation context
    const ctx: GenerationContext = {
      id: genRecord.id,
      traceId,
      conversationId: conv.id,
      userId,
      status: "running",
      contentParts: [],
      assistantContent: "",
      subscribers: new Map(),
      abortController: new AbortController(),
      pendingApproval: null,
      pendingAuth: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      startedAt: new Date(),
      lastSaveAt: new Date(),
      isNewConversation,
      model: model ?? conv.model ?? "claude-sonnet-4-20250514",
      userMessageContent: content,
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      backendType,
      deviceId: params.deviceId,
      allowedIntegrations: params.allowedIntegrations,
      autoApprove: conv.autoApprove,
      attachments: params.attachments,
      uploadedSandboxFileIds: new Set(),
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.conversationToGeneration.set(conv.id, genRecord.id);

    logServerEvent(
      "info",
      "GENERATION_ENQUEUED",
      { backendType },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );
    logServerEvent(
      "info",
      "START_GENERATION_RETURNING",
      {
        elapsedMs: Date.now() - startGenerationStartedAt,
        generationId: ctx.id,
      },
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );

    // Start the generation in the background
    this.runGeneration(ctx).catch((err) => {
      console.error("[GenerationManager] runGeneration error:", err);
    });

    return {
      generationId: genRecord.id,
      conversationId: conv.id,
    };
  }

  /**
   * Start a new workflow generation.
   */
  async startWorkflowGeneration(params: {
    workflowRunId: string;
    content: string;
    model?: string;
    userId: string;
    autoApprove: boolean;
    allowedIntegrations: IntegrationType[];
    allowedCustomIntegrations?: string[];
    workflowPrompt: string;
    workflowPromptDo?: string | null;
    workflowPromptDont?: string | null;
    triggerPayload: unknown;
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model } = params;
    const resolvedModel = await resolveWorkflowModel(model);

    const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    const [newConv] = await db
      .insert(conversation)
      .values({
        userId,
        title: title || "Workflow run",
        type: "workflow",
        model: resolvedModel,
        autoApprove: params.autoApprove,
      })
      .returning();

    await db.insert(message).values({
      conversationId: newConv.id,
      role: "user",
      content,
    });

    const [genRecord] = await db
      .insert(generation)
      .values({
        conversationId: newConv.id,
        status: "running",
        contentParts: [],
        inputTokens: 0,
        outputTokens: 0,
      })
      .returning();

    await db
      .update(conversation)
      .set({
        generationStatus: "generating",
        currentGenerationId: genRecord.id,
      })
      .where(eq(conversation.id, newConv.id));

    const ctx: GenerationContext = {
      id: genRecord.id,
      traceId: createTraceId(),
      conversationId: newConv.id,
      userId,
      status: "running",
      contentParts: [],
      assistantContent: "",
      subscribers: new Map(),
      abortController: new AbortController(),
      pendingApproval: null,
      pendingAuth: null,
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
      startedAt: new Date(),
      lastSaveAt: new Date(),
      isNewConversation: true,
      model: resolvedModel,
      userMessageContent: content,
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      backendType: "opencode",
      workflowRunId: params.workflowRunId,
      allowedIntegrations: params.allowedIntegrations,
      autoApprove: params.autoApprove,
      allowedCustomIntegrations: params.allowedCustomIntegrations,
      workflowPrompt: params.workflowPrompt,
      workflowPromptDo: params.workflowPromptDo ?? undefined,
      workflowPromptDont: params.workflowPromptDont ?? undefined,
      triggerPayload: params.triggerPayload,
      uploadedSandboxFileIds: new Set(),
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.conversationToGeneration.set(newConv.id, genRecord.id);

    logServerEvent(
      "info",
      "WORKFLOW_GENERATION_ENQUEUED",
      {},
      {
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
    );

    this.runGeneration(ctx).catch((err) => {
      console.error("[GenerationManager] runGeneration error:", err);
    });

    return {
      generationId: genRecord.id,
      conversationId: newConv.id,
    };
  }

  /**
   * Subscribe to a generation's events
   */
  async *subscribeToGeneration(
    generationId: string,
    userId: string,
  ): AsyncGenerator<GenerationEvent, void, unknown> {
    const ctx = this.activeGenerations.get(generationId);

    const buildTerminalEvents = (genRecord: typeof generation.$inferSelect): GenerationEvent[] => {
      const events: GenerationEvent[] = [];

      if (genRecord.contentParts) {
        for (const part of genRecord.contentParts) {
          if (part.type === "text") {
            events.push({ type: "text", content: part.text });
          } else if (part.type === "tool_use") {
            events.push({
              type: "tool_use",
              toolName: part.name,
              toolInput: part.input,
              toolUseId: part.id,
              integration: part.integration,
              operation: part.operation,
            });
          } else if (part.type === "tool_result") {
            const toolUse = genRecord.contentParts?.find(
              (p): p is ContentPart & { type: "tool_use" } =>
                p.type === "tool_use" && p.id === part.tool_use_id,
            );
            events.push({
              type: "tool_result",
              toolName: toolUse?.name ?? "unknown",
              result: part.content,
              toolUseId: part.tool_use_id,
            });
          } else if (part.type === "thinking") {
            events.push({
              type: "thinking",
              content: part.content,
              thinkingId: part.id,
            });
          }
        }
      }

      if (genRecord.status === "completed" && genRecord.messageId) {
        events.push({
          type: "done",
          generationId: genRecord.id,
          conversationId: genRecord.conversationId,
          messageId: genRecord.messageId,
          usage: {
            inputTokens: genRecord.inputTokens,
            outputTokens: genRecord.outputTokens,
            totalCostUsd: 0,
          },
        });
      } else if (genRecord.status === "cancelled") {
        events.push({
          type: "cancelled",
          generationId: genRecord.id,
          conversationId: genRecord.conversationId,
          messageId: genRecord.messageId ?? undefined,
        });
      } else if (genRecord.status === "error") {
        events.push({
          type: "error",
          message: genRecord.errorMessage || "Unknown error",
        });
      }

      return events;
    };

    // If no active context, check database for completed/partial generation
    if (!ctx) {
      const genRecord = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
        with: { conversation: true },
      });

      if (!genRecord) {
        yield { type: "error", message: "Generation not found" };
        return;
      }

      // Check access
      if (genRecord.conversation.userId !== userId) {
        yield { type: "error", message: "Access denied" };
        return;
      }

      // If generation is completed/cancelled/error, return final state
      if (
        genRecord.status === "completed" ||
        genRecord.status === "cancelled" ||
        genRecord.status === "error"
      ) {
        for (const event of buildTerminalEvents(genRecord)) {
          yield event;
        }
        return;
      }

      // Non-terminal generation exists in DB but this process has no in-memory context.
      // This can happen in multi-process deployments (e.g. workflow worker + web server).
      // Poll DB for terminal state instead of immediately marking it as error.
      const orphanedStatuses = new Set<GenerationStatus>([
        "running",
        "awaiting_approval",
        "awaiting_auth",
        "paused",
      ]);

      if (orphanedStatuses.has(genRecord.status as GenerationStatus)) {
        logServerEvent(
          "warn",
          "GENERATION_CONTEXT_MISSING_IN_MEMORY",
          {
            previousStatus: genRecord.status,
            conversationType: genRecord.conversation.type,
          },
          {
            source: "generation-manager",
            generationId: genRecord.id,
            conversationId: genRecord.conversationId,
            userId,
          },
        );

        const pollIntervalMs = 500;
        const heartbeatIntervalMs = 10_000;
        const maxWaitMs = genRecord.conversation.type === "workflow" ? 10 * 60 * 1000 : 30_000;
        const startedAt = Date.now();
        let lastHeartbeatAt = 0;
        let lastStatus: typeof generation.$inferSelect.status = genRecord.status;
        let emittedPendingApprovalToolUseId: string | null = null;

        yield { type: "status_change", status: genRecord.status };

        const pollForTerminal = async function* (): AsyncGenerator<GenerationEvent, void, unknown> {
          if (Date.now() - startedAt >= maxWaitMs) {
            return;
          }

          await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));

          const latest = await db.query.generation.findFirst({
            where: eq(generation.id, generationId),
          });

          if (!latest) {
            yield { type: "error", message: "Generation not found" };
            return;
          }

          if (latest.status !== lastStatus) {
            lastStatus = latest.status;
            yield { type: "status_change", status: latest.status };
          } else if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
            lastHeartbeatAt = Date.now();
            yield { type: "status_change", status: latest.status };
          }

          if (latest.status === "awaiting_approval" && latest.pendingApproval) {
            const pendingApproval = latest.pendingApproval as PendingApproval;
            if (emittedPendingApprovalToolUseId !== pendingApproval.toolUseId) {
              emittedPendingApprovalToolUseId = pendingApproval.toolUseId;
              yield {
                type: "pending_approval",
                generationId: latest.id,
                conversationId: latest.conversationId,
                toolUseId: pendingApproval.toolUseId,
                toolName: pendingApproval.toolName,
                toolInput: pendingApproval.toolInput,
                integration: pendingApproval.integration,
                operation: pendingApproval.operation,
                command: pendingApproval.command,
              };
            }
          }

          if (
            latest.status === "completed" ||
            latest.status === "cancelled" ||
            latest.status === "error"
          ) {
            for (const event of buildTerminalEvents(latest)) {
              yield event;
            }
            return;
          }

          yield* pollForTerminal();
        };

        yield* pollForTerminal();

        const errorMessage =
          "Generation is still processing but cannot be streamed from this server yet. Please refresh shortly.";
        logServerEvent(
          "warn",
          "GENERATION_STREAM_POLL_TIMEOUT",
          {
            status: lastStatus,
            maxWaitMs,
            conversationType: genRecord.conversation.type,
          },
          {
            source: "generation-manager",
            generationId: genRecord.id,
            conversationId: genRecord.conversationId,
            userId,
          },
        );

        yield { type: "error", message: errorMessage };
        return;
      }

      yield { type: "status_change", status: genRecord.status };
      return;
    }

    // Check access
    if (ctx.userId !== userId) {
      yield { type: "error", message: "Access denied" };
      return;
    }

    // Create subscriber
    const subscriberId = crypto.randomUUID();
    const eventQueue: GenerationEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let isUnsubscribed = false;

    const subscriber: Subscriber = {
      id: subscriberId,
      callback: (event) => {
        eventQueue.push(event);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      },
    };

    // Replay existing content parts
    for (const part of ctx.contentParts) {
      if (part.type === "text") {
        eventQueue.push({ type: "text", content: part.text });
      } else if (part.type === "tool_use") {
        eventQueue.push({
          type: "tool_use",
          toolName: part.name,
          toolInput: part.input,
          toolUseId: part.id,
        });
      } else if (part.type === "tool_result") {
        const toolUse = ctx.contentParts.find(
          (p): p is ContentPart & { type: "tool_use" } =>
            p.type === "tool_use" && p.id === part.tool_use_id,
        );
        eventQueue.push({
          type: "tool_result",
          toolName: toolUse?.name ?? "unknown",
          result: part.content,
          toolUseId: part.tool_use_id,
        });
      } else if (part.type === "thinking") {
        eventQueue.push({
          type: "thinking",
          content: part.content,
          thinkingId: part.id,
        });
      }
    }

    // If pending approval, send that event
    if (ctx.agentInitStartedAt) {
      eventQueue.push({ type: "status_change", status: "agent_init_started" });
    }
    if (ctx.agentInitReadyAt) {
      eventQueue.push({ type: "status_change", status: "agent_init_ready" });
    }
    if (ctx.agentInitFailedAt) {
      eventQueue.push({ type: "status_change", status: "agent_init_failed" });
    }

    // If pending approval, send that event
    if (ctx.pendingApproval) {
      eventQueue.push({
        type: "pending_approval",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        toolUseId: ctx.pendingApproval.toolUseId,
        toolName: ctx.pendingApproval.toolName,
        toolInput: ctx.pendingApproval.toolInput,
        integration: ctx.pendingApproval.integration ?? "",
        operation: ctx.pendingApproval.operation ?? "",
        command: ctx.pendingApproval.command,
      });
    }

    // If pending auth, send that event
    if (ctx.pendingAuth) {
      eventQueue.push({
        type: "auth_needed",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        integrations: ctx.pendingAuth.integrations,
        reason: ctx.pendingAuth.reason,
      });
    }

    ctx.subscribers.set(subscriberId, subscriber);

    try {
      const waitForMoreEvents = () =>
        new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 100);
        });

      const streamEvents = async function* (): AsyncGenerator<GenerationEvent, void, unknown> {
        if (isUnsubscribed) {
          return;
        }

        // Yield all queued events
        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;

          // Check for terminal events
          if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
            isUnsubscribed = true;
            return;
          }
        }

        // Check if generation is complete
        if (ctx.status === "completed" || ctx.status === "cancelled" || ctx.status === "error") {
          return;
        }

        await waitForMoreEvents();
        yield* streamEvents();
      };

      yield* streamEvents();
    } finally {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
      ctx.subscribers.delete(subscriberId);
    }
  }

  /**
   * Cancel a generation
   */
  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return false;
    }

    if (ctx.userId !== userId) {
      throw new Error("Access denied");
    }

    ctx.abortController.abort();
    await this.finishGeneration(ctx, "cancelled");
    return true;
  }

  /**
   * Submit an approval decision
   */
  async submitApproval(
    generationId: string,
    toolUseId: string,
    decision: "approve" | "deny",
    userId: string,
    questionAnswers?: string[][],
  ): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord && !ctx) {
      return false;
    }
    const recordUserId = genRecord?.conversation.userId ?? ctx?.userId;
    if (!recordUserId || recordUserId !== userId) {
      throw new Error("Access denied");
    }

    const pending =
      (genRecord?.pendingApproval as PendingApproval | null) ??
      (ctx?.pendingApproval as PendingApproval | null);
    if (!pending || pending.toolUseId !== toolUseId) {
      return false;
    }

    // Forward decision to OpenCode SDK if this was an OpenCode permission/question request.
    // These requests are process-local SDK callbacks, so we keep the direct in-memory path.
    if (ctx?.opencodePendingApprovalRequest && ctx.opencodeClient) {
      try {
        switch (ctx.opencodePendingApprovalRequest.kind) {
          case "permission": {
            await ctx.opencodeClient.permission.reply({
              requestID: ctx.opencodePendingApprovalRequest.request.id,
              reply: decision === "approve" ? "always" : "reject",
            });
            console.log(
              "[GenerationManager] OpenCode permission",
              decision === "approve" ? "approved" : "denied",
              ctx.opencodePendingApprovalRequest.request.id,
            );
            break;
          }
          case "question": {
            if (decision === "approve") {
              const normalizedAnswers =
                questionAnswers
                  ?.map((answers) =>
                    answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
                  )
                  .filter((answers) => answers.length > 0) ?? [];
              await ctx.opencodeClient.question.reply({
                requestID: ctx.opencodePendingApprovalRequest.request.id,
                answers:
                  normalizedAnswers.length > 0
                    ? normalizedAnswers
                    : ctx.opencodePendingApprovalRequest.defaultAnswers,
              });
            } else {
              await ctx.opencodeClient.question.reject({
                requestID: ctx.opencodePendingApprovalRequest.request.id,
              });
            }
            console.log(
              "[GenerationManager] OpenCode question",
              decision === "approve" ? "answered" : "rejected",
              ctx.opencodePendingApprovalRequest.request.id,
            );
            break;
          }
          default:
            assertNever(ctx.opencodePendingApprovalRequest);
        }
      } catch (err) {
        console.error("[GenerationManager] Failed to submit OpenCode approval:", err);
      }
      ctx.opencodePendingApprovalRequest = undefined;
      ctx.opencodeClient = undefined;
      await db
        .update(generation)
        .set({
          status: "running",
          pendingApproval: null,
        })
        .where(eq(generation.id, generationId));
      await db
        .update(conversation)
        .set({ generationStatus: "generating" })
        .where(eq(conversation.id, genRecord?.conversationId ?? ctx.conversationId));
      if (ctx.workflowRunId) {
        await db
          .update(workflowRun)
          .set({ status: "running" })
          .where(eq(workflowRun.id, ctx.workflowRunId));
      }
      ctx.pendingApproval = null;
      ctx.status = "running";
      this.broadcast(ctx, {
        type: "approval_result",
        toolUseId,
        decision: decision === "approve" ? "approved" : "denied",
      });
      return true;
    }

    await db
      .update(generation)
      .set({
        pendingApproval: {
          ...pending,
          decision: decision === "approve" ? "allow" : "deny",
        },
      })
      .where(eq(generation.id, generationId));

    return true;
  }

  /**
   * Get the current generation for a conversation
   */
  getGenerationForConversation(conversationId: string): string | undefined {
    const mappedGenerationId = this.conversationToGeneration.get(conversationId);
    if (mappedGenerationId) {
      return mappedGenerationId;
    }

    // Self-heal when mapping is missing but active context still exists in-memory.
    for (const [generationId, ctx] of this.activeGenerations) {
      if (ctx.conversationId === conversationId) {
        this.conversationToGeneration.set(conversationId, generationId);
        return generationId;
      }
    }

    return undefined;
  }

  /**
   * Get allowed integrations for a conversation (if restricted).
   */
  getAllowedIntegrationsForConversation(conversationId: string): IntegrationType[] | null {
    const genId = this.getGenerationForConversation(conversationId);
    if (!genId) {
      return null;
    }
    const ctx = this.activeGenerations.get(genId);
    if (!ctx || ctx.allowedIntegrations === undefined) {
      return null;
    }
    return ctx.allowedIntegrations;
  }

  /**
   * Get generation status
   */
  async getGenerationStatus(generationId: string): Promise<{
    status: GenerationStatus;
    contentParts: ContentPart[];
    pendingApproval: PendingApproval | null;
    usage: { inputTokens: number; outputTokens: number };
  } | null> {
    const ctx = this.activeGenerations.get(generationId);
    if (ctx) {
      return {
        status: ctx.status,
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        usage: {
          inputTokens: ctx.usage.inputTokens,
          outputTokens: ctx.usage.outputTokens,
        },
      };
    }

    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });

    if (!genRecord) {
      return null;
    }

    return {
      status: genRecord.status as GenerationStatus,
      contentParts: genRecord.contentParts ?? [],
      pendingApproval: genRecord.pendingApproval ?? null,
      usage: {
        inputTokens: genRecord.inputTokens,
        outputTokens: genRecord.outputTokens,
      },
    };
  }

  // ========== Private Methods ==========

  /**
   * Dispatch generation to the appropriate backend.
   */
  private async runGeneration(ctx: GenerationContext): Promise<void> {
    const trimmed = ctx.userMessageContent.trim();
    if (SESSION_RESET_COMMANDS.has(trimmed)) {
      await this.handleSessionReset(ctx);
      return;
    }
    if (ctx.backendType === "direct") {
      return this.runDirectGeneration(ctx);
    }
    return this.runOpenCodeGeneration(ctx);
  }

  private async handleSessionReset(ctx: GenerationContext): Promise<void> {
    try {
      await writeSessionTranscriptFromConversation({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        source: "manual_reset",
        messageLimit: 15,
        excludeUserMessages: Array.from(SESSION_RESET_COMMANDS),
      });
    } catch (err) {
      console.error("[GenerationManager] Failed to write session transcript:", err);
    }

    await db.insert(message).values({
      conversationId: ctx.conversationId,
      role: "system",
      content: `${SESSION_BOUNDARY_PREFIX}\n${new Date().toISOString()}`,
    });

    await db
      .update(conversation)
      .set({ opencodeSessionId: null })
      .where(eq(conversation.id, ctx.conversationId));

    resetOpencodeSession(ctx.conversationId);
    ctx.sessionId = undefined;

    ctx.assistantContent = "Started a new session.";
    ctx.contentParts = [{ type: "text", text: ctx.assistantContent }];

    await this.finishGeneration(ctx, "completed");
  }

  /**
   * Original E2B/OpenCode generation flow. Delegates everything to OpenCode inside E2B sandbox.
   */
  private async runOpenCodeGeneration(ctx: GenerationContext): Promise<void> {
    try {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      // Get user's CLI environment and integrations
      const [cliEnv, enabledIntegrations] = await Promise.all([
        getCliEnvForUser(ctx.userId),
        getEnabledIntegrationTypes(ctx.userId),
      ]);

      const allowedIntegrations = ctx.allowedIntegrations ?? enabledIntegrations;

      const cliInstructions = await getCliInstructionsWithCustom(allowedIntegrations, ctx.userId);
      const filteredCliEnv =
        ctx.allowedIntegrations !== undefined
          ? Object.fromEntries(
              Object.entries(cliEnv).filter(([key]) => {
                const envToIntegration: Record<string, IntegrationType> = {
                  GMAIL_ACCESS_TOKEN: "gmail",
                  GOOGLE_CALENDAR_ACCESS_TOKEN: "google_calendar",
                  GOOGLE_DOCS_ACCESS_TOKEN: "google_docs",
                  GOOGLE_SHEETS_ACCESS_TOKEN: "google_sheets",
                  GOOGLE_DRIVE_ACCESS_TOKEN: "google_drive",
                  NOTION_ACCESS_TOKEN: "notion",
                  LINEAR_ACCESS_TOKEN: "linear",
                  GITHUB_ACCESS_TOKEN: "github",
                  AIRTABLE_ACCESS_TOKEN: "airtable",
                  SLACK_ACCESS_TOKEN: "slack",
                  HUBSPOT_ACCESS_TOKEN: "hubspot",
                  SALESFORCE_ACCESS_TOKEN: "salesforce",
                  LINKEDIN_ACCOUNT_ID: "linkedin",
                  UNIPILE_API_KEY: "linkedin",
                  UNIPILE_DSN: "linkedin",
                };
                const integration = envToIntegration[key];
                return integration ? ctx.allowedIntegrations!.includes(integration) : true;
              }),
            )
          : cliEnv;

      if (ctx.allowedIntegrations !== undefined) {
        filteredCliEnv.ALLOWED_INTEGRATIONS = ctx.allowedIntegrations.join(",");
      }

      // Get conversation for existing session info
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
      });

      // Determine if we need to replay history (existing conversation)
      const hasExistingMessages = !!conv?.opencodeSessionId;

      // Get or create sandbox with OpenCode session
      const agentInitStartedAt = Date.now();
      const agentInitWarnAfterMs = 15_000;
      ctx.agentInitStartedAt = agentInitStartedAt;
      ctx.agentInitReadyAt = undefined;
      ctx.agentInitFailedAt = undefined;
      this.broadcast(ctx, {
        type: "status_change",
        status: "agent_init_started",
      });
      logServerEvent(
        "info",
        "AGENT_INIT_STARTED",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      const agentInitWarnTimer = setTimeout(() => {
        const elapsedMs = Date.now() - agentInitStartedAt;
        logServerEvent(
          "warn",
          "AGENT_INIT_SLOW",
          { elapsedMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      }, agentInitWarnAfterMs);

      let client: Awaited<ReturnType<typeof getOrCreateSession>>["client"];
      let sessionId: string;
      let sandbox: import("e2b").Sandbox;
      try {
        const session = await withTimeout(
          getOrCreateSession(
            {
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              anthropicApiKey: env.ANTHROPIC_API_KEY,
              integrationEnvs: filteredCliEnv,
            },
            {
              title: conv?.title || "Conversation",
              replayHistory: hasExistingMessages,
              telemetry: {
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
              },
              onLifecycle: (stage, details) => {
                const status = `agent_init_${stage}`;
                this.broadcast(ctx, { type: "status_change", status });
                const lifecycleEvent = status.toUpperCase();
                logServerEvent("info", lifecycleEvent, details ?? {}, {
                  source: "generation-manager",
                  traceId: ctx.traceId,
                  generationId: ctx.id,
                  conversationId: ctx.conversationId,
                  userId: ctx.userId,
                });
              },
            },
          ),
          AGENT_PREPARING_TIMEOUT_MS,
          `Agent preparation timed out after ${Math.round(AGENT_PREPARING_TIMEOUT_MS / 1000)} seconds.`,
        );
        client = session.client;
        sessionId = session.sessionId;
        sandbox = session.sandbox;
        ctx.agentInitReadyAt = Date.now();
        this.broadcast(ctx, {
          type: "status_change",
          status: "agent_init_ready",
        });
        const durationMs = ctx.agentInitReadyAt - agentInitStartedAt;
        logServerEvent(
          "info",
          "AGENT_INIT_READY",
          { durationMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId,
            sandboxId: sandbox.sandboxId,
          },
        );
      } catch (error) {
        ctx.agentInitFailedAt = Date.now();
        this.broadcast(ctx, {
          type: "status_change",
          status: "agent_init_failed",
        });
        const durationMs = ctx.agentInitFailedAt - agentInitStartedAt;
        logServerEvent(
          "error",
          "AGENT_INIT_FAILED",
          {
            durationMs,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        throw error;
      } finally {
        clearTimeout(agentInitWarnTimer);
      }

      // Store session ID
      ctx.sessionId = sessionId;

      // Record marker time for file collection and store sandbox reference
      ctx.generationMarkerTime = Date.now();
      ctx.e2bSandbox = sandbox;
      ctx.sentFilePaths = new Set();

      // Write skills to sandbox
      const writtenSkills = await writeSkillsToSandbox(sandbox, ctx.userId);
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);
      let integrationSkillsInstructions = "";

      // Write memory files to sandbox
      let memoryInstructions = buildMemorySystemPrompt();
      try {
        await syncMemoryToSandbox(
          ctx.userId,
          async (path, content) => {
            await sandbox.files.write(path, content);
          },
          async (dir) => {
            await sandbox.commands.run(`mkdir -p "${dir}"`);
          },
        );
      } catch (err) {
        console.error("[GenerationManager] Failed to sync memory to sandbox:", err);
        memoryInstructions = buildMemorySystemPrompt();
      }

      // Write custom integration CLI code to sandbox
      try {
        const customCreds = await db.query.customIntegrationCredential.findMany({
          where: and(
            eq(customIntegrationCredential.userId, ctx.userId),
            eq(customIntegrationCredential.enabled, true),
          ),
          with: { customIntegration: true },
        });

        const eligibleCustomCreds = customCreds.filter((cred) => {
          if (!ctx.allowedCustomIntegrations) {
            return true;
          }
          return ctx.allowedCustomIntegrations.includes(cred.customIntegration.slug);
        });

        await Promise.all(
          eligibleCustomCreds.map(async (cred) => {
            const integ = cred.customIntegration;
            const cliPath = `/app/cli/custom-${integ.slug}.ts`;
            await sandbox.files.write(cliPath, integ.cliCode);
          }),
        );

        const customPerms: Record<string, { read: string[]; write: string[] }> = {};
        for (const cred of eligibleCustomCreds) {
          const integ = cred.customIntegration;
          customPerms[`custom-${integ.slug}`] = {
            read: integ.permissions.readOps,
            write: integ.permissions.writeOps,
          };
        }

        if (Object.keys(customPerms).length > 0) {
          // Set the permissions env var on the sandbox
          await sandbox.commands.run(
            `echo 'export CUSTOM_INTEGRATION_PERMISSIONS=${JSON.stringify(JSON.stringify(customPerms)).slice(1, -1)}' >> ~/.bashrc`,
          );
        }

        const allowedSkillSlugs = new Set<string>(allowedIntegrations);
        for (const cred of eligibleCustomCreds) {
          allowedSkillSlugs.add(cred.customIntegration.slug);
        }

        const writtenIntegrationSkills = await writeResolvedIntegrationSkillsToSandbox(
          sandbox,
          ctx.userId,
          Array.from(allowedSkillSlugs),
        );
        integrationSkillsInstructions = getIntegrationSkillsSystemPrompt(writtenIntegrationSkills);
      } catch (e) {
        console.error("[Generation] Failed to write custom integration CLI code:", e);
      }

      // Build system prompt
      const baseSystemPrompt = "You are Bap, an AI agent that helps do work.";
      const fileShareInstructions = [
        "## File Sharing",
        "When you create files that the user needs (PDFs, images, documents, code files, etc.), ",
        "save them to /app or /home/user. Files created during your response will automatically ",
        "be made available for download in the chat interface.",
      ].join("");
      const workflowPrompt = this.buildWorkflowPrompt(ctx);
      const integrationSkillDraftInstructions = this.getIntegrationSkillDraftInstructions();
      const systemPromptParts = [
        baseSystemPrompt,
        fileShareInstructions,
        cliInstructions,
        skillsInstructions,
        integrationSkillsInstructions,
        integrationSkillDraftInstructions,
        memoryInstructions,
        workflowPrompt,
      ].filter(Boolean);
      const systemPrompt = systemPromptParts.join("\n\n");

      let currentTextPart: { type: "text"; text: string } | null = null;
      let currentTextPartId: string | null = null;
      const verboseOpenCodeEventLogs = process.env.OPENCODE_VERBOSE_EVENTS === "1";
      let opencodeEventCount = 0;
      let opencodeToolCallCount = 0;
      let opencodePermissionCount = 0;
      let opencodeQuestionCount = 0;
      let stagedUploadCount = 0;
      let stagedUploadFailureCount = 0;

      // Subscribe to SSE events BEFORE sending the prompt
      const eventResult = await client.event.subscribe();
      const eventStream = eventResult.stream;

      // Resolve provider from model ID
      const modelConfig = {
        providerID: await resolveProviderID(ctx.model),
        modelID: ctx.model,
      };

      // Build prompt parts (text + file attachments)
      // For non-image files, write them to the sandbox so the LLM can process them
      // via sandbox tools, rather than passing unsupported media types directly.
      const promptParts: NonNullable<Parameters<typeof client.session.prompt>[0]["parts"]> = [
        { type: "text", text: ctx.userMessageContent },
      ];
      if (ctx.attachments && ctx.attachments.length > 0) {
        await Promise.all(
          ctx.attachments.map(async (a) => {
            if (a.mimeType.startsWith("image/")) {
              promptParts.push({
                type: "file",
                mime: a.mimeType,
                url: a.dataUrl,
                filename: a.name,
              });
              return;
            }

            // Write non-image file to sandbox and tell the LLM where it is
            const sandboxPath = `/home/user/uploads/${a.name}`;
            try {
              const base64Data = a.dataUrl.split(",")[1] || "";
              const buffer = Buffer.from(base64Data, "base64");
              await sandbox.files.write(
                sandboxPath,
                buffer.buffer.slice(
                  buffer.byteOffset,
                  buffer.byteOffset + buffer.byteLength,
                ) as ArrayBuffer,
              );
              promptParts.push({
                type: "text",
                text: `The user uploaded a file: ${sandboxPath} (${a.mimeType}). You can read and process it using the sandbox tools.`,
              });
              stagedUploadCount += 1;
            } catch (err) {
              stagedUploadFailureCount += 1;
              console.error(
                `[GenerationManager] Failed to write file to sandbox: ${sandboxPath}`,
                err,
              );
              promptParts.push({
                type: "text",
                text: `The user tried to upload a file "${a.name}" but it could not be written to the sandbox.`,
              });
            }
          }),
        );
      }
      if (stagedUploadCount > 0 || stagedUploadFailureCount > 0) {
        logServerEvent(
          "info",
          "ATTACHMENTS_STAGED",
          { stagedUploadCount, stagedUploadFailureCount },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId,
          },
        );
      }

      // Send the prompt to OpenCode
      logServerEvent(
        "info",
        "OPENCODE_PROMPT_SENT",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId,
        },
      );
      const promptPromise = client.session.prompt({
        sessionID: sessionId,
        parts: promptParts,
        system: systemPrompt,
        model: modelConfig,
      });

      // Process SSE events
      for await (const rawEvent of eventStream) {
        const event = rawEvent as OpencodeEvent;
        if (ctx.abortController.signal.aborted) {
          break;
        }

        opencodeEventCount += 1;

        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          if (part.type === "tool" && part.state.status === "pending") {
            opencodeToolCallCount += 1;
          }
        }

        if (verboseOpenCodeEventLogs) {
          const eventJson = JSON.stringify(event.properties || {});
          console.log("[OpenCode Event]", event.type, eventJson.slice(0, 200));
        } else if (
          event.type === "server.connected" ||
          event.type === "session.error" ||
          event.type === "session.idle"
        ) {
          console.info(
            `[OpenCode][EVENT] type=${event.type} generationId=${ctx.id} conversationId=${ctx.conversationId}`,
          );
        }

        // Transform tracked OpenCode events to GenerationEvents
        if (isOpenCodeTrackedEvent(event)) {
          await this.processOpencodeEvent(
            ctx,
            event,
            currentTextPart,
            currentTextPartId,
            (part, partId) => {
              currentTextPart = part;
              currentTextPartId = partId;
            },
          );
        }

        if (isOpenCodeActionableEvent(event)) {
          const actionableResult = await this.handleOpenCodeActionableEvent(ctx, client, event);
          if (actionableResult.type === "permission") {
            opencodePermissionCount += 1;
          } else if (actionableResult.type === "question") {
            opencodeQuestionCount += 1;
          }
        }

        // Check for session idle (generation complete)
        if (event.type === "session.idle") {
          console.log("[GenerationManager] Session idle - generation complete");
          break;
        }

        // Check for session error
        if (event.type === "session.error") {
          const eventProps =
            typeof event.properties === "object" && event.properties !== null
              ? (event.properties as Record<string, unknown>)
              : {};
          const error = eventProps.error ?? "Unknown error";
          const errorObj =
            typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
          const nestedData =
            errorObj && typeof errorObj.data === "object" && errorObj.data !== null
              ? (errorObj.data as Record<string, unknown>)
              : null;
          const errorMessage =
            typeof error === "string"
              ? error
              : typeof nestedData?.message === "string"
                ? nestedData.message
                : typeof errorObj?.message === "string"
                  ? errorObj.message
                  : JSON.stringify(error);
          throw new Error(errorMessage);
        }
      }

      // Wait for prompt to complete
      await promptPromise;

      if (ctx.e2bSandbox) {
        try {
          await this.importIntegrationSkillDraftsFromE2B(ctx, ctx.e2bSandbox);
        } catch (error) {
          console.error(
            "[GenerationManager] Failed to import integration skill drafts from E2B:",
            error,
          );
        }
      }

      // Collect new files created in the sandbox during generation
      let uploadedSandboxFileCount = 0;
      if (ctx.e2bSandbox && ctx.generationMarkerTime) {
        try {
          const newFiles = await collectNewE2BFiles(
            ctx.e2bSandbox,
            ctx.generationMarkerTime,
            Array.from(ctx.sentFilePaths || []),
          );

          console.log(`[GenerationManager] Found ${newFiles.length} new files in E2B sandbox`);

          await Promise.all(
            newFiles.map(async (file) => {
              try {
                const fileRecord = await uploadSandboxFile({
                  path: file.path,
                  content: file.content,
                  conversationId: ctx.conversationId,
                });
                ctx.uploadedSandboxFileIds?.add(fileRecord.id);

                // Broadcast sandbox_file event so UI can update
                this.broadcast(ctx, {
                  type: "sandbox_file",
                  fileId: fileRecord.id,
                  path: file.path,
                  filename: fileRecord.filename,
                  mimeType: fileRecord.mimeType,
                  sizeBytes: fileRecord.sizeBytes,
                });

                uploadedSandboxFileCount += 1;
              } catch (err) {
                console.error(
                  `[GenerationManager] Failed to upload sandbox file ${file.path}:`,
                  err,
                );
              }
            }),
          );
        } catch (err) {
          console.error("[GenerationManager] Failed to collect sandbox files:", err);
        }
      }

      // Check if aborted
      if (ctx.abortController.signal.aborted) {
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
        );
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

      // Complete the generation
      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeEventCount} toolCalls=${opencodeToolCallCount} permissions=${opencodePermissionCount} questions=${opencodeQuestionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
      );
      await this.finishGeneration(ctx, "completed");
    } catch (error) {
      console.error("[GenerationManager] Error:", error);
      ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.info(
        `[GenerationManager][SUMMARY] status=error generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} error=${JSON.stringify(ctx.errorMessage)}`,
      );
      await this.finishGeneration(ctx, "error");
    }
  }

  /**
   * Direct LLM generation flow for BYOC.
   * Server calls LLM APIs directly and routes tool execution to the daemon via WebSocket.
   *
   * Tool loop:
   * 1. Get SandboxBackend via factory
   * 2. Get LLMBackend for the model
   * 3. Build message history from DB
   * 4. Call LLM -> stream response -> extract tool_use -> check permissions
   *    -> execute on daemon -> send tool_result back to LLM -> repeat until done
   */
  private async runDirectGeneration(ctx: GenerationContext): Promise<void> {
    let sandbox: SandboxBackend | null = null;

    try {
      // 1. Get sandbox backend
      sandbox = getSandboxBackend(ctx.conversationId, ctx.userId, ctx.deviceId);
      await sandbox.setup(ctx.conversationId);

      // Record marker time for file collection and store sandbox reference
      ctx.generationMarkerTime = Date.now();
      ctx.sandbox = sandbox;
      ctx.sentFilePaths = new Set();

      // Sync memory files to sandbox
      try {
        await syncMemoryToSandbox(
          ctx.userId,
          async (path, content) => {
            await sandbox!.writeFile(path, content);
          },
          async (dir) => {
            await sandbox!.execute(`mkdir -p "${dir}"`);
          },
        );
      } catch (err) {
        console.error("[GenerationManager] Failed to sync memory to sandbox:", err);
      }

      // 2. Get LLM backend
      const llm = await this.getLLMBackend(ctx);

      // 3. Get integration environment and build system prompt
      const enabledIntegrations = await getEnabledIntegrationTypes(ctx.userId);
      const allowedIntegrations = ctx.allowedIntegrations ?? enabledIntegrations;
      const cliInstructions = getCliInstructions(allowedIntegrations);
      const resolvedCommunityIntegrationSkills = await resolvePreferredCommunitySkillsForUser(
        ctx.userId,
        allowedIntegrations,
      );
      if (resolvedCommunityIntegrationSkills.length > 0) {
        await sandbox!.execute('mkdir -p "/app/.opencode/integration-skills"');
        await Promise.all(
          resolvedCommunityIntegrationSkills.map(async (skill) => {
            const skillDir = `/app/.opencode/integration-skills/${skill.slug}`;
            await sandbox!.execute(`mkdir -p "${skillDir}"`);
            await Promise.all(
              skill.files.map(async (file) => {
                const filePath = `${skillDir}/${file.path}`;
                const idx = filePath.lastIndexOf("/");
                if (idx > 0) {
                  await sandbox!.execute(`mkdir -p "${filePath.slice(0, idx)}"`);
                }
                await sandbox!.writeFile(filePath, file.content);
              }),
            );
          }),
        );
      }
      const integrationSkillsPrompt = getIntegrationSkillsSystemPrompt(
        resolvedCommunityIntegrationSkills.map((skill) => skill.slug),
      );

      const baseSystemPrompt = "You are Bap, an AI agent that helps do work.";
      const workflowPrompt = this.buildWorkflowPrompt(ctx);
      const memoryPrompt = buildMemorySystemPrompt();
      const integrationSkillDraftInstructions = this.getIntegrationSkillDraftInstructions();
      const systemPromptParts = [
        baseSystemPrompt,
        cliInstructions,
        integrationSkillsPrompt,
        integrationSkillDraftInstructions,
        memoryPrompt,
        workflowPrompt,
      ].filter(Boolean);
      const systemPrompt = systemPromptParts.join("\n\n");

      // 4. Build message history from DB
      const chatMessages = await this.buildMessageHistory(ctx, {
        sandbox,
        llm,
      });

      // 5. Get tool definitions
      const tools = getDirectModeTools();

      // 6. Agentic tool loop
      const loopMessages = [...chatMessages];
      let hasToolCalls = true;
      let iterationCount = 0;
      const MAX_ITERATIONS = 50;

      const runDirectToolLoop = async (): Promise<void> => {
        if (!hasToolCalls || iterationCount >= MAX_ITERATIONS) {
          return;
        }

        if (ctx.abortController.signal.aborted) {
          await this.finishGeneration(ctx, "cancelled");
          return;
        }

        iterationCount += 1;
        hasToolCalls = false;

        // Call LLM
        const assistantContentBlocks: ContentBlock[] = [];
        let currentToolUseId = "";
        let currentToolName = "";
        let currentToolJson = "";

        const stream = llm.chat({
          messages: loopMessages,
          tools,
          system: systemPrompt,
          model: ctx.model,
          signal: ctx.abortController.signal,
        });

        await this.consumeAsyncStream(stream, async (event) => {
          if (ctx.abortController.signal.aborted) {
            return true;
          }

          switch (event.type) {
            case "text_delta": {
              ctx.assistantContent += event.text;
              this.broadcast(ctx, { type: "text", content: event.text });

              const lastPart = ctx.contentParts[ctx.contentParts.length - 1];
              if (lastPart && lastPart.type === "text") {
                lastPart.text += event.text;
              } else {
                ctx.contentParts.push({ type: "text", text: event.text });
              }

              const lastBlock = assistantContentBlocks[assistantContentBlocks.length - 1];
              if (lastBlock && lastBlock.type === "text") {
                lastBlock.text += event.text;
              } else {
                assistantContentBlocks.push({ type: "text", text: event.text });
              }

              this.scheduleSave(ctx);
              break;
            }
            case "tool_use_start": {
              currentToolUseId = event.toolUseId;
              currentToolName = event.toolName;
              currentToolJson = "";
              break;
            }
            case "tool_use_delta": {
              currentToolJson += event.jsonDelta;
              break;
            }
            case "tool_use_end": {
              let toolInput: Record<string, unknown> = {};
              try {
                toolInput = JSON.parse(currentToolJson);
              } catch {
                toolInput = { raw: currentToolJson };
              }

              const toolBlock: ContentBlock = {
                type: "tool_use",
                id: currentToolUseId,
                name: currentToolName,
                input: toolInput,
              };
              assistantContentBlocks.push(toolBlock);

              this.broadcast(ctx, {
                type: "tool_use",
                toolName: currentToolName,
                toolInput,
                toolUseId: currentToolUseId,
              });

              ctx.contentParts.push({
                type: "tool_use",
                id: currentToolUseId,
                name: currentToolName,
                input: toolInput,
              });

              await this.saveProgress(ctx);
              hasToolCalls = true;
              break;
            }
            case "thinking": {
              this.broadcast(ctx, {
                type: "thinking",
                content: event.text,
                thinkingId: event.thinkingId,
              });
              break;
            }
            case "usage": {
              ctx.usage.inputTokens += event.inputTokens;
              ctx.usage.outputTokens += event.outputTokens;
              break;
            }
            case "error": {
              throw new Error(event.error);
            }
          }

          return false;
        });

        if (ctx.abortController.signal.aborted) {
          await this.finishGeneration(ctx, "cancelled");
          return;
        }

        if (hasToolCalls) {
          loopMessages.push({
            role: "assistant",
            content: assistantContentBlocks,
          });

          const toolResults: ContentBlock[] = [];
          await this.forEachSequential(assistantContentBlocks, async (block) => {
            if (block.type !== "tool_use") {
              return;
            }

            if (block.name.startsWith("memory_")) {
              const memoryResult = await this.executeMemoryTool(ctx, sandbox!, block);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: memoryResult.content,
                is_error: memoryResult.isError,
              });
              this.broadcast(ctx, {
                type: "tool_result",
                toolName: block.name,
                result: memoryResult.content,
                toolUseId: block.id,
              });
              ctx.contentParts.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: memoryResult.content,
              });
              await this.saveProgress(ctx);
              return;
            }

            if (ctx.allowedIntegrations !== undefined && block.name === "bash") {
              const command = (block.input.command as string) || "";
              const parsed = parseBashCommand(command);
              if (
                parsed &&
                !ctx.allowedIntegrations.includes(parsed.integration as IntegrationType)
              ) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Integration "${parsed.integration}" is not allowed for this workflow.`,
                  is_error: true,
                });
                this.broadcast(ctx, {
                  type: "tool_result",
                  toolName: block.name,
                  result: "Integration not allowed",
                  toolUseId: block.id,
                });
                ctx.contentParts.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "Integration not allowed",
                });
                return;
              }
            }

            const permCheck = checkToolPermissions(block.name, block.input, allowedIntegrations);
            if (permCheck.needsAuth) {
              const authResult = await this.waitForAuth(ctx.id, {
                integration: permCheck.integration!,
                reason: permCheck.reason,
              });
              if (!authResult.success) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Authentication not completed for ${permCheck.integrationName}. The user needs to connect this integration first.`,
                  is_error: true,
                });
                this.broadcast(ctx, {
                  type: "tool_result",
                  toolName: block.name,
                  result: "Authentication not completed",
                  toolUseId: block.id,
                });
                ctx.contentParts.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "Authentication not completed",
                });
                return;
              }
            }

            if (permCheck.needsApproval) {
              const decision = await this.waitForApproval(ctx.id, {
                toolInput: block.input,
                integration: permCheck.integration || "",
                operation: "",
                command: (block.input.command as string) || "",
              });
              if (decision === "deny") {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "User denied this action",
                  is_error: true,
                });
                this.broadcast(ctx, {
                  type: "tool_result",
                  toolName: block.name,
                  result: "User denied this action",
                  toolUseId: block.id,
                });
                ctx.contentParts.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "User denied this action",
                });
                return;
              }
            }

            if (block.name === "send_file") {
              const filePath = block.input.path as string;
              let resultContent: string;
              let isError = false;
              try {
                const content = await readSandboxFileAsBuffer(sandbox!, filePath);
                if (content.length === 0) {
                  throw new Error("File not found or empty");
                }
                const fileRecord = await uploadSandboxFile({
                  path: filePath,
                  content,
                  conversationId: ctx.conversationId,
                  messageId: undefined,
                });
                ctx.uploadedSandboxFileIds?.add(fileRecord.id);
                resultContent = `File sent successfully: ${path.basename(filePath)}`;
                ctx.sentFilePaths?.add(filePath);
                this.broadcast(ctx, {
                  type: "sandbox_file",
                  fileId: fileRecord.id,
                  path: filePath,
                  filename: fileRecord.filename,
                  mimeType: fileRecord.mimeType,
                  sizeBytes: fileRecord.sizeBytes,
                });
              } catch (err) {
                resultContent = `Failed to send file: ${err instanceof Error ? err.message : "Unknown error"}`;
                isError = true;
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: resultContent,
                is_error: isError,
              });
              this.broadcast(ctx, {
                type: "tool_result",
                toolName: block.name,
                result: resultContent,
                toolUseId: block.id,
              });
              ctx.contentParts.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: resultContent,
              });
              await this.saveProgress(ctx);
              return;
            }

            const cmdInfo = toolCallToCommand(block.name, block.input);
            let resultContent: string;
            let isError = false;
            if (cmdInfo) {
              try {
                const execResult = await sandbox!.execute(cmdInfo.command, {
                  timeout: (block.input.timeout as number) || 120_000,
                });
                resultContent = execResult.stdout || execResult.stderr || "(no output)";
                if (execResult.exitCode !== 0 && execResult.stderr) {
                  resultContent = `Exit code: ${execResult.exitCode}\n${execResult.stderr}\n${execResult.stdout}`;
                  isError = true;
                }
              } catch (err) {
                resultContent = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
                isError = true;
              }
            } else {
              resultContent = `Unknown tool: ${block.name}`;
              isError = true;
            }
            if (resultContent.length > 100_000) {
              resultContent = resultContent.slice(0, 100_000) + "\n... (output truncated)";
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: resultContent,
              is_error: isError,
            });
            this.broadcast(ctx, {
              type: "tool_result",
              toolName: block.name,
              result: resultContent,
              toolUseId: block.id,
            });
            ctx.contentParts.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: resultContent,
            });
            await this.saveProgress(ctx);
          });

          loopMessages.push({
            role: "user",
            content: toolResults,
          });
        }

        await runDirectToolLoop();
      };

      await runDirectToolLoop();

      if (iterationCount >= MAX_ITERATIONS) {
        console.warn("[GenerationManager] Hit max iterations in tool loop");
      }

      if (sandbox) {
        try {
          await this.importIntegrationSkillDraftsFromSandbox(ctx, sandbox);
        } catch (error) {
          console.error("[GenerationManager] Failed to import integration skill drafts:", error);
        }
      }

      // Complete the generation
      await this.finishGeneration(ctx, "completed");
    } catch (error) {
      console.error("[GenerationManager] Direct generation error:", error);
      ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.finishGeneration(ctx, "error");
    } finally {
      if (sandbox) {
        sandbox
          .teardown()
          .catch((err) => console.error("[GenerationManager] Sandbox teardown error:", err));
      }
    }
  }

  private async executeMemoryTool(
    ctx: GenerationContext,
    sandbox: SandboxBackend,
    block: Extract<ContentBlock, { type: "tool_use" }>,
  ): Promise<{ content: string; isError?: boolean }> {
    try {
      const input = block.input as Record<string, unknown>;

      switch (block.name) {
        case "memory_search": {
          const query = String(input.query || "").trim();
          if (!query) {
            return {
              content: "Error: memory_search requires a query",
              isError: true,
            };
          }
          const results = await searchMemoryWithSessions({
            userId: ctx.userId,
            query,
            limit: input.limit ? Number(input.limit) : undefined,
            type: parseMemoryFileType(input.type),
            date: input.date as string | undefined,
          });
          return { content: JSON.stringify({ results }, null, 2) };
        }

        case "memory_get": {
          const path = String(input.path || "").trim();
          if (!path) {
            return {
              content: "Error: memory_get requires a path",
              isError: true,
            };
          }
          const { readSessionTranscriptByPath } = await import("@/server/services/memory-service");
          const result =
            (await readSessionTranscriptByPath({ userId: ctx.userId, path })) ??
            (await readMemoryFile({ userId: ctx.userId, path }));
          if (!result) {
            return { content: "Error: memory file not found", isError: true };
          }
          return { content: JSON.stringify(result, null, 2) };
        }

        case "memory_write": {
          const content = String(input.content || "").trim();
          if (!content) {
            return {
              content: "Error: memory_write requires content",
              isError: true,
            };
          }
          const entry = await writeMemoryEntry({
            userId: ctx.userId,
            path: input.path as string | undefined,
            type: parseMemoryFileType(input.type),
            date: input.date as string | undefined,
            title: input.title as string | undefined,
            tags: input.tags as string[] | undefined,
            content,
          });

          await syncMemoryToSandbox(
            ctx.userId,
            async (path, fileContent) => {
              await sandbox.writeFile(path, fileContent);
            },
            async (dir) => {
              await sandbox.execute(`mkdir -p "${dir}"`);
            },
          );

          return {
            content: JSON.stringify({ success: true, entryId: entry.id }, null, 2),
          };
        }

        default:
          return {
            content: `Unknown memory tool: ${block.name}`,
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: `Error: ${message}`, isError: true };
    }
  }

  /**
   * Get the appropriate LLM backend for a generation context.
   */
  private async getLLMBackend(ctx: GenerationContext): Promise<LLMBackend> {
    const providerID = await resolveProviderID(ctx.model);

    switch (providerID) {
      case "anthropic":
        return new AnthropicBackend();

      case "openai": {
        // Check for user's subscription token
        const { providerAuth } = await import("@/server/db/schema");
        const { decrypt } = await import("@/server/utils/encryption");
        const auth = await db.query.providerAuth.findFirst({
          where: and(eq(providerAuth.userId, ctx.userId), eq(providerAuth.provider, "openai")),
        });
        if (auth) {
          return new OpenAIBackend(decrypt(auth.accessToken));
        }
        // Fall back to server API key
        if (env.OPENAI_API_KEY) {
          return new OpenAIBackend(env.OPENAI_API_KEY);
        }
        throw new Error("No OpenAI API key or subscription available");
      }

      case "kimi-for-coding": {
        const { providerAuth } = await import("@/server/db/schema");
        const { decrypt } = await import("@/server/utils/encryption");
        const auth = await db.query.providerAuth.findFirst({
          where: and(eq(providerAuth.userId, ctx.userId), eq(providerAuth.provider, "kimi")),
        });
        if (auth) {
          return new AnthropicBackend(decrypt(auth.accessToken), "https://api.kimi.com/coding/v1");
        }
        throw new Error("No Kimi API key available");
      }

      default:
        // If we have a device, try local LLM
        if (ctx.deviceId) {
          return new LocalLLMBackend(ctx.deviceId);
        }
        // Default to Anthropic
        return new AnthropicBackend();
    }
  }

  /**
   * Build chat message history from the database for direct mode.
   */
  private async buildMessageHistory(
    ctx: GenerationContext,
    options?: { sandbox?: SandboxBackend; llm?: LLMBackend },
  ): Promise<ChatMessage[]> {
    const messages = await db.query.message.findMany({
      where: eq(message.conversationId, ctx.conversationId),
      orderBy: asc(message.createdAt),
    });

    const { summaryText, sessionMessages } = await this.maybeCompactConversation(
      ctx,
      messages,
      options,
    );

    const chatMessages: ChatMessage[] = [];

    if (summaryText) {
      chatMessages.push({
        role: "assistant",
        content: `Summary of previous conversation:\n${summaryText}`,
      });
    }

    const lastMessage = sessionMessages[sessionMessages.length - 1];
    const skipLastUser =
      lastMessage?.role === "user" && lastMessage.content === ctx.userMessageContent;

    const messagesToRender = skipLastUser ? sessionMessages.slice(0, -1) : sessionMessages;

    for (const m of messagesToRender) {
      if (m.role === "user") {
        chatMessages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        if (m.contentParts && m.contentParts.length > 0) {
          const blocks: ContentBlock[] = m.contentParts.map((p): ContentBlock => {
            switch (p.type) {
              case "text":
                return { type: "text", text: p.text };
              case "tool_use":
                return {
                  type: "tool_use",
                  id: p.id,
                  name: p.name,
                  input: p.input,
                };
              case "tool_result":
                return {
                  type: "tool_result",
                  tool_use_id: p.tool_use_id,
                  content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
                };
              case "thinking":
                return {
                  type: "thinking",
                  thinking: p.content,
                  signature: "",
                };
              default:
                return { type: "text", text: "" };
            }
          });
          chatMessages.push({ role: "assistant", content: blocks });
        } else {
          chatMessages.push({ role: "assistant", content: m.content });
        }
      }
    }

    if (ctx.attachments && ctx.attachments.length > 0) {
      const blocks: ContentBlock[] = [{ type: "text", text: ctx.userMessageContent }];
      for (const a of ctx.attachments) {
        if (a.mimeType.startsWith("image/")) {
          const base64Data = a.dataUrl.split(",")[1] || "";
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: a.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: base64Data,
            },
          });
        } else {
          const base64Data = a.dataUrl.split(",")[1] || "";
          const textContent = Buffer.from(base64Data, "base64").toString("utf-8");
          blocks.push({
            type: "text",
            text: `[File: ${a.name}]\n${textContent}`,
          });
        }
      }
      chatMessages.push({ role: "user", content: blocks });
    } else if (!skipLastUser) {
      chatMessages.push({ role: "user", content: ctx.userMessageContent });
    }

    return chatMessages;
  }

  private async maybeCompactConversation(
    ctx: GenerationContext,
    messages: MessageRow[],
    options?: { sandbox?: SandboxBackend; llm?: LLMBackend },
  ): Promise<{ summaryText: string | null; sessionMessages: MessageRow[] }> {
    const boundaryIndex = messages.findLastIndex(
      (m) => m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX),
    );

    const sessionMessages = boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : messages;

    const summaryIndex = sessionMessages.findLastIndex(
      (m) => m.role === "system" && m.content.startsWith(COMPACTION_SUMMARY_PREFIX),
    );

    const summaryMessage = summaryIndex >= 0 ? sessionMessages[summaryIndex] : undefined;
    const summaryText = summaryMessage
      ? summaryMessage.content.replace(COMPACTION_SUMMARY_PREFIX, "").trim()
      : null;

    const messagesAfterSummary =
      summaryIndex >= 0 ? sessionMessages.slice(summaryIndex + 1) : sessionMessages;

    const conversationMessages = messagesAfterSummary.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );

    const tokenEstimate = conversationMessages.reduce(
      (sum, m) => sum + estimateTokensForMessageRow(m),
      0,
    );

    if (
      tokenEstimate < COMPACTION_TRIGGER_TOKENS ||
      conversationMessages.length < COMPACTION_MIN_MESSAGES ||
      !options?.llm
    ) {
      return { summaryText, sessionMessages: conversationMessages };
    }

    const messagesToSummarize = conversationMessages.slice(0, -COMPACTION_KEEP_LAST_MESSAGES);
    const messagesToKeep = conversationMessages.slice(-COMPACTION_KEEP_LAST_MESSAGES);

    if (messagesToSummarize.length < COMPACTION_MIN_MESSAGES) {
      return { summaryText, sessionMessages: conversationMessages };
    }

    if (tokenEstimate > MEMORY_FLUSH_TRIGGER_TOKENS && options?.sandbox) {
      await this.runMemoryFlush(ctx, options.llm, options.sandbox, conversationMessages);
    }

    const newSummary = await this.generateCompactionSummary(
      options.llm,
      ctx.model,
      messagesToSummarize,
      summaryText,
    );

    if (newSummary) {
      const anchor = messagesToKeep[0]?.createdAt ?? new Date();
      const summaryCreatedAt = new Date(anchor.getTime() - 1);
      await db.insert(message).values({
        conversationId: ctx.conversationId,
        role: "system",
        content: `${COMPACTION_SUMMARY_PREFIX}\n${newSummary}`,
        createdAt: summaryCreatedAt,
      });
    }

    return {
      summaryText: newSummary ?? summaryText,
      sessionMessages: messagesToKeep,
    };
  }

  private buildSummaryInput(messages: MessageRow[], previousSummary: string | null): string {
    const parts: string[] = [];
    if (previousSummary) {
      parts.push("Previous summary:\n" + previousSummary.trim());
    }

    const transcript = messages
      .map((m) => {
        if (m.role === "assistant" && m.contentParts && m.contentParts.length > 0) {
          const textParts = m.contentParts
            .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join("");
          return `${m.role}: ${textParts || m.content}`;
        }
        return `${m.role}: ${m.content}`;
      })
      .join("\n");

    parts.push("Conversation:\n" + transcript);
    return parts.join("\n\n");
  }

  private async generateCompactionSummary(
    llm: LLMBackend,
    model: string,
    messages: MessageRow[],
    previousSummary: string | null,
  ): Promise<string | null> {
    const input = this.buildSummaryInput(messages, previousSummary);
    let summary = "";

    const stream = llm.chat({
      messages: [{ role: "user", content: input }],
      system: COMPACTION_SUMMARY_SYSTEM_PROMPT,
      model,
      maxTokens: COMPACTION_SUMMARY_MAX_TOKENS,
    });

    try {
      for await (const event of stream) {
        if (event.type === "text_delta") {
          summary += event.text;
        }
      }
    } catch (err) {
      console.error("[GenerationManager] Compaction summary error:", err);
      return null;
    }

    return summary.trim() || null;
  }

  private async runMemoryFlush(
    ctx: GenerationContext,
    llm: LLMBackend,
    sandbox: SandboxBackend,
    messages: MessageRow[],
  ): Promise<void> {
    const tools = getDirectModeTools().filter((tool) => tool.name.startsWith("memory_"));
    const loopMessages: ChatMessage[] = [
      { role: "user", content: this.buildSummaryInput(messages, null) },
    ];

    let iterations = 0;
    let hasToolCalls = true;

    const flushMemoryLoop = async (): Promise<void> => {
      if (!hasToolCalls || iterations >= MEMORY_FLUSH_MAX_ITERATIONS) {
        return;
      }

      iterations += 1;
      hasToolCalls = false;

      const assistantBlocks: ContentBlock[] = [];
      let currentToolUseId = "";
      let currentToolName = "";
      let currentToolJson = "";

      const stream = llm.chat({
        messages: loopMessages,
        tools,
        system: MEMORY_FLUSH_SYSTEM_PROMPT,
        model: ctx.model,
      });

      await this.consumeAsyncStream(stream, async (event) => {
        if (event.type === "text_delta") {
          assistantBlocks.push({ type: "text", text: event.text });
        } else if (event.type === "tool_use_start") {
          currentToolUseId = event.toolUseId;
          currentToolName = event.toolName;
          currentToolJson = "";
        } else if (event.type === "tool_use_delta") {
          currentToolJson += event.jsonDelta;
        } else if (event.type === "tool_use_end") {
          let toolInput: Record<string, unknown> = {};
          try {
            toolInput = JSON.parse(currentToolJson);
          } catch {
            toolInput = { raw: currentToolJson };
          }
          assistantBlocks.push({
            type: "tool_use",
            id: currentToolUseId,
            name: currentToolName,
            input: toolInput,
          });
          hasToolCalls = true;
        } else if (event.type === "usage") {
          ctx.usage.inputTokens += event.inputTokens;
          ctx.usage.outputTokens += event.outputTokens;
        }
        return false;
      });

      if (!hasToolCalls) {
        return;
      }

      loopMessages.push({ role: "assistant", content: assistantBlocks });

      const toolResults: ContentBlock[] = [];
      await this.forEachSequential(assistantBlocks, async (block) => {
        if (block.type !== "tool_use" || !block.name.startsWith("memory_")) {
          return;
        }
        const memoryResult = await this.executeMemoryTool(ctx, sandbox, block);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: memoryResult.content,
          is_error: memoryResult.isError,
        });
      });

      if (toolResults.length === 0) {
        return;
      }

      loopMessages.push({ role: "user", content: toolResults });
      await flushMemoryLoop();
    };

    await flushMemoryLoop();
  }

  /**
   * Handle actionable OpenCode events that require explicit responses.
   */
  private async handleOpenCodeActionableEvent(
    ctx: GenerationContext,
    client: OpencodeClient,
    event: OpenCodeActionableEvent,
  ): Promise<{ type: "none" | "permission" | "question" }> {
    switch (event.type) {
      case "message.part.updated": {
        if (event.properties.part.type === "tool") {
          this.handleOpenCodeToolStateCoverage(event.properties.part);
        }
        return { type: "none" };
      }
      case "permission.asked": {
        await this.handleOpenCodePermissionAsked(ctx, client, event.properties);
        return { type: "permission" };
      }
      case "question.asked": {
        await this.handleOpenCodeQuestionAsked(ctx, client, event.properties);
        return { type: "question" };
      }
      default:
        return assertNever(event);
    }
  }

  private handleOpenCodeToolStateCoverage(part: ToolPart): void {
    switch (part.state.status) {
      case "pending":
        return;
      case "running":
        return;
      case "completed":
        return;
      case "error":
        return;
      default:
        return assertNever(part.state);
    }
  }

  private async handleOpenCodePermissionAsked(
    ctx: GenerationContext,
    client: OpencodeClient,
    request: PermissionRequest,
  ): Promise<void> {
    const permissionType = request.permission || "file access";
    const patterns = request.patterns;
    const allPatternsAllowed = shouldAutoApproveOpenCodePermission(permissionType, patterns);

    if (ctx.autoApprove || allPatternsAllowed) {
      console.log(
        "[GenerationManager] Auto-approving sandbox permission:",
        request.id,
        permissionType,
        patterns,
        ctx.autoApprove ? "(conversation auto-approve enabled)" : "(allowlisted path)",
      );
      try {
        await client.permission.reply({
          requestID: request.id,
          reply: "always",
        });
      } catch (err) {
        console.error("[GenerationManager] Failed to approve permission:", err);
      }
      return;
    }

    console.log(
      "[GenerationManager] Surfacing permission request to UI:",
      request.id,
      request.permission,
      patterns,
    );

    const toolUseId = `opencode-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const command = patterns?.length ? `${permissionType}: ${patterns.join(", ")}` : permissionType;

    await this.queueOpenCodeApprovalRequest(
      ctx,
      client,
      {
        kind: "permission",
        request,
      },
      {
        toolUseId,
        toolName: "Permission",
        toolInput: request as Record<string, unknown>,
        requestedAt: new Date().toISOString(),
        integration: "Bap",
        operation: permissionType,
        command,
      },
    );
  }

  private async handleOpenCodeQuestionAsked(
    ctx: GenerationContext,
    client: OpencodeClient,
    request: QuestionRequest,
  ): Promise<void> {
    const defaultAnswers = buildDefaultQuestionAnswers(request);

    if (ctx.autoApprove) {
      try {
        await client.question.reply({
          requestID: request.id,
          answers: defaultAnswers,
        });
      } catch (err) {
        console.error("[GenerationManager] Failed to auto-answer question:", err);
      }
      return;
    }

    const toolUseId = `opencode-question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const command = buildQuestionCommand(request);

    await this.queueOpenCodeApprovalRequest(
      ctx,
      client,
      {
        kind: "question",
        request,
        defaultAnswers,
      },
      {
        toolUseId,
        toolName: "Question",
        toolInput: request as unknown as Record<string, unknown>,
        requestedAt: new Date().toISOString(),
        integration: "Bap",
        operation: "question",
        command,
      },
    );
  }

  private async queueOpenCodeApprovalRequest(
    ctx: GenerationContext,
    client: OpencodeClient,
    openCodeRequest: PendingOpenCodeApprovalRequest,
    pendingApproval: PendingApproval,
  ): Promise<void> {
    ctx.status = "awaiting_approval";
    ctx.pendingApproval = pendingApproval;
    ctx.opencodePendingApprovalRequest = openCodeRequest;
    ctx.opencodeClient = client;

    db.update(generation)
      .set({
        status: "awaiting_approval",
        pendingApproval: ctx.pendingApproval,
      })
      .where(eq(generation.id, ctx.id))
      .then(() =>
        db
          .update(conversation)
          .set({ generationStatus: "awaiting_approval" })
          .where(eq(conversation.id, ctx.conversationId)),
      )
      .then(() => {
        if (!ctx.workflowRunId) {
          return;
        }
        return db
          .update(workflowRun)
          .set({ status: "awaiting_approval" })
          .where(eq(workflowRun.id, ctx.workflowRunId));
      })
      .catch((err) => console.error("[GenerationManager] DB update error:", err));

    this.broadcast(ctx, {
      type: "pending_approval",
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      toolUseId: pendingApproval.toolUseId,
      toolName: pendingApproval.toolName,
      toolInput: pendingApproval.toolInput,
      integration: pendingApproval.integration,
      operation: pendingApproval.operation,
      command: pendingApproval.command,
    });

    ctx.approvalTimeoutId = setTimeout(() => {
      this.rejectOpenCodePendingApprovalRequest(ctx)
        .catch((err) =>
          console.error("[GenerationManager] Failed to reject OpenCode request on timeout:", err),
        )
        .finally(() => {
          this.handleApprovalTimeout(ctx);
        });
    }, APPROVAL_TIMEOUT_MS);
  }

  private async rejectOpenCodePendingApprovalRequest(ctx: GenerationContext): Promise<void> {
    if (!ctx.opencodePendingApprovalRequest || !ctx.opencodeClient) {
      return;
    }

    try {
      switch (ctx.opencodePendingApprovalRequest.kind) {
        case "permission":
          await ctx.opencodeClient.permission.reply({
            requestID: ctx.opencodePendingApprovalRequest.request.id,
            reply: "reject",
          });
          break;
        case "question":
          await ctx.opencodeClient.question.reject({
            requestID: ctx.opencodePendingApprovalRequest.request.id,
          });
          break;
        default:
          assertNever(ctx.opencodePendingApprovalRequest);
      }
    } finally {
      ctx.opencodePendingApprovalRequest = undefined;
      ctx.opencodeClient = undefined;
    }
  }

  /**
   * Process tracked OpenCode SSE events and transform them to GenerationEvent
   */
  private async processOpencodeEvent(
    ctx: GenerationContext,
    event: OpenCodeTrackedEvent,
    currentTextPart: { type: "text"; text: string } | null,
    currentTextPartId: string | null,
    setCurrentTextPart: (
      part: { type: "text"; text: string } | null,
      partId: string | null,
    ) => void,
  ): Promise<void> {
    switch (event.type) {
      case "message.updated": {
        const messageId = event.properties.info.id;
        const role = event.properties.info.role;

        if (messageId && role) {
          ctx.messageRoles.set(messageId, role);
        }

        if (messageId && role === "assistant") {
          ctx.assistantMessageIds.add(messageId);
          const pendingParts = ctx.pendingMessageParts.get(messageId);
          if (pendingParts && pendingParts.length > 0) {
            // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
            ctx.pendingMessageParts.delete(messageId);
            let replayTextPart = currentTextPart;
            let replayTextPartId = currentTextPartId;
            const replaySetCurrentTextPart = (
              part: { type: "text"; text: string } | null,
              partId: string | null,
            ) => {
              replayTextPart = part;
              replayTextPartId = partId;
              setCurrentTextPart(part, partId);
            };
            await Promise.all(
              pendingParts.map(async (pendingPart) => {
                await this.processOpencodeMessagePart(
                  ctx,
                  pendingPart,
                  replayTextPart,
                  replayTextPartId,
                  replaySetCurrentTextPart,
                );
              }),
            );
          }
        }
        break;
      }

      case "message.part.updated": {
        const part = event.properties.part;
        const messageID = part.messageID;

        if (messageID) {
          const role = ctx.messageRoles.get(messageID);
          if (role === "user") {
            return;
          }
          if (role !== "assistant") {
            // Preserve live streaming: process likely assistant parts immediately.
            // Queue only parts that strongly look like user-echo updates.
            if (!this.shouldProcessUnknownMessagePart(ctx, part)) {
              const queued = ctx.pendingMessageParts.get(messageID) ?? [];
              queued.push(part);
              ctx.pendingMessageParts.set(messageID, queued);
              return;
            }
          }
        }

        await this.processOpencodeMessagePart(
          ctx,
          part,
          currentTextPart,
          currentTextPartId,
          setCurrentTextPart,
        );
        break;
      }

      case "session.updated": {
        // Track session metadata if needed
        ctx.sessionId = event.properties.info.id;
        break;
      }

      case "session.status": {
        // Can track status changes if needed
        break;
      }
      default:
        return assertNever(event);
    }
  }

  private shouldProcessUnknownMessagePart(ctx: GenerationContext, part: OpencodePart): boolean {
    if (part.type === "tool") {
      return true;
    }

    if (part.type !== "text") {
      return true;
    }

    const fullText = part.text.trim();
    const userText = ctx.userMessageContent.trim();
    if (!fullText) {
      return false;
    }

    // Guard against replaying user input text as assistant output.
    if (userText === fullText || userText.startsWith(fullText) || fullText.startsWith(userText)) {
      return false;
    }

    return true;
  }

  private async processOpencodeMessagePart(
    ctx: GenerationContext,
    part: OpencodePart,
    currentTextPart: { type: "text"; text: string } | null,
    currentTextPartId: string | null,
    setCurrentTextPart: (
      part: { type: "text"; text: string } | null,
      partId: string | null,
    ) => void,
  ): Promise<void> {
    const partId = part.id;

    // Text content
    // NOTE: OpenCode sends the FULL cumulative text with each update, not deltas
    // We need to calculate the delta ourselves
    if (part.type === "text") {
      const fullText = part.text;
      if (fullText) {
        // Check if this is a new text part (different part ID)
        const isNewPart = partId !== currentTextPartId;

        // Calculate delta from the previous text
        const previousLength = isNewPart ? 0 : (currentTextPart?.text.length ?? 0);
        const delta = fullText.slice(previousLength);

        // Only process if there's new content
        if (delta) {
          ctx.assistantContent += delta;
          this.broadcast(ctx, { type: "text", content: delta });

          if (currentTextPart && !isNewPart) {
            // Update to the full cumulative text
            currentTextPart.text = fullText;
          } else {
            // New text part - create a new entry
            const newPart = { type: "text" as const, text: fullText };
            ctx.contentParts.push(newPart);
            setCurrentTextPart(newPart, partId);
          }
          this.scheduleSave(ctx);
        }
      }
    }

    // Tool call (OpenCode uses "tool" type with callID, tool, and state properties)
    // See @opencode-ai/sdk ToolPart type: state contains input/output
    // Status flow: pending (no input) -> running (has input) -> completed (has output)
    if (part.type === "tool") {
      setCurrentTextPart(null, null);
      const toolUseId = part.callID;
      const toolName = part.tool;
      const toolInput = "input" in part.state ? part.state.input : {};

      const existingToolUse = ctx.contentParts.find(
        (p): p is ContentPart & { type: "tool_use" } => p.type === "tool_use" && p.id === toolUseId,
      );

      switch (part.state.status) {
        case "pending":
          return;
        case "running": {
          if (existingToolUse) {
            return;
          }

          this.broadcast(ctx, {
            type: "tool_use",
            toolName,
            toolInput,
            toolUseId,
          });

          ctx.contentParts.push({
            type: "tool_use",
            id: toolUseId,
            name: toolName,
            input: toolInput,
          });
          await this.saveProgress(ctx);
          return;
        }
        case "completed": {
          if (!existingToolUse) {
            return;
          }
          const result = part.state.output;
          this.broadcast(ctx, {
            type: "tool_result",
            toolName: existingToolUse.name,
            result,
            toolUseId,
          });
          ctx.contentParts.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: result,
          });
          await this.saveProgress(ctx);
          return;
        }
        case "error": {
          if (!existingToolUse) {
            return;
          }
          const result = { error: part.state.error };
          this.broadcast(ctx, {
            type: "tool_result",
            toolName: existingToolUse.name,
            result,
            toolUseId,
          });
          ctx.contentParts.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            content: result,
          });
          await this.saveProgress(ctx);
          return;
        }
        default:
          return assertNever(part.state);
      }
    }
  }

  private getIntegrationSkillDraftInstructions(): string {
    return [
      "## Creating Integration Skills",
      "To create a new integration skill via chat, write a JSON draft file in:",
      "/app/.opencode/integration-skill-drafts/<slug>.json",
      "The server imports drafts automatically when generation completes.",
      "Draft schema:",
      "{",
      '  "slug": "integration-slug",',
      '  "title": "Skill title",',
      '  "description": "When and why to use this skill",',
      '  "setAsPreferred": true,',
      '  "files": [{"path":"SKILL.md","content":"..."}]',
      "}",
    ].join("\n");
  }

  private async importIntegrationSkillDraftsFromE2B(
    ctx: GenerationContext,
    sandbox: Sandbox,
  ): Promise<void> {
    const findResult = await sandbox.commands.run(
      `find /app/.opencode/integration-skill-drafts -maxdepth 1 -type f -name '*.json' 2>/dev/null | head -20`,
    );
    const paths = findResult.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    await Promise.all(
      paths.map(async (filePath) => {
        try {
          const content = await sandbox.files.read(filePath);
          const created = await this.importIntegrationSkillDraftContent(ctx, String(content));
          if (created > 0) {
            await sandbox.commands.run(`rm -f "${filePath}"`);
          }
        } catch (error) {
          console.error(
            `[GenerationManager] Failed to import integration skill draft ${filePath}:`,
            error,
          );
        }
      }),
    );
  }

  private async importIntegrationSkillDraftsFromSandbox(
    ctx: GenerationContext,
    sandbox: SandboxBackend,
  ): Promise<void> {
    const findResult = await sandbox.execute(
      `find /app/.opencode/integration-skill-drafts -maxdepth 1 -type f -name '*.json' 2>/dev/null | head -20`,
    );
    const paths = findResult.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    await Promise.all(
      paths.map(async (filePath) => {
        try {
          const content = await sandbox.readFile(filePath);
          const created = await this.importIntegrationSkillDraftContent(ctx, content);
          if (created > 0) {
            await sandbox.execute(`rm -f "${filePath}"`);
          }
        } catch (error) {
          console.error(
            `[GenerationManager] Failed to import integration skill draft ${filePath}:`,
            error,
          );
        }
      }),
    );
  }

  private async importIntegrationSkillDraftContent(
    ctx: GenerationContext,
    rawContent: string,
  ): Promise<number> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return 0;
    }

    const drafts = Array.isArray(parsed) ? parsed : [parsed];
    let createdCount = 0;

    const creationResults = await Promise.all(
      drafts.map(async (draft) => {
        if (!draft || typeof draft !== "object") {
          return 0;
        }
        const rec = draft as Record<string, unknown>;
        const slug = typeof rec.slug === "string" ? rec.slug : "";
        const title = typeof rec.title === "string" ? rec.title : "";
        const description = typeof rec.description === "string" ? rec.description : "";
        if (!slug || !title || !description) {
          return 0;
        }

        const files = Array.isArray(rec.files)
          ? rec.files
              .map((entry) => {
                if (!entry || typeof entry !== "object") {
                  return null;
                }
                const e = entry as Record<string, unknown>;
                if (typeof e.path !== "string" || typeof e.content !== "string") {
                  return null;
                }
                return { path: e.path, content: e.content };
              })
              .filter((entry): entry is { path: string; content: string } => !!entry)
          : [];

        try {
          await createCommunityIntegrationSkill(ctx.userId, {
            slug,
            title,
            description,
            files,
            setAsPreferred: rec.setAsPreferred === true,
          });
          return 1;
        } catch (error) {
          console.warn(
            `[GenerationManager] Skipped integration skill draft for slug '${slug}':`,
            error instanceof Error ? error.message : error,
          );
          return 0;
        }
      }),
    );
    createdCount = creationResults.reduce<number>((sum, value) => sum + value, 0);

    return createdCount;
  }

  private async forEachSequential<T>(
    items: readonly T[],
    handler: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    const run = async (index: number): Promise<void> => {
      if (index >= items.length) {
        return;
      }
      await handler(items[index], index);
      await run(index + 1);
    };
    await run(0);
  }

  private async consumeAsyncStream<T>(
    stream: AsyncIterable<T>,
    onEvent: (event: T) => Promise<boolean | void>,
  ): Promise<void> {
    const iterator = stream[Symbol.asyncIterator]();
    const consumeNext = async (): Promise<void> => {
      const { value, done } = await iterator.next();
      if (done) {
        return;
      }
      const shouldStop = await onEvent(value);
      if (shouldStop) {
        return;
      }
      await consumeNext();
    };
    await consumeNext();
  }

  private async handleApprovalTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_approval" || !ctx.pendingApproval) {
      return;
    }

    console.log(`[GenerationManager] Approval timeout for generation ${ctx.id}, pausing sandbox`);

    ctx.status = "paused";

    // Update database
    await db
      .update(generation)
      .set({
        status: "paused",
        isPaused: true,
      })
      .where(eq(generation.id, ctx.id));

    await db
      .update(conversation)
      .set({ generationStatus: "paused" })
      .where(eq(conversation.id, ctx.conversationId));

    // Pause sandbox (if E2B supports it)
    // Note: E2B pause/resume is a beta feature
    // For now, we'll just keep the sandbox alive but paused in our state

    this.broadcast(ctx, { type: "status_change", status: "paused" });
  }

  private async handleAuthTimeout(ctx: GenerationContext): Promise<void> {
    if (ctx.status !== "awaiting_auth" || !ctx.pendingAuth) {
      return;
    }

    console.log(`[GenerationManager] Auth timeout for generation ${ctx.id}, cancelling`);

    await this.finishGeneration(ctx, "cancelled");
  }

  /**
   * Submit an auth result (called after OAuth completes)
   */
  async submitAuthResult(
    generationId: string,
    integration: string,
    success: boolean,
    userId: string,
  ): Promise<boolean> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return false;
    }

    if (ctx.userId !== userId) {
      throw new Error("Access denied");
    }

    if (!ctx.pendingAuth) {
      return false;
    }

    // Clear auth timeout
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
      ctx.authTimeoutId = undefined;
    }

    if (!success) {
      // User cancelled - resolve promise with failure (OpenCode plugin flow)
      if (ctx.authResolver) {
        ctx.authResolver({ success: false });
        ctx.authResolver = undefined;
      }
      await this.finishGeneration(ctx, "cancelled");
      return true;
    }

    // Track connected integration
    ctx.pendingAuth.connectedIntegrations.push(integration);

    const allConnected = ctx.pendingAuth.integrations.every((i) =>
      ctx.pendingAuth!.connectedIntegrations.includes(i),
    );

    if (allConnected) {
      // Resolve the auth promise if waiting (OpenCode plugin flow)
      if (ctx.authResolver) {
        ctx.authResolver({ success: true, userId: ctx.userId });
        ctx.authResolver = undefined;
      }

      // Broadcast result before clearing pendingAuth
      this.broadcast(ctx, {
        type: "auth_result",
        success: true,
        integrations: ctx.pendingAuth.connectedIntegrations,
      });

      // Clear pending auth and resume
      ctx.pendingAuth = null;
      ctx.status = "running";

      // Update database
      await db
        .update(generation)
        .set({
          status: "running",
          pendingAuth: null,
        })
        .where(eq(generation.id, ctx.id));

      await db
        .update(conversation)
        .set({ generationStatus: "generating" })
        .where(eq(conversation.id, ctx.conversationId));

      if (ctx.workflowRunId) {
        await db
          .update(workflowRun)
          .set({ status: "running" })
          .where(eq(workflowRun.id, ctx.workflowRunId));
      }
    } else {
      // Still waiting for more integrations - broadcast progress
      this.broadcast(ctx, {
        type: "auth_progress",
        connected: integration,
        remaining: ctx.pendingAuth.integrations.filter(
          (i) => !ctx.pendingAuth!.connectedIntegrations.includes(i),
        ),
      });
    }

    return true;
  }

  /**
   * Wait for user approval on a write operation (called by internal router from plugin).
   * This creates a pending approval request and waits for the user to respond.
   */
  async waitForApproval(
    generationId: string,
    request: {
      toolInput: Record<string, unknown>;
      integration: string;
      operation: string;
      command: string;
    },
  ): Promise<"allow" | "deny"> {
    const ctx = this.activeGenerations.get(generationId);
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord && !ctx) {
      return "deny";
    }

    const isSlackSendOperation =
      request.integration === "slack" &&
      (request.operation === "send" || /^\s*slack\s+send(?:\s|$)/.test(request.command));

    const autoApprove = ctx?.autoApprove ?? genRecord?.conversation.autoApprove ?? false;
    if (autoApprove && !isSlackSendOperation) {
      return "allow";
    }

    const toolUseId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingApproval: PendingApproval = {
      toolUseId,
      toolName: "Bash",
      toolInput: request.toolInput,
      requestedAt: new Date().toISOString(),
      integration: request.integration,
      operation: request.operation,
      command: request.command,
    };

    await db
      .update(generation)
      .set({
        status: "awaiting_approval",
        pendingApproval,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({ generationStatus: "awaiting_approval" })
      .where(eq(conversation.id, genRecord?.conversationId ?? ctx!.conversationId));

    if (ctx) {
      ctx.status = "awaiting_approval";
      ctx.pendingApproval = pendingApproval;
      this.broadcast(ctx, {
        type: "pending_approval",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        toolUseId,
        toolName: "Bash",
        toolInput: request.toolInput,
        integration: request.integration,
        operation: request.operation,
        command: request.command,
      });
    }

    const startedAt = Date.now();
    const pollDecision = async (): Promise<"allow" | "deny" | null> => {
      if (Date.now() - startedAt >= APPROVAL_TIMEOUT_MS) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      const latest = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
      });
      if (!latest) {
        return "deny";
      }

      const latestApproval = latest.pendingApproval as PendingApproval | null;
      if (!latestApproval || latestApproval.toolUseId !== toolUseId) {
        return pollDecision();
      }

      if (latestApproval.decision) {
        const resolvedDecision = latestApproval.decision;
        await db
          .update(generation)
          .set({
            status: "running",
            pendingApproval: null,
          })
          .where(eq(generation.id, generationId));
        await db
          .update(conversation)
          .set({ generationStatus: "generating" })
          .where(eq(conversation.id, genRecord?.conversationId ?? ctx!.conversationId));
        if (ctx && ctx.pendingApproval?.toolUseId === toolUseId) {
          ctx.pendingApproval = null;
          ctx.status = "running";
          this.broadcast(ctx, {
            type: "approval_result",
            toolUseId,
            decision: resolvedDecision === "allow" ? "approved" : "denied",
          });
        }
        return resolvedDecision;
      }

      return pollDecision();
    };

    const resolved = await pollDecision();
    if (resolved) {
      return resolved;
    }

    await db
      .update(generation)
      .set({
        status: "paused",
      })
      .where(eq(generation.id, generationId));
    await db
      .update(conversation)
      .set({ generationStatus: "paused" })
      .where(eq(conversation.id, genRecord?.conversationId ?? ctx!.conversationId));

    if (ctx && ctx.pendingApproval?.toolUseId === toolUseId) {
      await this.handleApprovalTimeout(ctx);
    }

    return "deny";
  }

  /**
   * Wait for OAuth authentication (called by internal router from plugin).
   * This creates a pending auth request and waits for the OAuth flow to complete.
   */
  async waitForAuth(
    generationId: string,
    request: {
      integration: string;
      reason?: string;
    },
  ): Promise<{ success: boolean; userId?: string }> {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return { success: false };
    }

    // Create a promise that resolves when OAuth completes
    return new Promise((resolve) => {
      ctx.status = "awaiting_auth";
      ctx.pendingAuth = {
        integrations: [request.integration],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
        reason: request.reason,
      };
      ctx.authResolver = resolve;

      // Update database
      db.update(generation)
        .set({
          status: "awaiting_auth",
          pendingAuth: ctx.pendingAuth,
        })
        .where(eq(generation.id, ctx.id))
        .then(() => {
          return db
            .update(conversation)
            .set({ generationStatus: "awaiting_auth" })
            .where(eq(conversation.id, ctx.conversationId));
        })
        .then(() => {
          if (!ctx.workflowRunId) {
            return;
          }
          return db
            .update(workflowRun)
            .set({ status: "awaiting_auth" })
            .where(eq(workflowRun.id, ctx.workflowRunId));
        })
        .catch((err) => console.error("[GenerationManager] DB update error:", err));

      // Notify subscribers
      this.broadcast(ctx, {
        type: "auth_needed",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        integrations: [request.integration],
        reason: request.reason,
      });

      // Start auth timeout
      ctx.authTimeoutId = setTimeout(() => {
        if (ctx.authResolver) {
          ctx.authResolver({ success: false });
          ctx.authResolver = undefined;
        }
        this.handleAuthTimeout(ctx);
      }, AUTH_TIMEOUT_MS);
    });
  }

  private async finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error",
  ): Promise<void> {
    // Clear any pending timeouts
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
    }
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
    }

    // NOTE: We set ctx.status AFTER broadcasting to subscribers to avoid a race condition
    // where the subscription loop sees the status change and exits before receiving the
    // terminal event (done/cancelled/error). The status is set after broadcast below.

    let messageId: string | undefined;

    if (status === "completed" || status === "cancelled") {
      // Update session ID
      if (status === "completed" && ctx.sessionId) {
        await db
          .update(conversation)
          .set({ opencodeSessionId: ctx.sessionId })
          .where(eq(conversation.id, ctx.conversationId));
      }

      // Auto-collect any new files created during generation (direct mode only)
      if (status === "completed" && ctx.sandbox && ctx.generationMarkerTime) {
        try {
          const excludePaths = Array.from(ctx.sentFilePaths || []);
          const newFiles = await collectNewSandboxFiles(
            ctx.sandbox,
            ctx.generationMarkerTime,
            excludePaths,
          );

          await Promise.all(
            newFiles.map(async (file) => {
              try {
                const fileRecord = await uploadSandboxFile({
                  path: file.path,
                  content: file.content,
                  conversationId: ctx.conversationId,
                  messageId: undefined, // Will be linked below
                });
                ctx.uploadedSandboxFileIds?.add(fileRecord.id);

                // Broadcast sandbox_file event
                this.broadcast(ctx, {
                  type: "sandbox_file",
                  fileId: fileRecord.id,
                  path: file.path,
                  filename: fileRecord.filename,
                  mimeType: fileRecord.mimeType,
                  sizeBytes: fileRecord.sizeBytes,
                });
              } catch (err) {
                console.warn(
                  `[GenerationManager] Failed to upload collected file ${file.path}:`,
                  err,
                );
              }
            }),
          );
        } catch (err) {
          console.error("[GenerationManager] Failed to collect new sandbox files:", err);
        }
      }

      const interruptionText = "Interrupted by user";
      const cancelledParts =
        status === "cancelled"
          ? [
              ...ctx.contentParts,
              ...(ctx.contentParts.some(
                (part): part is ContentPart & { type: "system" } =>
                  part.type === "system" && part.content === interruptionText,
              )
                ? []
                : ([{ type: "system", content: interruptionText }] as ContentPart[])),
            ]
          : ctx.contentParts;

      // Keep interruption marker in generation record snapshot too.
      if (status === "cancelled") {
        ctx.contentParts = cancelledParts;
      }

      // Save assistant message for completed and cancelled generations
      const [assistantMessage] = await db
        .insert(message)
        .values({
          conversationId: ctx.conversationId,
          role: "assistant",
          content:
            status === "cancelled"
              ? ctx.assistantContent || interruptionText
              : ctx.assistantContent || "I apologize, but I couldn't generate a response.",
          contentParts: cancelledParts.length > 0 ? cancelledParts : null,
          inputTokens: ctx.usage.inputTokens,
          outputTokens: ctx.usage.outputTokens,
        })
        .returning();

      messageId = assistantMessage.id;

      // Link uploaded sandbox files to the final assistant message
      const uploadedFileIds = Array.from(ctx.uploadedSandboxFileIds || []);
      if (status === "completed" && uploadedFileIds.length > 0) {
        const { sandboxFile } = await import("@/server/db/schema");
        const { inArray } = await import("drizzle-orm");
        await db
          .update(sandboxFile)
          .set({ messageId })
          .where(inArray(sandboxFile.id, uploadedFileIds));
      }

      // Generate title for new conversations
      if (status === "completed" && ctx.isNewConversation && ctx.assistantContent) {
        try {
          const title = await generateConversationTitle(
            ctx.userMessageContent,
            ctx.assistantContent,
          );
          if (title) {
            await db
              .update(conversation)
              .set({ title })
              .where(eq(conversation.id, ctx.conversationId));
          }
        } catch (err) {
          console.error("[GenerationManager] Failed to generate title:", err);
        }
      }
    }

    // Update generation record
    await db
      .update(generation)
      .set({
        status,
        messageId,
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        errorMessage: ctx.errorMessage,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
        completedAt: new Date(),
      })
      .where(eq(generation.id, ctx.id));

    // Update conversation status
    await db
      .update(conversation)
      .set({
        generationStatus:
          status === "completed" ? "complete" : status === "error" ? "error" : "idle",
      })
      .where(eq(conversation.id, ctx.conversationId));

    if (ctx.workflowRunId) {
      await db
        .update(workflowRun)
        .set({
          status:
            status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "error",
          finishedAt: new Date(),
          errorMessage: ctx.errorMessage,
        })
        .where(eq(workflowRun.id, ctx.workflowRunId));
    }

    // Notify subscribers BEFORE setting status to avoid race condition
    if (status === "completed" && messageId) {
      this.broadcast(ctx, {
        type: "done",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        messageId,
        usage: ctx.usage,
      });
    } else if (status === "cancelled") {
      this.broadcast(ctx, {
        type: "cancelled",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        messageId,
      });
    } else if (status === "error") {
      this.broadcast(ctx, {
        type: "error",
        message: ctx.errorMessage || "Unknown error",
      });
    }

    // Set status AFTER broadcast so subscription loop receives the terminal event
    // before seeing the status change
    ctx.status = status;

    // Cleanup
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
    this.activeGenerations.delete(ctx.id);
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
    this.conversationToGeneration.delete(ctx.conversationId);
  }

  private scheduleSave(ctx: GenerationContext): void {
    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }

    ctx.saveDebounceId = setTimeout(() => {
      this.saveProgress(ctx);
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveProgress(ctx: GenerationContext): Promise<void> {
    ctx.lastSaveAt = new Date();

    await db
      .update(generation)
      .set({
        contentParts: ctx.contentParts.length > 0 ? ctx.contentParts : null,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
      })
      .where(eq(generation.id, ctx.id));
  }

  private broadcast(ctx: GenerationContext, event: GenerationEvent): void {
    for (const subscriber of ctx.subscribers.values()) {
      try {
        subscriber.callback(event);
      } catch (err) {
        console.error("[GenerationManager] Subscriber callback error:", err);
      }
    }

    if (ctx.workflowRunId) {
      void this.recordWorkflowRunEvent(ctx.workflowRunId, event);
    }
  }

  private buildWorkflowPrompt(ctx: GenerationContext): string | null {
    if (!ctx.workflowPrompt && ctx.triggerPayload === undefined) {
      return null;
    }

    const sections = [
      ctx.workflowPrompt ? `## Workflow Instructions\n${ctx.workflowPrompt}` : null,
      ctx.workflowPromptDo ? `## Do\n${ctx.workflowPromptDo}` : null,
      ctx.workflowPromptDont ? `## Don't\n${ctx.workflowPromptDont}` : null,
      ctx.triggerPayload !== undefined
        ? `## Trigger Payload\n${JSON.stringify(ctx.triggerPayload, null, 2)}`
        : null,
    ].filter(Boolean);

    if (sections.length === 0) {
      return null;
    }
    return sections.join("\n\n");
  }

  private async recordWorkflowRunEvent(
    workflowRunId: string,
    event: GenerationEvent,
  ): Promise<void> {
    const loggableEvents = new Set([
      "tool_use",
      "tool_result",
      "pending_approval",
      "approval_result",
      "auth_needed",
      "auth_progress",
      "auth_result",
      "done",
      "error",
      "cancelled",
      "status_change",
    ]);

    if (!loggableEvents.has(event.type)) {
      return;
    }

    await db.insert(workflowRunEvent).values({
      workflowRunId,
      type: event.type,
      payload: event,
    });
  }
}

/**
 * Map a model ID to its provider ID.
 */
async function resolveProviderID(modelID: string): Promise<string> {
  if (await isOpencodeFreeModel(modelID)) {
    return "opencode";
  }
  if (modelID.startsWith("claude")) {
    return "anthropic";
  }
  if (
    modelID.startsWith("gpt") ||
    modelID.startsWith("o3") ||
    modelID.startsWith("o4") ||
    modelID.startsWith("codex")
  ) {
    return "openai";
  }
  if (modelID.startsWith("gemini")) {
    return "google";
  }
  if (modelID === "k2p5" || modelID === "kimi-k2-thinking") {
    return "kimi-for-coding";
  }
  return "anthropic"; // default
}

// Stable singleton across dev hot-reloads/module re-evaluation.
const globalForGenerationManager = globalThis as typeof globalThis & {
  __bapGenerationManager?: GenerationManager;
};

export const generationManager =
  globalForGenerationManager.__bapGenerationManager ?? new GenerationManager();

if (process.env.NODE_ENV !== "production") {
  globalForGenerationManager.__bapGenerationManager = generationManager;
}

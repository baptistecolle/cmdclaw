import type {
  Event as OpencodeEvent,
  OpencodeClient,
  Part as OpencodePart,
  PermissionRequest,
  QuestionRequest,
  ToolPart,
} from "@opencode-ai/sdk/v2/client";
import type { Sandbox } from "e2b";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import IORedis from "ioredis";
import path from "path";
import type { LLMBackend, ChatMessage, ContentBlock } from "@/server/ai/llm-backend";
import type { IntegrationType } from "@/server/oauth/config";
import type { SandboxBackend } from "@/server/sandbox/types";
import { env } from "@/env";
import { parseModelReference } from "@/lib/model-reference";
import { AnthropicBackend } from "@/server/ai/anthropic-backend";
import { LocalLLMBackend } from "@/server/ai/local-backend";
import { OpenAIBackend } from "@/server/ai/openai-backend";
import { resolveDefaultOpencodeFreeModel } from "@/server/ai/opencode-models";
import { checkToolPermissions, parseBashCommand } from "@/server/ai/permission-checker";
import { getDirectModeTools, toolCallToCommand } from "@/server/ai/tools";
import { db } from "@/server/db/client";
import {
  conversation,
  generation,
  message,
  messageAttachment,
  skill,
  workflow,
  workflowRun,
  workflowRunEvent,
  type ContentPart,
  type GenerationExecutionPolicy,
  type MessageTiming,
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
  buildQueueJobId,
  CHAT_GENERATION_JOB_NAME,
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME,
  GENERATION_AUTH_TIMEOUT_JOB_NAME,
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME,
  WORKFLOW_GENERATION_JOB_NAME,
  getQueue,
} from "@/server/queues";
import { buildRedisOptions } from "@/server/redis/connection-options";
import {
  getOrCreateSession,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox,
  getIntegrationSkillsSystemPrompt,
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
import { resolveSelectedPlatformSkillSlugs } from "@/server/services/platform-skill-service";
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
    parseModelReference(configured);
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
      artifacts?: {
        timing?: MessageTiming;
        attachments: Array<{
          id: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        }>;
        sandboxFiles: Array<{
          fileId: string;
          path: string;
          filename: string;
          mimeType: string;
          sizeBytes: number | null;
        }>;
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
  pendingMessageParts: Map<
    string,
    {
      firstQueuedAtMs: number;
      parts: OpencodePart[];
    }
  >;
  // BYOC fields
  backendType: BackendType;
  deviceId?: string;
  // Workflow fields
  workflowRunId?: string;
  allowedIntegrations?: IntegrationType[];
  autoApprove: boolean;
  allowedCustomIntegrations?: string[];
  workflowPrompt?: string;
  workflowPromptDo?: string;
  workflowPromptDont?: string;
  triggerPayload?: unknown;
  selectedPlatformSkillSlugs?: string[];
  // Sandbox file collection
  generationMarkerTime?: number;
  sandbox?: SandboxBackend;
  e2bSandbox?: import("e2b").Sandbox;
  sentFilePaths?: Set<string>;
  userStagedFilePaths?: Set<string>;
  uploadedSandboxFileIds?: Set<string>;
  agentInitStartedAt?: number;
  agentInitReadyAt?: number;
  agentInitFailedAt?: number;
  agentSandboxReadyAt?: number;
  agentSandboxMode?: "created" | "reused" | "unknown";
  phaseMarks?: Record<string, number>;
  phaseTimeline?: Array<{
    phase: string;
    atMs: number;
    elapsedMs: number;
  }>;
  lastCancellationCheckAt?: number;
  isFinalizing?: boolean;
}

type ToolUseMetadata = {
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

type PrePromptCacheRecord = {
  version: 1;
  cacheKey: string;
  writtenSkills: string[];
  writtenIntegrationSkills: string[];
  updatedAt: string;
};

const PRE_PROMPT_CACHE_PATH = "/app/.opencode/pre-prompt-cache.json";
const DEFAULT_MODEL_REFERENCE = "anthropic/claude-sonnet-4-6";

async function getDoneArtifacts(messageId: string): Promise<
  | {
      timing?: MessageTiming;
      attachments: Array<{
        id: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      }>;
      sandboxFiles: Array<{
        fileId: string;
        path: string;
        filename: string;
        mimeType: string;
        sizeBytes: number | null;
      }>;
    }
  | undefined
> {
  const messageRecord = await db.query.message.findFirst({
    where: eq(message.id, messageId),
    with: {
      attachments: true,
      sandboxFiles: true,
    },
  });

  if (!messageRecord) {
    return undefined;
  }

  return {
    timing: messageRecord.timing ?? undefined,
    attachments: messageRecord.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
    sandboxFiles: messageRecord.sandboxFiles.map((file) => ({
      fileId: file.id,
      path: file.path,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  };
}

// Approval timeout: 5 minutes before pausing sandbox
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
// Auth timeout: 10 minutes for OAuth flow
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;
const CANCELLATION_POLL_INTERVAL_MS = 1000;
const AGENT_PREPARING_TIMEOUT_MS = (() => {
  const seconds = Number(process.env.AGENT_PREPARING_TIMEOUT_SECONDS ?? "300");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5 * 60 * 1000;
  }
  return Math.floor(seconds * 1000);
})();
const OPENCODE_PROMPT_TIMEOUT_MS = (() => {
  const seconds = Number(process.env.OPENCODE_PROMPT_TIMEOUT_SECONDS ?? "180");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 3 * 60 * 1000;
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
type GenerationTimeoutKind = "approval" | "auth";
const STALE_REAPER_RUNNING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;
const STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS = 60 * 60 * 1000;
const STALE_REAPER_PAUSED_MAX_AGE_MS = 60 * 60 * 1000;
const PENDING_MESSAGE_PARTS_MAX_PER_MESSAGE = 100;
const PENDING_MESSAGE_PARTS_TTL_MS = 5 * 60 * 1000;
const MAX_TOOL_RESULT_CONTENT_CHARS = 100_000;

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

function buildExecutionPolicy(params: {
  allowedIntegrations?: IntegrationType[];
  allowedCustomIntegrations?: string[];
  autoApprove: boolean;
  selectedPlatformSkillSlugs?: string[];
}): GenerationExecutionPolicy {
  return {
    allowedIntegrations: params.allowedIntegrations,
    allowedCustomIntegrations: params.allowedCustomIntegrations,
    autoApprove: params.autoApprove,
    selectedPlatformSkillSlugs: params.selectedPlatformSkillSlugs,
  };
}

function getSelectedPlatformSkillPrompt(selectedPlatformSkillSlugs: string[] | undefined): string {
  if (!selectedPlatformSkillSlugs || selectedPlatformSkillSlugs.length === 0) {
    return "";
  }

  const list = selectedPlatformSkillSlugs.map((slug) => `- ${slug}`).join("\n");
  const paths = selectedPlatformSkillSlugs
    .map((slug) => `- /app/.claude/skills/${slug}/SKILL.md`)
    .join("\n");
  return [
    "# Selected Platform Skills",
    "The user selected these platform skills for this generation:",
    list,
    "Prioritize these selected skills before using other platform skills.",
    "Read and follow these SKILL.md files first:",
    paths,
  ].join("\n");
}

function computeExpiryIso(timeoutMs: number): string {
  return new Date(Date.now() + timeoutMs).toISOString();
}

function resolveExpiryMs(
  expiresAt: string | undefined,
  requestedAt: string | undefined,
  timeoutMs: number,
): number {
  const explicit = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const requested = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  if (Number.isFinite(requested)) {
    return requested + timeoutMs;
  }
  return Date.now() + timeoutMs;
}

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

    // Allow common sandbox working directories without interactive approval.
    if (
      permissionType === "external_directory" &&
      (normalized.startsWith("/tmp") ||
        normalized.startsWith("/app") ||
        normalized.startsWith("/home"))
    ) {
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

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... (output truncated)`;
}

function limitToolResultContent(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateString(value, MAX_TOOL_RESULT_CONTENT_CHARS);
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_TOOL_RESULT_CONTENT_CHARS) {
      return value;
    }
    return truncateString(serialized, MAX_TOOL_RESULT_CONTENT_CHARS);
  } catch {
    return truncateString(String(value), MAX_TOOL_RESULT_CONTENT_CHARS);
  }
}

class GenerationManager {
  private activeGenerations = new Map<string, GenerationContext>();
  private activeSubscriptionCounts = new Map<string, number>();
  private streamCounters = {
    opened: 0,
    closed: 0,
    timedOut: 0,
    deduped: 0,
  };

  private shouldDeferGenerationToWorker(): boolean {
    return process.env.VERCEL === "1";
  }

  private getSubscriptionKey(generationId: string, userId: string): string {
    return `${generationId}:${userId}`;
  }

  getStreamCountersSnapshot(): {
    opened: number;
    closed: number;
    timedOut: number;
    deduped: number;
    active: number;
  } {
    let active = 0;
    for (const value of this.activeSubscriptionCounts.values()) {
      active += value;
    }
    return {
      ...this.streamCounters,
      active,
    };
  }

  private evictActiveGenerationContext(generationId: string): void {
    const ctx = this.activeGenerations.get(generationId);
    if (!ctx) {
      return;
    }

    if (ctx.saveDebounceId) {
      clearTimeout(ctx.saveDebounceId);
    }
    if (ctx.approvalTimeoutId) {
      clearTimeout(ctx.approvalTimeoutId);
    }
    if (ctx.authTimeoutId) {
      clearTimeout(ctx.authTimeoutId);
    }

    ctx.pendingMessageParts.clear();
    ctx.subscribers.clear();

    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
    this.activeGenerations.delete(generationId);
  }

  private pruneStalePendingMessageParts(ctx: GenerationContext): void {
    const now = Date.now();
    for (const [messageID, queued] of ctx.pendingMessageParts.entries()) {
      if (now - queued.firstQueuedAtMs > PENDING_MESSAGE_PARTS_TTL_MS) {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
        ctx.pendingMessageParts.delete(messageID);
      }
    }
  }

  private getLockRedis(): IORedis {
    const globalForLocks = globalThis as typeof globalThis & { __bapGenerationLockRedis?: IORedis };
    if (!globalForLocks.__bapGenerationLockRedis) {
      globalForLocks.__bapGenerationLockRedis = new IORedis(
        buildRedisOptions(process.env.REDIS_URL ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
      );
    }
    return globalForLocks.__bapGenerationLockRedis;
  }

  private async acquireGenerationLease(generationId: string): Promise<string | null> {
    if (process.env.NODE_ENV === "test") {
      return `local-${generationId}`;
    }
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for durable generation lease locking.");
    }
    const token = crypto.randomUUID();
    const leaseKey = `locks:generation:${generationId}`;
    const result = await this.getLockRedis().set(leaseKey, token, "PX", 120_000, "NX");
    return result === "OK" ? token : null;
  }

  private async renewGenerationLease(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = `locks:generation:${generationId}`;
    const owner = await this.getLockRedis().get(leaseKey);
    if (owner !== token) {
      return;
    }
    await this.getLockRedis().pexpire(leaseKey, 120_000);
  }

  private async releaseGenerationLease(generationId: string, token: string): Promise<void> {
    if (token.startsWith("local-")) {
      return;
    }
    const leaseKey = `locks:generation:${generationId}`;
    const owner = await this.getLockRedis().get(leaseKey);
    if (owner === token) {
      await this.getLockRedis().del(leaseKey);
    }
  }

  private async enqueueGenerationRun(
    generationId: string,
    type: "chat" | "workflow",
  ): Promise<void> {
    const queue = getQueue();
    const jobName = type === "workflow" ? WORKFLOW_GENERATION_JOB_NAME : CHAT_GENERATION_JOB_NAME;
    await queue.add(
      jobName,
      { generationId },
      {
        jobId: buildQueueJobId([jobName, generationId]),
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private async enqueueGenerationTimeout(
    generationId: string,
    kind: GenerationTimeoutKind,
    expiresAtIso: string,
  ): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    const queue = getQueue();
    const runAt = Date.parse(expiresAtIso);
    const delay = Math.max(0, Number.isFinite(runAt) ? runAt - Date.now() : 0);
    const timeoutKey =
      Number.isFinite(runAt) && runAt > 0
        ? String(runAt)
        : expiresAtIso.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
    const jobName =
      kind === "approval" ? GENERATION_APPROVAL_TIMEOUT_JOB_NAME : GENERATION_AUTH_TIMEOUT_JOB_NAME;
    const jobId = buildQueueJobId([jobName, generationId, timeoutKey]);
    await queue.add(
      jobName,
      { generationId, kind, expiresAt: expiresAtIso },
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }

  private async enqueuePreparingStuckCheck(generationId: string): Promise<void> {
    try {
      const queue = getQueue();
      const jobName = GENERATION_PREPARING_STUCK_CHECK_JOB_NAME;
      await queue.add(
        jobName,
        { generationId },
        {
          jobId: buildQueueJobId([jobName, generationId]),
          delay: AGENT_PREPARING_TIMEOUT_MS,
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      logServerEvent(
        "warn",
        "GENERATION_PREPARING_STUCK_CHECK_ENQUEUE_FAILED",
        {
          generationId,
          error: formatErrorMessage(error),
        },
        { source: "generation-manager" },
      );
    }
  }

  private getExecutionPolicyFromRecord(
    genRecord: typeof generation.$inferSelect,
    fallbackAutoApprove: boolean,
  ): {
    allowedIntegrations?: IntegrationType[];
    allowedCustomIntegrations?: string[];
    autoApprove?: boolean;
    selectedPlatformSkillSlugs?: string[];
  } {
    const policy =
      (genRecord.executionPolicy as GenerationExecutionPolicy | null | undefined) ?? undefined;
    const allowedIntegrations = Array.isArray(policy?.allowedIntegrations)
      ? (policy.allowedIntegrations.filter(
          (entry): entry is IntegrationType => typeof entry === "string",
        ) as IntegrationType[])
      : undefined;
    return {
      allowedIntegrations,
      allowedCustomIntegrations: policy?.allowedCustomIntegrations,
      autoApprove: policy?.autoApprove ?? fallbackAutoApprove,
      selectedPlatformSkillSlugs: Array.isArray(policy?.selectedPlatformSkillSlugs)
        ? policy.selectedPlatformSkillSlugs.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : undefined,
    };
  }

  private markPhase(ctx: GenerationContext, phase: string): void {
    const now = Date.now();
    const startedAtMs = ctx.startedAt.getTime();
    if (!ctx.phaseMarks) {
      ctx.phaseMarks = {};
    }
    if (!ctx.phaseTimeline) {
      ctx.phaseTimeline = [];
    }
    if (ctx.phaseMarks[phase] === undefined) {
      ctx.phaseMarks[phase] = now;
    }
    ctx.phaseTimeline.push({
      phase,
      atMs: now,
      elapsedMs: Math.max(0, now - startedAtMs),
    });
  }

  private buildMessageTiming(ctx: GenerationContext): MessageTiming {
    const generationCompletedAt = Date.now();
    const generationStartedAt = ctx.startedAt.getTime();
    const phaseMarks = ctx.phaseMarks ?? {};
    const phaseTimeline = ctx.phaseTimeline ?? [];
    const messageTiming: MessageTiming = {
      generationDurationMs: Math.max(0, generationCompletedAt - generationStartedAt),
    };
    const sandboxConnectStartMs =
      phaseMarks.agent_init_sandbox_checking_cache ?? phaseMarks.agent_init_started;
    const sandboxConnectEndMs =
      phaseMarks.agent_init_sandbox_reused ?? phaseMarks.agent_init_sandbox_created;
    const sandboxConnectOrCreateMs =
      sandboxConnectStartMs !== undefined && sandboxConnectEndMs !== undefined
        ? Math.max(0, sandboxConnectEndMs - sandboxConnectStartMs)
        : undefined;
    const opencodeReadyMs =
      phaseMarks.agent_init_opencode_starting !== undefined &&
      phaseMarks.agent_init_opencode_ready !== undefined
        ? Math.max(
            0,
            phaseMarks.agent_init_opencode_ready - phaseMarks.agent_init_opencode_starting,
          )
        : undefined;
    const sessionReadyMs =
      phaseMarks.agent_init_session_reused !== undefined && sandboxConnectEndMs !== undefined
        ? Math.max(0, phaseMarks.agent_init_session_reused - sandboxConnectEndMs)
        : phaseMarks.agent_init_session_creating !== undefined &&
            phaseMarks.agent_init_session_init_completed !== undefined
          ? Math.max(
              0,
              phaseMarks.agent_init_session_init_completed - phaseMarks.agent_init_session_creating,
            )
          : undefined;
    const legacySandboxStartupMs =
      ctx.agentInitStartedAt && ctx.agentSandboxReadyAt
        ? Math.max(0, ctx.agentSandboxReadyAt - ctx.agentInitStartedAt)
        : undefined;
    const resolvedSandboxStartupMs = sandboxConnectOrCreateMs ?? legacySandboxStartupMs;
    if (resolvedSandboxStartupMs !== undefined) {
      messageTiming.sandboxStartupDurationMs = resolvedSandboxStartupMs;
      messageTiming.sandboxStartupMode = ctx.agentSandboxMode ?? "unknown";
    }

    const agentInitMs =
      phaseMarks.agent_init_started !== undefined && phaseMarks.agent_init_ready !== undefined
        ? Math.max(0, phaseMarks.agent_init_ready - phaseMarks.agent_init_started)
        : undefined;
    const prePromptSetupMs =
      phaseMarks.pre_prompt_setup_started !== undefined && phaseMarks.prompt_sent !== undefined
        ? Math.max(0, phaseMarks.prompt_sent - phaseMarks.pre_prompt_setup_started)
        : undefined;
    const agentReadyToPromptMs =
      phaseMarks.agent_init_ready !== undefined && phaseMarks.prompt_sent !== undefined
        ? Math.max(0, phaseMarks.prompt_sent - phaseMarks.agent_init_ready)
        : undefined;
    const waitForFirstEventMs =
      phaseMarks.prompt_sent !== undefined && phaseMarks.first_event_received !== undefined
        ? Math.max(0, phaseMarks.first_event_received - phaseMarks.prompt_sent)
        : undefined;
    const streamFinishedAt = phaseMarks.session_idle ?? phaseMarks.prompt_completed;
    const modelStreamMs =
      phaseMarks.first_event_received !== undefined && streamFinishedAt !== undefined
        ? Math.max(0, streamFinishedAt - phaseMarks.first_event_received)
        : undefined;
    const postProcessingMs =
      phaseMarks.post_processing_started !== undefined &&
      phaseMarks.post_processing_completed !== undefined
        ? Math.max(0, phaseMarks.post_processing_completed - phaseMarks.post_processing_started)
        : undefined;

    const phaseDurationsMs = {
      sandboxConnectOrCreateMs,
      opencodeReadyMs,
      sessionReadyMs,
      agentInitMs,
      prePromptSetupMs,
      agentReadyToPromptMs,
      waitForFirstEventMs,
      modelStreamMs,
      postProcessingMs,
    };
    if (Object.values(phaseDurationsMs).some((value) => value !== undefined)) {
      messageTiming.phaseDurationsMs = phaseDurationsMs;
    }

    if (phaseTimeline.length > 0) {
      messageTiming.phaseTimestamps = phaseTimeline.map((entry) => ({
        phase: entry.phase,
        at: new Date(entry.atMs).toISOString(),
        elapsedMs: entry.elapsedMs,
      }));
    }

    return messageTiming;
  }

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
    selectedPlatformSkillSlugs?: string[];
  }): Promise<{ generationId: string; conversationId: string }> {
    const { content, userId, model, autoApprove } = params;
    const requestedModel = model?.trim();
    if (requestedModel) {
      parseModelReference(requestedModel);
    }
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
        selectedPlatformSkillCount: params.selectedPlatformSkillSlugs?.length ?? 0,
      },
      logContext,
    );

    if (params.conversationId) {
      // Cross-instance guard (DB is source of truth).
      const existing = await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, params.conversationId),
          inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        ),
        columns: {
          id: true,
          status: true,
        },
      });
      if (existing) {
        throw new Error(
          `Generation already in progress for this conversation (${existing.id}, status=${existing.status})`,
        );
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
          model: requestedModel ?? DEFAULT_MODEL_REFERENCE,
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

    const selectedPlatformSkillSlugs = await resolveSelectedPlatformSkillSlugs(
      params.selectedPlatformSkillSlugs,
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
        executionPolicy: buildExecutionPolicy({
          allowedIntegrations: params.allowedIntegrations,
          autoApprove: conv.autoApprove,
          selectedPlatformSkillSlugs,
        }),
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
    await this.enqueuePreparingStuckCheck(genRecord.id);
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
    if (this.shouldDeferGenerationToWorker() && backendType === "direct") {
      throw new Error(
        "Direct device generations require a dedicated stateful runtime and are not supported on Vercel functions.",
      );
    }

    if (this.shouldDeferGenerationToWorker()) {
      await this.enqueueGenerationRun(genRecord.id, "chat");
      logServerEvent(
        "info",
        "GENERATION_ENQUEUED",
        { backendType, delivery: "queue" },
        {
          source: "generation-manager",
          traceId,
          generationId: genRecord.id,
          conversationId: conv.id,
          userId,
        },
      );
      return {
        generationId: genRecord.id,
        conversationId: conv.id,
      };
    }

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
      model: requestedModel ?? conv.model ?? DEFAULT_MODEL_REFERENCE,
      userMessageContent: content,
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      backendType,
      deviceId: params.deviceId,
      allowedIntegrations: params.allowedIntegrations,
      autoApprove: conv.autoApprove,
      attachments: params.attachments,
      selectedPlatformSkillSlugs,
      userStagedFilePaths: new Set(),
      uploadedSandboxFileIds: new Set(),
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
      phaseMarks: {},
      phaseTimeline: [],
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.markPhase(ctx, "generation_started");

    logServerEvent(
      "info",
      "GENERATION_ENQUEUED",
      { backendType, delivery: "in_process" },
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
        executionPolicy: buildExecutionPolicy({
          allowedIntegrations: params.allowedIntegrations,
          allowedCustomIntegrations: params.allowedCustomIntegrations,
          autoApprove: params.autoApprove,
          selectedPlatformSkillSlugs: undefined,
        }),
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

    if (this.shouldDeferGenerationToWorker()) {
      await this.enqueueGenerationRun(genRecord.id, "workflow");
      logServerEvent(
        "info",
        "WORKFLOW_GENERATION_ENQUEUED",
        { delivery: "queue" },
        {
          source: "generation-manager",
          traceId: createTraceId(),
          generationId: genRecord.id,
          conversationId: newConv.id,
          userId,
        },
      );
      return {
        generationId: genRecord.id,
        conversationId: newConv.id,
      };
    }

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
      workflowPrompt: undefined,
      workflowPromptDo: undefined,
      workflowPromptDont: undefined,
      triggerPayload: undefined,
      selectedPlatformSkillSlugs: undefined,
      userStagedFilePaths: new Set(),
      uploadedSandboxFileIds: new Set(),
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
      phaseMarks: {},
      phaseTimeline: [],
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.markPhase(ctx, "generation_started");

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

  async runQueuedGeneration(generationId: string): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return;
    }
    if (!genRecord.conversation.userId) {
      return;
    }

    const latestUserMessage = await db.query.message.findFirst({
      where: and(eq(message.conversationId, genRecord.conversationId), eq(message.role, "user")),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      columns: { content: true },
    });
    const linkedWorkflowRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { id: true, workflowId: true, triggerPayload: true },
    });
    const linkedWorkflow = linkedWorkflowRun
      ? await db.query.workflow.findFirst({
          where: eq(workflow.id, linkedWorkflowRun.workflowId),
          columns: {
            allowedIntegrations: true,
            allowedCustomIntegrations: true,
            prompt: true,
            promptDo: true,
            promptDont: true,
            autoApprove: true,
          },
        })
      : null;
    const executionPolicy = this.getExecutionPolicyFromRecord(
      genRecord,
      linkedWorkflow?.autoApprove ?? genRecord.conversation.autoApprove,
    );

    const ctx: GenerationContext = {
      id: genRecord.id,
      traceId: createTraceId(),
      conversationId: genRecord.conversationId,
      userId: genRecord.conversation.userId,
      status: genRecord.status,
      contentParts: (genRecord.contentParts as ContentPart[] | null) ?? [],
      assistantContent: "",
      subscribers: new Map(),
      abortController: new AbortController(),
      pendingApproval: (genRecord.pendingApproval as PendingApproval | null) ?? null,
      pendingAuth: (genRecord.pendingAuth as PendingAuth | null) ?? null,
      usage: {
        inputTokens: genRecord.inputTokens,
        outputTokens: genRecord.outputTokens,
        totalCostUsd: 0,
      },
      startedAt: genRecord.startedAt,
      lastSaveAt: new Date(),
      isNewConversation: false,
      model: genRecord.conversation.model ?? DEFAULT_MODEL_REFERENCE,
      userMessageContent: latestUserMessage?.content ?? "",
      assistantMessageIds: new Set(),
      messageRoles: new Map(),
      pendingMessageParts: new Map(),
      backendType: "opencode",
      workflowRunId: linkedWorkflowRun?.id,
      allowedIntegrations:
        executionPolicy.allowedIntegrations ??
        (linkedWorkflow?.allowedIntegrations as IntegrationType[] | null | undefined) ??
        undefined,
      autoApprove:
        executionPolicy.autoApprove ??
        linkedWorkflow?.autoApprove ??
        genRecord.conversation.autoApprove,
      allowedCustomIntegrations:
        executionPolicy.allowedCustomIntegrations ??
        linkedWorkflow?.allowedCustomIntegrations ??
        undefined,
      workflowPrompt: undefined,
      workflowPromptDo: undefined,
      workflowPromptDont: undefined,
      triggerPayload: undefined,
      selectedPlatformSkillSlugs: executionPolicy.selectedPlatformSkillSlugs,
      userStagedFilePaths: new Set(),
      uploadedSandboxFileIds: new Set(),
      agentInitStartedAt: undefined,
      agentInitReadyAt: undefined,
      agentInitFailedAt: undefined,
      phaseMarks: {},
      phaseTimeline: [],
    };

    this.activeGenerations.set(genRecord.id, ctx);
    this.markPhase(ctx, "generation_started");
    if (ctx.status === "awaiting_approval" && ctx.pendingApproval?.expiresAt) {
      await this.enqueueGenerationTimeout(ctx.id, "approval", ctx.pendingApproval.expiresAt);
    }
    if (ctx.status === "awaiting_auth" && ctx.pendingAuth?.expiresAt) {
      await this.enqueueGenerationTimeout(ctx.id, "auth", ctx.pendingAuth.expiresAt);
    }
    if (
      ctx.status === "awaiting_approval" &&
      ctx.pendingApproval &&
      Date.now() >=
        resolveExpiryMs(
          ctx.pendingApproval.expiresAt,
          ctx.pendingApproval.requestedAt,
          APPROVAL_TIMEOUT_MS,
        )
    ) {
      await this.processGenerationTimeout(ctx.id, "approval");
      return;
    }
    if (
      ctx.status === "awaiting_auth" &&
      ctx.pendingAuth &&
      Date.now() >=
        resolveExpiryMs(ctx.pendingAuth.expiresAt, ctx.pendingAuth.requestedAt, AUTH_TIMEOUT_MS)
    ) {
      await this.processGenerationTimeout(ctx.id, "auth");
      return;
    }

    if (
      ctx.status === "awaiting_approval" &&
      ctx.pendingApproval?.opencodeRequestId &&
      ctx.pendingApproval?.opencodeRequestKind
    ) {
      const decision = await this.waitForOpenCodeApprovalDecision(
        ctx.id,
        ctx.pendingApproval.toolUseId,
      );
      if (!decision) {
        await this.handleApprovalTimeout(ctx);
        return;
      }
      await this.applyOpenCodeApprovalDecision(ctx, decision.decision, decision.questionAnswers);
      return;
    }

    await this.runGeneration(ctx);
  }

  /**
   * Subscribe to a generation's events
   */
  async *subscribeToGeneration(
    generationId: string,
    userId: string,
  ): AsyncGenerator<GenerationEvent, void, unknown> {
    const getReplayToolUseMetadata = (
      part: Extract<ContentPart, { type: "tool_use" }>,
    ): ToolUseMetadata => {
      if (part.integration || part.operation) {
        return {
          integration: part.integration,
          operation: part.operation,
        };
      }
      const parsed = this.getToolUseMetadata(part.name, part.input);
      if (!parsed.integration && !parsed.operation) {
        return {};
      }
      return parsed;
    };

    const emitPartEvent = (part: ContentPart, allParts: ContentPart[]): GenerationEvent | null => {
      if (part.type === "text") {
        return { type: "text", content: part.text };
      }
      if (part.type === "tool_use") {
        const metadata = getReplayToolUseMetadata(part);
        return {
          type: "tool_use",
          toolName: part.name,
          toolInput: part.input,
          toolUseId: part.id,
          integration: metadata.integration,
          operation: metadata.operation,
          isWrite: metadata.isWrite,
        };
      }
      if (part.type === "tool_result") {
        const toolUse = allParts.find(
          (p): p is ContentPart & { type: "tool_use" } =>
            p.type === "tool_use" && p.id === part.tool_use_id,
        );
        return {
          type: "tool_result",
          toolName: toolUse?.name ?? "unknown",
          result: part.content,
          toolUseId: part.tool_use_id,
        };
      }
      if (part.type === "thinking") {
        return {
          type: "thinking",
          content: part.content,
          thinkingId: part.id,
        };
      }
      return null;
    };

    const initial = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!initial) {
      yield { type: "error", message: "Generation not found" };
      return;
    }
    if (initial.conversation.userId !== userId) {
      yield { type: "error", message: "Access denied" };
      return;
    }

    const subscriptionKey = this.getSubscriptionKey(generationId, userId);
    const existingSubscriptionCount = this.activeSubscriptionCounts.get(subscriptionKey) ?? 0;
    if (existingSubscriptionCount > 0) {
      this.streamCounters.deduped += 1;
      logServerEvent(
        "info",
        "GENERATION_STREAM_DUPLICATE_DETECTED",
        {
          ...this.getStreamCountersSnapshot(),
          existingSubscriptionCount,
        },
        {
          source: "generation-manager",
          generationId: initial.id,
          conversationId: initial.conversationId,
          userId,
        },
      );
    }

    this.activeSubscriptionCounts.set(subscriptionKey, existingSubscriptionCount + 1);
    this.streamCounters.opened += 1;

    const basePollIntervalMs = 500;
    const maxPollIntervalMs = initial.conversation.type === "workflow" ? 5_000 : 3_000;
    const awaitingPollFloorMs = 2_000;
    const heartbeatIntervalMs = 10_000;
    const maxWaitMs = initial.conversation.type === "workflow" ? 10 * 60 * 1000 : 3 * 60 * 1000;
    const startedAt = Date.now();
    const streamId = createTraceId();
    let lastHeartbeatAt = 0;
    let lastStatus: typeof generation.$inferSelect.status | null = null;
    let emittedPendingApprovalToolUseId: string | null = null;
    let emittedPendingAuthRequestedAt: string | null = null;
    let observedParts: ContentPart[] = [];
    let nextPollDelayMs = 0;
    let idlePollStreak = 0;
    let terminated = false;
    let terminatedBy:
      | "completed"
      | "cancelled"
      | "error"
      | "not_found"
      | "access_denied"
      | "timeout"
      | null = null;
    let polls = 0;
    let eventsYielded = 0;
    let activityPolls = 0;
    let idlePolls = 0;

    try {
      const poll = async function* (): AsyncGenerator<GenerationEvent, void, unknown> {
        if (Date.now() - startedAt >= maxWaitMs || terminated) {
          return;
        }

        if (nextPollDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, nextPollDelayMs));
        }

        polls += 1;
        const latest = await db.query.generation.findFirst({
          where: eq(generation.id, generationId),
          with: { conversation: true },
        });

        if (!latest) {
          terminated = true;
          terminatedBy = "not_found";
          eventsYielded += 1;
          yield { type: "error", message: "Generation not found" };
          return;
        }
        if (latest.conversation.userId !== userId) {
          terminated = true;
          terminatedBy = "access_denied";
          eventsYielded += 1;
          yield { type: "error", message: "Access denied" };
          return;
        }

        let hadActivity = false;
        const latestParts = (latest.contentParts ?? []) as ContentPart[];
        const sharedLength = Math.min(observedParts.length, latestParts.length);
        for (let i = 0; i < sharedLength; i += 1) {
          const previousPart = observedParts[i];
          const currentPart = latestParts[i];
          if (
            previousPart.type === "text" &&
            currentPart.type === "text" &&
            currentPart.text.length > previousPart.text.length
          ) {
            hadActivity = true;
            eventsYielded += 1;
            yield { type: "text", content: currentPart.text.slice(previousPart.text.length) };
          }
        }
        for (let i = observedParts.length; i < latestParts.length; i += 1) {
          const partEvent = emitPartEvent(latestParts[i], latestParts);
          if (partEvent) {
            hadActivity = true;
            eventsYielded += 1;
            yield partEvent;
          }
        }
        observedParts = latestParts;

        if (latest.status !== lastStatus) {
          hadActivity = true;
          lastStatus = latest.status;
          eventsYielded += 1;
          yield { type: "status_change", status: latest.status };
        } else if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
          lastHeartbeatAt = Date.now();
          eventsYielded += 1;
          yield { type: "status_change", status: latest.status };
        }

        if (latest.status === "awaiting_approval" && latest.pendingApproval) {
          const pendingApproval = latest.pendingApproval as PendingApproval;
          if (emittedPendingApprovalToolUseId !== pendingApproval.toolUseId) {
            hadActivity = true;
            emittedPendingApprovalToolUseId = pendingApproval.toolUseId;
            eventsYielded += 1;
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

        if (latest.status === "awaiting_auth" && latest.pendingAuth) {
          const pendingAuth = latest.pendingAuth as PendingAuth;
          if (emittedPendingAuthRequestedAt !== pendingAuth.requestedAt) {
            hadActivity = true;
            emittedPendingAuthRequestedAt = pendingAuth.requestedAt;
            eventsYielded += 1;
            yield {
              type: "auth_needed",
              generationId: latest.id,
              conversationId: latest.conversationId,
              integrations: pendingAuth.integrations,
              reason: pendingAuth.reason,
            };
          }
        }

        if (latest.status === "completed" && latest.messageId) {
          const artifacts = await getDoneArtifacts(latest.messageId);
          terminated = true;
          terminatedBy = "completed";
          eventsYielded += 1;
          yield {
            type: "done",
            generationId: latest.id,
            conversationId: latest.conversationId,
            messageId: latest.messageId,
            usage: {
              inputTokens: latest.inputTokens,
              outputTokens: latest.outputTokens,
              totalCostUsd: 0,
            },
            artifacts,
          };
          return;
        }
        if (latest.status === "cancelled") {
          terminated = true;
          terminatedBy = "cancelled";
          eventsYielded += 1;
          yield {
            type: "cancelled",
            generationId: latest.id,
            conversationId: latest.conversationId,
            messageId: latest.messageId ?? undefined,
          };
          return;
        }
        if (latest.status === "error") {
          terminated = true;
          terminatedBy = "error";
          eventsYielded += 1;
          yield {
            type: "error",
            message: latest.errorMessage || "Unknown error",
          };
          return;
        }

        if (hadActivity) {
          activityPolls += 1;
          idlePollStreak = 0;
          nextPollDelayMs = basePollIntervalMs;
        } else {
          idlePolls += 1;
          idlePollStreak += 1;
          const dynamicFloorMs =
            latest.status === "awaiting_approval" || latest.status === "awaiting_auth"
              ? awaitingPollFloorMs
              : basePollIntervalMs;
          const backoffMultiplier = Math.pow(2, Math.min(4, Math.floor(idlePollStreak / 2)));
          nextPollDelayMs = Math.min(maxPollIntervalMs, dynamicFloorMs * backoffMultiplier);
        }

        yield* poll();
      };

      yield* poll();

      if (!terminated) {
        const errorMessage =
          "Generation is still processing but cannot be streamed from this server yet. Please refresh shortly.";
        terminatedBy = "timeout";
        this.streamCounters.timedOut += 1;
        logServerEvent(
          "warn",
          "GENERATION_STREAM_POLL_TIMEOUT",
          {
            status: lastStatus,
            maxWaitMs,
            conversationType: initial.conversation.type,
            streamId,
            polls,
            eventsYielded,
            activityPolls,
            idlePolls,
          },
          {
            source: "generation-manager",
            generationId: initial.id,
            conversationId: initial.conversationId,
            userId,
          },
        );
        eventsYielded += 1;
        yield { type: "error", message: errorMessage };
      }
    } finally {
      const currentCount = this.activeSubscriptionCounts.get(subscriptionKey) ?? 0;
      if (currentCount <= 1) {
        this.activeSubscriptionCounts.delete(subscriptionKey);
      } else {
        this.activeSubscriptionCounts.set(subscriptionKey, currentCount - 1);
      }
      this.streamCounters.closed += 1;

      logServerEvent(
        "info",
        "GENERATION_STREAM_SUBSCRIPTION_SUMMARY",
        {
          ...this.getStreamCountersSnapshot(),
          streamId,
          durationMs: Date.now() - startedAt,
          maxWaitMs,
          polls,
          eventsYielded,
          activityPolls,
          idlePolls,
          termination: terminatedBy ?? "consumer_closed",
          conversationType: initial.conversation.type,
        },
        {
          source: "generation-manager",
          generationId: initial.id,
          conversationId: initial.conversationId,
          userId,
        },
      );
    }
  }

  /**
   * Cancel a generation
   */
  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
      columns: {
        id: true,
        status: true,
      },
    });
    if (!genRecord) {
      return false;
    }

    if (genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }

    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return true;
    }

    await db
      .update(generation)
      .set({ cancelRequestedAt: new Date() })
      .where(eq(generation.id, generationId));

    const ctx = this.activeGenerations.get(generationId);
    if (ctx) {
      ctx.abortController.abort();
    }

    return true;
  }

  async resumeGeneration(generationId: string, userId: string): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (!genRecord.conversation.userId || genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return false;
    }

    const pendingApproval = genRecord.pendingApproval as PendingApproval | null;
    const pendingAuth = genRecord.pendingAuth as PendingAuth | null;
    const nextStatus: GenerationStatus = pendingApproval
      ? "awaiting_approval"
      : pendingAuth
        ? "awaiting_auth"
        : "running";

    await db
      .update(generation)
      .set({
        status: nextStatus,
        isPaused: false,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({
        generationStatus:
          nextStatus === "running"
            ? "generating"
            : nextStatus === "awaiting_approval"
              ? "awaiting_approval"
              : "awaiting_auth",
      })
      .where(eq(conversation.id, genRecord.conversationId));

    const linkedRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { id: true },
    });
    if (linkedRun?.id) {
      await db
        .update(workflowRun)
        .set({
          status:
            nextStatus === "running"
              ? "running"
              : nextStatus === "awaiting_approval"
                ? "awaiting_approval"
                : "awaiting_auth",
        })
        .where(eq(workflowRun.id, linkedRun.id));
    }

    const runType: "chat" | "workflow" = linkedRun ? "workflow" : "chat";
    if (nextStatus === "awaiting_approval" && pendingApproval?.expiresAt) {
      await this.enqueueGenerationTimeout(generationId, "approval", pendingApproval.expiresAt);
    }
    if (nextStatus === "awaiting_auth" && pendingAuth?.expiresAt) {
      await this.enqueueGenerationTimeout(generationId, "auth", pendingAuth.expiresAt);
    }
    if (this.shouldDeferGenerationToWorker()) {
      await this.enqueueGenerationRun(generationId, runType);
      return true;
    }

    if (!this.activeGenerations.has(generationId)) {
      this.runQueuedGeneration(generationId).catch((err) => {
        console.error("[GenerationManager] runQueuedGeneration error:", err);
      });
    }
    return true;
  }

  async processGenerationTimeout(generationId: string, kind: GenerationTimeoutKind): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }

    const now = Date.now();
    if (kind === "approval") {
      const pendingApproval = genRecord.pendingApproval as PendingApproval | null;
      if (!pendingApproval || genRecord.status !== "awaiting_approval") {
        return;
      }
      const expiresAtMs = resolveExpiryMs(
        pendingApproval.expiresAt,
        pendingApproval.requestedAt,
        APPROVAL_TIMEOUT_MS,
      );
      if (Number.isFinite(expiresAtMs) && now < expiresAtMs) {
        return;
      }

      await db
        .update(generation)
        .set({
          status: "paused",
          isPaused: true,
        })
        .where(eq(generation.id, generationId));
      await db
        .update(conversation)
        .set({ generationStatus: "paused" })
        .where(eq(conversation.id, genRecord.conversationId));

      const linkedWorkflowRun = await db.query.workflowRun.findFirst({
        where: eq(workflowRun.generationId, generationId),
        columns: { id: true },
      });
      if (linkedWorkflowRun?.id) {
        await db
          .update(workflowRun)
          .set({
            status: "cancelled",
            finishedAt: new Date(),
          })
          .where(eq(workflowRun.id, linkedWorkflowRun.id));
      }

      const ctx = this.activeGenerations.get(generationId);
      if (ctx && ctx.status === "awaiting_approval") {
        ctx.status = "paused";
        this.broadcast(ctx, { type: "status_change", status: "paused" });
        this.evictActiveGenerationContext(generationId);
      }
      return;
    }

    const pendingAuth = genRecord.pendingAuth as PendingAuth | null;
    if (!pendingAuth || genRecord.status !== "awaiting_auth") {
      return;
    }
    const expiresAtMs = resolveExpiryMs(
      pendingAuth.expiresAt,
      pendingAuth.requestedAt,
      AUTH_TIMEOUT_MS,
    );
    if (Number.isFinite(expiresAtMs) && now < expiresAtMs) {
      return;
    }

    await db
      .update(generation)
      .set({
        status: "cancelled",
        pendingAuth: null,
        completedAt: new Date(),
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({ generationStatus: "idle" })
      .where(eq(conversation.id, genRecord.conversationId));

    const linkedWorkflowRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { id: true },
    });
    if (linkedWorkflowRun?.id) {
      await db
        .update(workflowRun)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(workflowRun.id, linkedWorkflowRun.id));
    }

    const ctx = this.activeGenerations.get(generationId);
    if (ctx && ctx.status === "awaiting_auth") {
      ctx.status = "cancelled";
      ctx.abortController.abort();
      this.broadcast(ctx, {
        type: "cancelled",
        generationId: ctx.id,
        conversationId: ctx.conversationId,
      });
      this.evictActiveGenerationContext(generationId);
    }
  }

  async processPreparingStuckCheck(generationId: string): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: {
        conversation: {
          columns: {
            id: true,
            userId: true,
            type: true,
          },
        },
      },
    });
    if (!genRecord) {
      return;
    }
    if (!genRecord.conversation || genRecord.conversation.type !== "chat") {
      return;
    }
    if (genRecord.status !== "running" || genRecord.sandboxId || genRecord.completedAt) {
      return;
    }

    const elapsedMs = Date.now() - genRecord.startedAt.getTime();
    if (elapsedMs < AGENT_PREPARING_TIMEOUT_MS) {
      return;
    }

    const userId = genRecord.conversation.userId ?? undefined;
    const details = {
      generationId: genRecord.id,
      conversationId: genRecord.conversation.id,
      userId,
      elapsedMs,
      thresholdMs: AGENT_PREPARING_TIMEOUT_MS,
      status: genRecord.status,
    };

    logServerEvent("warn", "GENERATION_PREPARING_STUCK_DETECTED", details, {
      source: "generation-manager",
      generationId: genRecord.id,
      conversationId: genRecord.conversation.id,
      userId,
    });

    const pushUrl = process.env.KUMA_PUSH_URL?.trim();
    if (!pushUrl) {
      return;
    }

    const monitorUrl = new URL(pushUrl);
    monitorUrl.searchParams.set("status", "down");
    monitorUrl.searchParams.set(
      "msg",
      `preparing agent timeout generation=${genRecord.id} conversation=${genRecord.conversation.id} user=${userId ?? "unknown"} elapsedMs=${elapsedMs}`,
    );
    monitorUrl.searchParams.set("ping", String(Math.max(1, Math.round(elapsedMs))));

    try {
      const response = await fetch(monitorUrl.toString(), { method: "GET" });
      if (!response.ok) {
        throw new Error(`Kuma push failed (${response.status})`);
      }
      logServerEvent("warn", "GENERATION_PREPARING_STUCK_KUMA_PUSHED", details, {
        source: "generation-manager",
        generationId: genRecord.id,
        conversationId: genRecord.conversation.id,
        userId,
      });
    } catch (error) {
      logServerEvent(
        "error",
        "GENERATION_PREPARING_STUCK_KUMA_PUSH_FAILED",
        {
          ...details,
          error: formatErrorMessage(error),
        },
        {
          source: "generation-manager",
          generationId: genRecord.id,
          conversationId: genRecord.conversation.id,
          userId,
        },
      );
    }
  }

  async reapStaleGenerations(): Promise<{
    scanned: number;
    stale: number;
    finalizedRunningAsError: number;
    finalizedOtherAsCancelled: number;
  }> {
    const candidates = await db.query.generation.findMany({
      where: and(
        isNull(generation.completedAt),
        inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth", "paused"]),
        lt(
          generation.startedAt,
          new Date(
            Date.now() -
              Math.min(
                STALE_REAPER_RUNNING_MAX_AGE_MS,
                STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS,
                STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS,
                STALE_REAPER_PAUSED_MAX_AGE_MS,
              ),
          ),
        ),
      ),
      columns: {
        id: true,
        status: true,
        startedAt: true,
      },
    });

    const nowMs = Date.now();
    const staleRows = candidates.filter((row) => {
      const ageMs = nowMs - row.startedAt.getTime();
      switch (row.status) {
        case "running":
          return ageMs > STALE_REAPER_RUNNING_MAX_AGE_MS;
        case "awaiting_approval":
          return ageMs > STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS;
        case "awaiting_auth":
          return ageMs > STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS;
        case "paused":
          return ageMs > STALE_REAPER_PAUSED_MAX_AGE_MS;
        default:
          return false;
      }
    });

    if (staleRows.length === 0) {
      return {
        scanned: candidates.length,
        stale: 0,
        finalizedRunningAsError: 0,
        finalizedOtherAsCancelled: 0,
      };
    }

    const staleRunningIds = staleRows
      .filter((row) => row.status === "running")
      .map((row) => row.id);
    const staleCancelledIds = staleRows
      .filter((row) => row.status !== "running")
      .map((row) => row.id);

    const completedAt = new Date();
    const staleRunningMessage =
      "Generation was marked as stale by the worker reaper after exceeding max running age.";

    if (staleRunningIds.length > 0) {
      await db
        .update(generation)
        .set({
          status: "error",
          errorMessage: staleRunningMessage,
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completedAt,
        })
        .where(inArray(generation.id, staleRunningIds));
    }

    if (staleCancelledIds.length > 0) {
      await db
        .update(generation)
        .set({
          status: "cancelled",
          pendingApproval: null,
          pendingAuth: null,
          isPaused: false,
          cancelRequestedAt: null,
          completedAt,
        })
        .where(inArray(generation.id, staleCancelledIds));
    }

    if (staleRunningIds.length > 0) {
      await db
        .update(workflowRun)
        .set({
          status: "error",
          finishedAt: completedAt,
          errorMessage: staleRunningMessage,
        })
        .where(inArray(workflowRun.generationId, staleRunningIds));
      await db
        .update(conversation)
        .set({ generationStatus: "error" })
        .where(inArray(conversation.currentGenerationId, staleRunningIds));
    }

    if (staleCancelledIds.length > 0) {
      await db
        .update(workflowRun)
        .set({
          status: "cancelled",
          finishedAt: completedAt,
        })
        .where(inArray(workflowRun.generationId, staleCancelledIds));
      await db
        .update(conversation)
        .set({ generationStatus: "idle" })
        .where(inArray(conversation.currentGenerationId, staleCancelledIds));
    }

    for (const row of staleRows) {
      const ctx = this.activeGenerations.get(row.id);
      if (ctx) {
        ctx.abortController.abort();
      }
      this.evictActiveGenerationContext(row.id);
    }

    return {
      scanned: candidates.length,
      stale: staleRows.length,
      finalizedRunningAsError: staleRunningIds.length,
      finalizedOtherAsCancelled: staleCancelledIds.length,
    };
  }

  private async refreshCancellationSignal(
    ctx: GenerationContext,
    options?: { force?: boolean },
  ): Promise<boolean> {
    if (ctx.abortController.signal.aborted) {
      return true;
    }

    const now = Date.now();
    if (
      !options?.force &&
      ctx.lastCancellationCheckAt &&
      now - ctx.lastCancellationCheckAt < CANCELLATION_POLL_INTERVAL_MS
    ) {
      return false;
    }
    ctx.lastCancellationCheckAt = now;

    const latest = await db.query.generation.findFirst({
      where: eq(generation.id, ctx.id),
      columns: {
        status: true,
        cancelRequestedAt: true,
      },
    });

    if (!latest) {
      return false;
    }

    if (latest.cancelRequestedAt || latest.status === "cancelled") {
      ctx.abortController.abort();
      return true;
    }

    return false;
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
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }

    const pending = genRecord.pendingApproval as PendingApproval | null;
    if (!pending || pending.toolUseId !== toolUseId) {
      return false;
    }

    const normalizedQuestionAnswers =
      questionAnswers
        ?.map((answers) =>
          answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
        )
        .filter((answers) => answers.length > 0) ?? [];

    await db
      .update(generation)
      .set({
        pendingApproval: {
          ...pending,
          decision: decision === "approve" ? "allow" : "deny",
          questionAnswers:
            normalizedQuestionAnswers.length > 0 ? normalizedQuestionAnswers : undefined,
        },
      })
      .where(eq(generation.id, generationId));

    return true;
  }

  async getAllowedIntegrationsForGeneration(
    generationId: string,
  ): Promise<IntegrationType[] | null> {
    const linkedRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { workflowId: true },
    });
    if (!linkedRun) {
      return null;
    }

    const wf = await db.query.workflow.findFirst({
      where: eq(workflow.id, linkedRun.workflowId),
      columns: { allowedIntegrations: true },
    });

    return (wf?.allowedIntegrations as IntegrationType[] | undefined) ?? null;
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
    let leaseToken: string | null = null;
    try {
      leaseToken = await this.acquireGenerationLease(ctx.id);
    } catch (error) {
      ctx.errorMessage = error instanceof Error ? error.message : String(error);
      await this.finishGeneration(ctx, "error");
      return;
    }
    if (!leaseToken) {
      return;
    }

    const leaseRenewTimer = setInterval(() => {
      void this.renewGenerationLease(ctx.id, leaseToken).catch((err) => {
        console.error(`[GenerationManager] Failed to renew lease for generation ${ctx.id}:`, err);
      });
    }, 30_000);

    try {
      const trimmed = ctx.userMessageContent.trim();
      if (SESSION_RESET_COMMANDS.has(trimmed)) {
        await this.handleSessionReset(ctx);
        return;
      }
      if (ctx.backendType === "direct") {
        return this.runDirectGeneration(ctx);
      }
      return this.runOpenCodeGeneration(ctx);
    } finally {
      clearInterval(leaseRenewTimer);
      await this.releaseGenerationLease(ctx.id, leaseToken).catch((err) => {
        console.error(`[GenerationManager] Failed to release lease for generation ${ctx.id}:`, err);
      });
    }
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

    ctx.sessionId = undefined;

    ctx.assistantContent = "Started a new session.";
    ctx.contentParts = [{ type: "text", text: ctx.assistantContent }];

    await this.finishGeneration(ctx, "completed");
  }

  /**
   * Original E2B/OpenCode generation flow. Delegates everything to OpenCode inside E2B sandbox.
   */
  private async runOpenCodeGeneration(ctx: GenerationContext): Promise<void> {
    let promptTimeoutTriggered = false;
    let clearPromptTimeout: (() => void) | undefined;
    try {
      if (await this.refreshCancellationSignal(ctx, { force: true })) {
        await this.finishGeneration(ctx, "cancelled");
        return;
      }

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
      const hasExistingMessages = !ctx.isNewConversation;

      // Get or create sandbox with OpenCode session
      const agentInitStartedAt = Date.now();
      const agentInitWarnAfterMs = 15_000;
      ctx.agentInitStartedAt = agentInitStartedAt;
      ctx.agentInitReadyAt = undefined;
      ctx.agentInitFailedAt = undefined;
      this.markPhase(ctx, "agent_init_started");
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
              generationId: ctx.id,
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
                this.markPhase(ctx, status);
                if (ctx.agentInitStartedAt) {
                  if (stage === "sandbox_created") {
                    ctx.agentSandboxReadyAt = Date.now();
                    ctx.agentSandboxMode = "created";
                  } else if (stage === "sandbox_reused") {
                    ctx.agentSandboxReadyAt = Date.now();
                    ctx.agentSandboxMode = "reused";
                  }
                }
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
        this.markPhase(ctx, "agent_init_ready");
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
        this.markPhase(ctx, "agent_init_failed");
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
      ctx.sandboxId = sandbox.sandboxId;

      await db
        .update(generation)
        .set({ sandboxId: sandbox.sandboxId })
        .where(eq(generation.id, ctx.id));

      // Persist reusable IDs immediately so follow-up turns can reuse session/sandbox
      // even if the current turn is interrupted before completion.
      await db
        .update(conversation)
        .set({
          opencodeSessionId: ctx.sessionId,
          opencodeSandboxId: ctx.sandboxId ?? null,
        })
        .where(eq(conversation.id, ctx.conversationId));

      // Record marker time for file collection and store sandbox reference
      ctx.generationMarkerTime = Date.now();
      ctx.e2bSandbox = sandbox;
      ctx.sentFilePaths = new Set();
      ctx.userStagedFilePaths = new Set();
      this.markPhase(ctx, "pre_prompt_setup_started");

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

      const enabledSkillRows = await db.query.skill.findMany({
        where: and(eq(skill.userId, ctx.userId), eq(skill.enabled, true)),
        columns: {
          name: true,
          updatedAt: true,
        },
      });

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

      const prePromptCacheKey = JSON.stringify({
        userId: ctx.userId,
        allowedIntegrations: [...allowedIntegrations].toSorted(),
        allowedCustomIntegrations: [...(ctx.allowedCustomIntegrations ?? [])].toSorted(),
        selectedPlatformSkillSlugs: [...(ctx.selectedPlatformSkillSlugs ?? [])].toSorted(),
        skills: enabledSkillRows
          .map((entry) => `${entry.name}:${entry.updatedAt.toISOString()}`)
          .toSorted(),
        customIntegrations: eligibleCustomCreds
          .map(
            (cred) =>
              `${cred.customIntegration.slug}:${cred.updatedAt.toISOString()}:${cred.customIntegration.updatedAt.toISOString()}`,
          )
          .toSorted(),
      });

      let writtenSkills: string[] = [];
      let writtenIntegrationSkills: string[] = [];
      let prePromptCacheHit = false;

      if (ctx.agentSandboxMode === "reused") {
        try {
          const rawCache = await sandbox.files.read(PRE_PROMPT_CACHE_PATH);
          const parsed = JSON.parse(String(rawCache)) as Partial<PrePromptCacheRecord>;
          if (parsed.cacheKey === prePromptCacheKey) {
            prePromptCacheHit = true;
            if (Array.isArray(parsed.writtenSkills)) {
              writtenSkills = parsed.writtenSkills.filter(
                (value): value is string => typeof value === "string",
              );
            }
            if (Array.isArray(parsed.writtenIntegrationSkills)) {
              writtenIntegrationSkills = parsed.writtenIntegrationSkills.filter(
                (value): value is string => typeof value === "string",
              );
            }
            logServerEvent(
              "info",
              "PRE_PROMPT_CACHE_HIT",
              {
                skillsCount: writtenSkills.length,
                integrationSkillCount: writtenIntegrationSkills.length,
              },
              {
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
                sandboxId: sandbox.sandboxId,
                sessionId: ctx.sessionId,
              },
            );
          }
        } catch {
          // Cache file absent or invalid; fall back to full prep.
        }
      }

      // Write custom skills/integration assets only when cache is stale.
      try {
        if (!prePromptCacheHit) {
          writtenSkills = await writeSkillsToSandbox(sandbox, ctx.userId);

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

          writtenIntegrationSkills = await writeResolvedIntegrationSkillsToSandbox(
            sandbox,
            ctx.userId,
            Array.from(allowedSkillSlugs),
          );

          await sandbox.commands.run(`mkdir -p "${path.dirname(PRE_PROMPT_CACHE_PATH)}"`);
          const nextCacheRecord: PrePromptCacheRecord = {
            version: 1,
            cacheKey: prePromptCacheKey,
            writtenSkills,
            writtenIntegrationSkills,
            updatedAt: new Date().toISOString(),
          };
          await sandbox.files.write(
            PRE_PROMPT_CACHE_PATH,
            JSON.stringify(nextCacheRecord, null, 2),
          );
        }
      } catch (e) {
        console.error("[Generation] Failed to write custom integration CLI code:", e);
      }

      if (writtenSkills.length === 0) {
        writtenSkills = enabledSkillRows.map((entry) => entry.name);
      }
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);
      const integrationSkillsInstructions =
        getIntegrationSkillsSystemPrompt(writtenIntegrationSkills);

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
      const selectedPlatformSkillInstructions = getSelectedPlatformSkillPrompt(
        ctx.selectedPlatformSkillSlugs,
      );
      const systemPromptParts = [
        baseSystemPrompt,
        fileShareInstructions,
        cliInstructions,
        skillsInstructions,
        selectedPlatformSkillInstructions,
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
      const promptTimeoutController = new AbortController();
      const eventResult = await client.event.subscribe(
        {},
        { signal: promptTimeoutController.signal },
      );
      const eventStream = eventResult.stream;

      const parsedModel = parseModelReference(ctx.model);

      // Resolve provider from model reference
      const modelConfig = {
        providerID: parsedModel.providerID,
        modelID: parsedModel.modelID,
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
              ctx.userStagedFilePaths?.add(sandboxPath);
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
      this.markPhase(ctx, "prompt_sent");
      const promptTimeoutId = setTimeout(() => {
        promptTimeoutTriggered = true;
        promptTimeoutController.abort();
        logServerEvent(
          "error",
          "OPENCODE_PROMPT_TIMEOUT",
          { timeoutMs: OPENCODE_PROMPT_TIMEOUT_MS },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId,
          },
        );
        void client.session.abort({ sessionID: sessionId }).catch((err) => {
          console.error("[GenerationManager] Failed to abort timed out OpenCode session:", err);
        });
      }, OPENCODE_PROMPT_TIMEOUT_MS);
      clearPromptTimeout = () => {
        clearTimeout(promptTimeoutId);
        clearPromptTimeout = undefined;
      };
      const promptPromise = client.session.prompt({
        sessionID: sessionId,
        parts: promptParts,
        system: systemPrompt,
        model: modelConfig,
      });

      // Process SSE events
      for await (const rawEvent of eventStream) {
        if (!ctx.phaseMarks?.first_event_received) {
          this.markPhase(ctx, "first_event_received");
        }
        const event = rawEvent as OpencodeEvent;
        if (await this.refreshCancellationSignal(ctx)) {
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
          this.markPhase(ctx, "session_idle");
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
      clearPromptTimeout?.();
      this.markPhase(ctx, "prompt_completed");
      await this.refreshCancellationSignal(ctx, { force: true });
      this.markPhase(ctx, "post_processing_started");

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
            Array.from(new Set([...(ctx.sentFilePaths ?? []), ...(ctx.userStagedFilePaths ?? [])])),
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
      this.markPhase(ctx, "post_processing_completed");

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
      clearPromptTimeout?.();
      if (promptTimeoutTriggered && error instanceof Error && error.name === "AbortError") {
        ctx.errorMessage = "OpenCode prompt timed out";
      }
      console.error("[GenerationManager] Error:", error);
      if (!ctx.errorMessage) {
        ctx.errorMessage = error instanceof Error ? error.message : "Unknown error";
      }
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
      ctx.userStagedFilePaths = new Set();

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
      const selectedPlatformSkillInstructions = getSelectedPlatformSkillPrompt(
        ctx.selectedPlatformSkillSlugs,
      );
      const systemPromptParts = [
        baseSystemPrompt,
        cliInstructions,
        selectedPlatformSkillInstructions,
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
      const directModelID = parseModelReference(ctx.model).modelID;
      let hasToolCalls = true;
      let iterationCount = 0;
      const MAX_ITERATIONS = 50;

      const runDirectToolLoop = async (): Promise<void> => {
        if (!hasToolCalls || iterationCount >= MAX_ITERATIONS) {
          return;
        }

        if (await this.refreshCancellationSignal(ctx)) {
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
          model: directModelID,
          signal: ctx.abortController.signal,
        });

        await this.consumeAsyncStream(stream, async (event) => {
          if (await this.refreshCancellationSignal(ctx)) {
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
              const metadata = this.getToolUseMetadata(currentToolName, toolInput);

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
                integration: metadata.integration,
                operation: metadata.operation,
                isWrite: metadata.isWrite,
              });

              ctx.contentParts.push({
                type: "tool_use",
                id: currentToolUseId,
                name: currentToolName,
                input: toolInput,
                integration: metadata.integration,
                operation: metadata.operation,
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

        if (await this.refreshCancellationSignal(ctx, { force: true })) {
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

      if (await this.refreshCancellationSignal(ctx, { force: true })) {
        await this.finishGeneration(ctx, "cancelled");
        return;
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
    const { providerID } = parseModelReference(ctx.model);

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
      parseModelReference(ctx.model).modelID,
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
        model: parseModelReference(ctx.model).modelID,
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
    openCodeRequest:
      | { kind: "permission"; request: PermissionRequest }
      | { kind: "question"; request: QuestionRequest; defaultAnswers: string[][] },
    pendingApproval: PendingApproval,
  ): Promise<void> {
    const expiresAt = computeExpiryIso(APPROVAL_TIMEOUT_MS);
    const persistedPendingApproval: PendingApproval = {
      ...pendingApproval,
      expiresAt,
      opencodeRequestKind: openCodeRequest.kind,
      opencodeRequestId: openCodeRequest.request.id,
      opencodeDefaultAnswers:
        openCodeRequest.kind === "question" ? openCodeRequest.defaultAnswers : undefined,
    };
    ctx.status = "awaiting_approval";
    ctx.pendingApproval = persistedPendingApproval;

    await db
      .update(generation)
      .set({
        status: "awaiting_approval",
        pendingApproval: persistedPendingApproval,
      })
      .where(eq(generation.id, ctx.id));
    await db
      .update(conversation)
      .set({ generationStatus: "awaiting_approval" })
      .where(eq(conversation.id, ctx.conversationId));
    if (ctx.workflowRunId) {
      await db
        .update(workflowRun)
        .set({ status: "awaiting_approval" })
        .where(eq(workflowRun.id, ctx.workflowRunId));
    }
    await this.enqueueGenerationTimeout(ctx.id, "approval", expiresAt);

    this.broadcast(ctx, {
      type: "pending_approval",
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      toolUseId: persistedPendingApproval.toolUseId,
      toolName: persistedPendingApproval.toolName,
      toolInput: persistedPendingApproval.toolInput,
      integration: persistedPendingApproval.integration,
      operation: persistedPendingApproval.operation,
      command: persistedPendingApproval.command,
    });

    const decision = await this.waitForOpenCodeApprovalDecision(
      ctx.id,
      persistedPendingApproval.toolUseId,
    );
    if (!decision) {
      await this.rejectOpenCodePendingApprovalRequest(ctx, client).catch((err) =>
        console.error("[GenerationManager] Failed to reject OpenCode request on timeout:", err),
      );
      await this.handleApprovalTimeout(ctx);
      return;
    }

    await this.applyOpenCodeApprovalDecision(
      ctx,
      decision.decision,
      decision.questionAnswers,
      client,
    );
  }

  private async rejectOpenCodePendingApprovalRequest(
    ctx: GenerationContext,
    liveClient?: OpencodeClient,
  ): Promise<void> {
    const pendingApproval = ctx.pendingApproval;
    const requestKind = pendingApproval?.opencodeRequestKind;
    const requestId = pendingApproval?.opencodeRequestId;
    if (!requestKind || !requestId) {
      return;
    }

    let opencodeClient = liveClient;
    if (!opencodeClient) {
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });
      const resumedSession = await getOrCreateSession(
        {
          conversationId: ctx.conversationId,
          generationId: ctx.id,
          userId: ctx.userId,
          anthropicApiKey: env.ANTHROPIC_API_KEY || "",
          integrationEnvs: {},
        },
        {
          title: conv?.title || "Conversation",
          replayHistory: false,
        },
      );
      opencodeClient = resumedSession.client;
    }

    if (requestKind === "permission") {
      await opencodeClient.permission.reply({
        requestID: requestId,
        reply: "reject",
      });
      return;
    }
    await opencodeClient.question.reject({
      requestID: requestId,
    });
  }

  private async waitForOpenCodeApprovalDecision(
    generationId: string,
    toolUseId: string,
  ): Promise<{ decision: "allow" | "deny"; questionAnswers?: string[][] } | null> {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      // eslint-disable-next-line no-await-in-loop -- polling by design
      const latest = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
      });
      if (!latest) {
        return { decision: "deny" };
      }

      const latestApproval = latest.pendingApproval as PendingApproval | null;
      if (!latestApproval || latestApproval.toolUseId !== toolUseId) {
        if (latest.status === "running" || latest.status === "completed") {
          return { decision: "allow" };
        }
        if (latest.status === "cancelled" || latest.status === "error") {
          return { decision: "deny" };
        }
        continue;
      }

      const expiresAtMs = resolveExpiryMs(
        latestApproval.expiresAt,
        latestApproval.requestedAt,
        APPROVAL_TIMEOUT_MS,
      );
      if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
        return null;
      }

      if (latestApproval.decision) {
        return {
          decision: latestApproval.decision,
          questionAnswers: latestApproval.questionAnswers,
        };
      }

      if (latest.cancelRequestedAt || latest.status === "cancelled" || latest.status === "error") {
        return { decision: "deny" };
      }
    }
  }

  private async applyOpenCodeApprovalDecision(
    ctx: GenerationContext,
    decision: "allow" | "deny",
    questionAnswers?: string[][],
    liveClient?: OpencodeClient,
  ): Promise<void> {
    const pendingApproval = ctx.pendingApproval;
    const toolUseId = pendingApproval?.toolUseId ?? `opencode-${ctx.id}`;
    const requestKind = pendingApproval?.opencodeRequestKind;
    const requestId = pendingApproval?.opencodeRequestId;
    if (!requestKind || !requestId) {
      return;
    }

    let opencodeClient = liveClient;
    let defaultAnswers = pendingApproval?.opencodeDefaultAnswers ?? [[]];
    if (!opencodeClient) {
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
        columns: { title: true },
      });
      const resumedSession = await getOrCreateSession(
        {
          conversationId: ctx.conversationId,
          generationId: ctx.id,
          userId: ctx.userId,
          anthropicApiKey: env.ANTHROPIC_API_KEY || "",
          integrationEnvs: {},
        },
        {
          title: conv?.title || "Conversation",
          replayHistory: false,
        },
      );
      opencodeClient = resumedSession.client;
    }

    if (requestKind === "permission") {
      await opencodeClient.permission.reply({
        requestID: requestId,
        reply: decision === "allow" ? "always" : "reject",
      });
    } else if (requestKind === "question") {
      if (decision === "allow") {
        await opencodeClient.question.reply({
          requestID: requestId,
          answers: questionAnswers && questionAnswers.length > 0 ? questionAnswers : defaultAnswers,
        });
      } else {
        await opencodeClient.question.reject({
          requestID: requestId,
        });
      }
    }

    await db
      .update(generation)
      .set({
        status: "running",
        pendingApproval: null,
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

    ctx.pendingApproval = null;
    ctx.status = "running";
    this.broadcast(ctx, {
      type: "approval_result",
      toolUseId,
      decision: decision === "allow" ? "approved" : "denied",
    });
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
          const pendingQueue = ctx.pendingMessageParts.get(messageId);
          if (pendingQueue && pendingQueue.parts.length > 0) {
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
              pendingQueue.parts.map(async (pendingPart) => {
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
        this.pruneStalePendingMessageParts(ctx);

        if (messageID) {
          const role = ctx.messageRoles.get(messageID);
          if (role === "user") {
            return;
          }
          if (role !== "assistant") {
            // Preserve live streaming: process likely assistant parts immediately.
            // Queue only parts that strongly look like user-echo updates.
            if (!this.shouldProcessUnknownMessagePart(ctx, part)) {
              const now = Date.now();
              const existing = ctx.pendingMessageParts.get(messageID);
              const resetQueue =
                !existing || now - existing.firstQueuedAtMs > PENDING_MESSAGE_PARTS_TTL_MS;
              const parts = resetQueue ? [] : [...existing.parts];
              if (parts.length >= PENDING_MESSAGE_PARTS_MAX_PER_MESSAGE) {
                parts.shift();
              }
              parts.push(part);
              ctx.pendingMessageParts.set(messageID, {
                firstQueuedAtMs: resetQueue ? now : existing.firstQueuedAtMs,
                parts,
              });
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

    // Reasoning content ("internal thoughts") from OpenCode.
    // OpenCode updates this part cumulatively, so emit only the delta while
    // persisting the full content for replay/history.
    if (part.type === "reasoning") {
      setCurrentTextPart(null, null);
      const fullReasoning = part.text ?? "";
      const existingThinking = ctx.contentParts.find(
        (p): p is ContentPart & { type: "thinking" } => p.type === "thinking" && p.id === partId,
      );

      const previousReasoning = existingThinking?.content ?? "";
      const delta = fullReasoning.startsWith(previousReasoning)
        ? fullReasoning.slice(previousReasoning.length)
        : fullReasoning;

      if (existingThinking) {
        existingThinking.content = fullReasoning;
      } else {
        ctx.contentParts.push({
          type: "thinking",
          id: partId,
          content: fullReasoning,
        });
      }

      if (delta) {
        this.broadcast(ctx, {
          type: "thinking",
          content: delta,
          thinkingId: partId,
        });
      }

      this.scheduleSave(ctx);
      return;
    }

    // Tool call (OpenCode uses "tool" type with callID, tool, and state properties)
    // See @opencode-ai/sdk ToolPart type: state contains input/output
    // Status flow: pending (no input) -> running (has input) -> completed (has output)
    if (part.type === "tool") {
      setCurrentTextPart(null, null);
      const toolUseId = part.callID;
      const toolName = part.tool;
      const toolInput = "input" in part.state ? (part.state.input as Record<string, unknown>) : {};
      const metadata = this.getToolUseMetadata(toolName, toolInput);

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
            integration: metadata.integration,
            operation: metadata.operation,
            isWrite: metadata.isWrite,
          });

          ctx.contentParts.push({
            type: "tool_use",
            id: toolUseId,
            name: toolName,
            input: toolInput,
            integration: metadata.integration,
            operation: metadata.operation,
          });
          await this.saveProgress(ctx);
          return;
        }
        case "completed": {
          if (!existingToolUse) {
            return;
          }
          const result = limitToolResultContent(part.state.output);
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
          const result = limitToolResultContent({ error: part.state.error });
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

  private getToolUseMetadata(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): ToolUseMetadata {
    if (toolName.toLowerCase() !== "bash") {
      return {};
    }

    const command = toolInput.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      return {};
    }

    const parsed = parseBashCommand(command);
    if (!parsed) {
      return {};
    }

    return {
      integration: parsed.integration,
      operation: parsed.operation,
      isWrite: parsed.isWrite,
    };
  }

  private async forEachSequential<T>(
    items: readonly T[],
    handler: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    for (const [index, item] of items.entries()) {
      // eslint-disable-next-line no-await-in-loop -- sequential ordering is required
      await handler(item, index);
    }
  }

  private async consumeAsyncStream<T>(
    stream: AsyncIterable<T>,
    onEvent: (event: T) => Promise<boolean | void>,
  ): Promise<void> {
    for await (const event of stream) {
      const shouldStop = await onEvent(event);
      if (shouldStop) {
        break;
      }
    }
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
    this.evictActiveGenerationContext(ctx.id);
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
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });

    if (!genRecord) {
      return false;
    }

    const recordUserId = genRecord.conversation.userId;
    if (recordUserId !== userId) {
      throw new Error("Access denied");
    }

    const pendingAuth = genRecord.pendingAuth as PendingAuth | null;
    if (!pendingAuth) {
      return false;
    }

    const conversationId = genRecord.conversationId;
    const linkedWorkflowRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { id: true },
    });

    if (!success) {
      await db
        .update(generation)
        .set({
          status: "cancelled",
          pendingAuth: null,
          completedAt: new Date(),
        })
        .where(eq(generation.id, generationId));

      await db
        .update(conversation)
        .set({ generationStatus: "idle" })
        .where(eq(conversation.id, conversationId));

      if (linkedWorkflowRun?.id) {
        await db
          .update(workflowRun)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(eq(workflowRun.id, linkedWorkflowRun.id));
      }

      return true;
    }

    // Track connected integration
    const connectedIntegrations = Array.from(
      new Set([...pendingAuth.connectedIntegrations, integration]),
    );

    const allConnected = pendingAuth.integrations.every((requiredIntegration) =>
      connectedIntegrations.includes(requiredIntegration),
    );

    await db
      .update(generation)
      .set({
        pendingAuth: {
          ...pendingAuth,
          connectedIntegrations,
        },
      })
      .where(eq(generation.id, generationId));

    if (allConnected) {
      await db
        .update(generation)
        .set({
          status: "running",
          pendingAuth: null,
        })
        .where(eq(generation.id, generationId));

      await db
        .update(conversation)
        .set({ generationStatus: "generating" })
        .where(eq(conversation.id, conversationId));

      if (linkedWorkflowRun?.id) {
        await db
          .update(workflowRun)
          .set({ status: "running" })
          .where(eq(workflowRun.id, linkedWorkflowRun.id));
      }
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
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return "deny";
    }

    const autoApprove = genRecord.conversation.autoApprove;
    if (autoApprove) {
      return "allow";
    }

    const toolUseId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = computeExpiryIso(APPROVAL_TIMEOUT_MS);
    const pendingApproval: PendingApproval = {
      toolUseId,
      toolName: "Bash",
      toolInput: request.toolInput,
      requestedAt: new Date().toISOString(),
      expiresAt,
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
      .where(eq(conversation.id, genRecord.conversationId));
    await this.enqueueGenerationTimeout(generationId, "approval", expiresAt);

    let resolved: "allow" | "deny" | null = null;
    while (resolved === null) {
      if (Date.now() >= Date.parse(expiresAt)) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));
      // eslint-disable-next-line no-await-in-loop -- polling by design
      const latest = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
      });
      if (!latest) {
        resolved = "deny";
        break;
      }

      const latestApproval = latest.pendingApproval as PendingApproval | null;
      if (!latestApproval || latestApproval.toolUseId !== toolUseId) {
        if (latest.status !== "awaiting_approval") {
          if (latest.status === "running" || latest.status === "completed") {
            console.warn(
              `[GenerationManager] approval_reconciled generation=${generationId} toolUseId=${toolUseId} status=${latest.status}`,
            );
            resolved = "allow";
            break;
          }
          if (
            latest.status === "cancelled" ||
            latest.status === "error" ||
            latest.status === "paused"
          ) {
            resolved = "deny";
            break;
          }
        }
        continue;
      }

      if (latestApproval.decision) {
        const resolvedDecision = latestApproval.decision;
        // eslint-disable-next-line no-await-in-loop -- decision must be persisted before returning
        await db
          .update(generation)
          .set({
            status: "running",
            pendingApproval: null,
          })
          .where(eq(generation.id, generationId));
        // eslint-disable-next-line no-await-in-loop -- decision must be persisted before returning
        await db
          .update(conversation)
          .set({ generationStatus: "generating" })
          .where(eq(conversation.id, genRecord.conversationId));
        resolved = resolvedDecision;
        break;
      }

      if (latest.cancelRequestedAt || latest.status === "cancelled" || latest.status === "error") {
        resolved = "deny";
        break;
      }
    }

    if (resolved) {
      return resolved;
    }
    await this.processGenerationTimeout(generationId, "approval");
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
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return { success: false };
    }

    const conversationId = genRecord.conversationId;
    const linkedWorkflowRun = await db.query.workflowRun.findFirst({
      where: eq(workflowRun.generationId, generationId),
      columns: { id: true },
    });
    const expiresAt = computeExpiryIso(AUTH_TIMEOUT_MS);
    const pendingAuth: PendingAuth = {
      integrations: [request.integration],
      connectedIntegrations: [],
      requestedAt: new Date().toISOString(),
      expiresAt,
      reason: request.reason,
    };

    // Create a promise that resolves when OAuth completes
    await db
      .update(generation)
      .set({
        status: "awaiting_auth",
        pendingAuth,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({ generationStatus: "awaiting_auth" })
      .where(eq(conversation.id, conversationId));

    if (linkedWorkflowRun?.id) {
      await db
        .update(workflowRun)
        .set({ status: "awaiting_auth" })
        .where(eq(workflowRun.id, linkedWorkflowRun.id));
    }
    await this.enqueueGenerationTimeout(generationId, "auth", expiresAt);

    let resolved: { success: boolean; userId?: string } | null = null;
    while (resolved === null) {
      if (Date.now() >= Date.parse(expiresAt)) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- polling by design
      await new Promise((resolve) => setTimeout(resolve, 400));

      // eslint-disable-next-line no-await-in-loop -- polling by design
      const latest = await db.query.generation.findFirst({
        where: eq(generation.id, generationId),
        with: { conversation: true },
      });
      if (!latest) {
        resolved = { success: false };
        break;
      }

      const latestPendingAuth = latest.pendingAuth as PendingAuth | null;
      if (latestPendingAuth?.connectedIntegrations.includes(request.integration)) {
        resolved = latest.conversation.userId
          ? { success: true, userId: latest.conversation.userId }
          : { success: false };
        break;
      }

      if (
        latest.status !== "awaiting_auth" &&
        !latestPendingAuth?.integrations.includes(request.integration)
      ) {
        if (latest.status === "running" || latest.status === "completed") {
          console.warn(
            `[GenerationManager] auth_reconciled generation=${generationId} integration=${request.integration} status=${latest.status}`,
          );
          resolved = latest.conversation.userId
            ? { success: true, userId: latest.conversation.userId }
            : { success: false };
          break;
        }
        if (latest.status === "cancelled" || latest.status === "error") {
          resolved = { success: false };
          break;
        }
      }

      if (latest.cancelRequestedAt || latest.status === "cancelled" || latest.status === "error") {
        resolved = { success: false };
        break;
      }
    }

    if (resolved) {
      return resolved;
    }
    await this.processGenerationTimeout(generationId, "auth");
    return { success: false };
  }

  private async finishGeneration(
    ctx: GenerationContext,
    status: "completed" | "cancelled" | "error",
  ): Promise<void> {
    if (ctx.isFinalizing) {
      return;
    }
    if (ctx.status === "completed" || ctx.status === "cancelled" || ctx.status === "error") {
      return;
    }
    ctx.isFinalizing = true;

    try {
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
            .set({
              opencodeSessionId: ctx.sessionId,
              opencodeSandboxId: ctx.sandboxId ?? null,
            })
            .where(eq(conversation.id, ctx.conversationId));
        }

        // Auto-collect any new files created during generation (direct mode only)
        if (status === "completed" && ctx.sandbox && ctx.generationMarkerTime) {
          try {
            const excludePaths = Array.from(ctx.sentFilePaths || []);
            const stagedPaths = Array.from(ctx.userStagedFilePaths || []);
            const newFiles = await collectNewSandboxFiles(
              ctx.sandbox,
              ctx.generationMarkerTime,
              Array.from(new Set([...excludePaths, ...stagedPaths])),
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

        this.markPhase(ctx, "generation_completed");
        const messageTiming: MessageTiming = this.buildMessageTiming(ctx);

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
            timing: messageTiming,
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
          cancelRequestedAt: null,
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
        const artifacts = await getDoneArtifacts(messageId);
        this.broadcast(ctx, {
          type: "done",
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          messageId,
          usage: ctx.usage,
          artifacts,
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
      this.evictActiveGenerationContext(ctx.id);
    } finally {
      ctx.isFinalizing = false;
    }
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

// Stable singleton across dev hot-reloads/module re-evaluation.
const globalForGenerationManager = globalThis as typeof globalThis & {
  __bapGenerationManager?: GenerationManager;
};

export const generationManager =
  globalForGenerationManager.__bapGenerationManager ?? new GenerationManager();

if (process.env.NODE_ENV !== "production") {
  globalForGenerationManager.__bapGenerationManager = generationManager;
}

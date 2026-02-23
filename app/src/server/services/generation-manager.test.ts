import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateWhereMock,
  updateSetMock,
  insertReturningMock,
  insertValuesMock,
  generationFindFirstMock,
  generationFindManyMock,
  messageFindFirstMock,
  conversationFindFirstMock,
  workflowRunFindFirstMock,
  workflowFindFirstMock,
  queueAddMock,
  dbMock,
} = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));
  const generationFindFirstMock = vi.fn();
  const generationFindManyMock = vi.fn();
  const messageFindFirstMock = vi.fn();
  const conversationFindFirstMock = vi.fn();
  const workflowRunFindFirstMock = vi.fn();
  const workflowFindFirstMock = vi.fn();
  const queueAddMock = vi.fn();

  const dbMock = {
    query: {
      generation: { findFirst: generationFindFirstMock, findMany: generationFindManyMock },
      message: { findFirst: messageFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
      workflowRun: { findFirst: workflowRunFindFirstMock },
      workflow: { findFirst: workflowFindFirstMock },
      skill: { findMany: vi.fn(() => []) },
      customIntegrationCredential: { findMany: vi.fn(() => []) },
    },
    update: updateMock,
    insert: insertMock,
  };

  return {
    updateWhereMock,
    updateSetMock,
    insertReturningMock,
    insertValuesMock,
    generationFindFirstMock,
    generationFindManyMock,
    messageFindFirstMock,
    conversationFindFirstMock,
    workflowRunFindFirstMock,
    workflowFindFirstMock,
    queueAddMock,
    dbMock,
  };
});

vi.mock("@/env", () => ({
  env: {},
}));

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/sandbox/e2b", () => ({
  getOrCreateSession: vi.fn(),
  writeSkillsToSandbox: vi.fn(),
  getSkillsSystemPrompt: vi.fn(() => ""),
  writeResolvedIntegrationSkillsToSandbox: vi.fn(),
  getIntegrationSkillsSystemPrompt: vi.fn(() => ""),
  resetOpencodeSession: vi.fn(),
}));

vi.mock("@/server/integrations/cli-env", () => ({
  getCliEnvForUser: vi.fn(),
  getCliInstructions: vi.fn(() => ""),
  getCliInstructionsWithCustom: vi.fn(() => ""),
  getEnabledIntegrationTypes: vi.fn(() => []),
}));

vi.mock("@/server/utils/generate-title", () => ({
  generateConversationTitle: vi.fn(),
}));

vi.mock("@/server/sandbox/factory", () => ({
  getPreferredCloudSandboxProvider: vi.fn(() => "e2b"),
  getSandboxBackend: vi.fn(),
}));

vi.mock("@/server/ai/anthropic-backend", () => ({
  AnthropicBackend: vi.fn(() => ({})),
}));

vi.mock("@/server/ai/openai-backend", () => ({
  OpenAIBackend: vi.fn(() => ({})),
}));

vi.mock("@/server/ai/local-backend", () => ({
  LocalLLMBackend: vi.fn(() => ({})),
}));

vi.mock("@/server/ai/tools", () => ({
  getDirectModeTools: vi.fn(() => []),
  toolCallToCommand: vi.fn(() => ""),
}));

vi.mock("@/server/ai/permission-checker", () => ({
  checkToolPermissions: vi.fn(() => ({
    allowed: true,
    needsApproval: false,
    needsAuth: false,
  })),
  parseBashCommand: vi.fn(() => null),
}));

vi.mock("@/server/services/memory-service", () => ({
  buildMemorySystemPrompt: vi.fn(() => ""),
  readMemoryFile: vi.fn(),
  searchMemoryWithSessions: vi.fn(() => []),
  syncMemoryToSandbox: vi.fn(),
  writeMemoryEntry: vi.fn(),
  writeSessionTranscriptFromConversation: vi.fn(),
}));

vi.mock("@/server/services/sandbox-file-service", () => ({
  uploadSandboxFile: vi.fn(),
  collectNewSandboxFiles: vi.fn(() => []),
  collectNewE2BFiles: vi.fn(() => []),
  readSandboxFileAsBuffer: vi.fn(),
}));

vi.mock("@/server/services/integration-skill-service", () => ({
  createCommunityIntegrationSkill: vi.fn(),
  resolvePreferredCommunitySkillsForUser: vi.fn(() => []),
}));

vi.mock("@/server/utils/observability", () => ({
  createTraceId: vi.fn(() => "trace-1"),
  logServerEvent: vi.fn(),
}));

vi.mock("@/server/queues", () => ({
  buildQueueJobId: (parts: Array<string | number | null | undefined>) =>
    parts
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join("-"),
  CHAT_GENERATION_JOB_NAME: "generation:chat-run",
  WORKFLOW_GENERATION_JOB_NAME: "generation:workflow-run",
  GENERATION_APPROVAL_TIMEOUT_JOB_NAME: "generation:approval-timeout",
  GENERATION_AUTH_TIMEOUT_JOB_NAME: "generation:auth-timeout",
  GENERATION_PREPARING_STUCK_CHECK_JOB_NAME: "generation:preparing-stuck-check",
  getQueue: () => ({
    add: queueAddMock,
  }),
}));

import { env } from "@/env";
import { checkToolPermissions, parseBashCommand } from "@/server/ai/permission-checker";
import { getDirectModeTools, toolCallToCommand } from "@/server/ai/tools";
import {
  getCliEnvForUser,
  getCliInstructionsWithCustom,
  getEnabledIntegrationTypes,
} from "@/server/integrations/cli-env";
import {
  getOrCreateSession,
  writeSkillsToSandbox,
  getSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox,
  getIntegrationSkillsSystemPrompt,
} from "@/server/sandbox/e2b";
import { getSandboxBackend } from "@/server/sandbox/factory";
import { resolvePreferredCommunitySkillsForUser } from "@/server/services/integration-skill-service";
import { syncMemoryToSandbox, buildMemorySystemPrompt } from "@/server/services/memory-service";
import {
  uploadSandboxFile,
  collectNewSandboxFiles,
  collectNewE2BFiles,
  readSandboxFileAsBuffer,
} from "@/server/services/sandbox-file-service";
import { logServerEvent } from "@/server/utils/observability";
import { generationManager } from "./generation-manager";

type GenerationCtx = {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  status: string;
  contentParts: unknown[];
  assistantContent: string;
  subscribers: Map<string, { id: string; callback: (event: unknown) => void }>;
  abortController: AbortController;
  pendingApproval: unknown;
  pendingAuth: {
    integrations?: string[];
    connectedIntegrations?: string[];
    requestedAt?: string;
    [key: string]: unknown;
  } | null;
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  startedAt: Date;
  lastSaveAt: Date;
  isNewConversation: boolean;
  model: string;
  userMessageContent: string;
  assistantMessageIds: Set<string>;
  messageRoles: Map<string, string>;
  pendingMessageParts: Map<string, unknown>;
  backendType: string;
  autoApprove: boolean;
  uploadedSandboxFileIds?: Set<string>;
  [key: string]: unknown;
};

type GenerationManagerTestHarness = {
  activeGenerations: Map<string, GenerationCtx>;
  finishGeneration: (ctx: GenerationCtx, status: string) => Promise<void>;
  runGeneration: (ctx: GenerationCtx) => Promise<void>;
  handleSessionReset: (ctx: GenerationCtx) => Promise<void>;
  runDirectGeneration: (ctx: GenerationCtx) => Promise<void>;
  runOpenCodeGeneration: (ctx: GenerationCtx) => Promise<void>;
  buildWorkflowPrompt: (ctx: GenerationCtx) => string | null;
  getLLMBackend: (...args: unknown[]) => Promise<unknown>;
  buildMessageHistory: (...args: unknown[]) => Promise<unknown[]>;
  executeMemoryTool: (...args: unknown[]) => Promise<{ content: string; isError: boolean }>;
  importIntegrationSkillDraftsFromE2B: (...args: unknown[]) => Promise<void>;
  processOpencodeEvent: (...args: unknown[]) => Promise<void>;
  handleOpenCodeActionableEvent: (...args: unknown[]) => Promise<unknown>;
  handleOpenCodePermissionAsked: (...args: unknown[]) => Promise<void>;
  importIntegrationSkillDraftsFromSandbox: (...args: unknown[]) => Promise<void>;
  waitForAuth: (...args: unknown[]) => Promise<{ success: boolean }>;
  waitForApproval: (...args: unknown[]) => Promise<string>;
};

function asTestManager(): GenerationManagerTestHarness {
  return generationManager as unknown as GenerationManagerTestHarness;
}

function createCtx(overrides: Partial<GenerationCtx> = {}): GenerationCtx {
  const ctx: GenerationCtx = {
    id: "gen-1",
    traceId: "trace-1",
    conversationId: "conv-1",
    userId: "user-1",
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
    isNewConversation: false,
    model: "openai/gpt-4",
    userMessageContent: "hello",
    assistantMessageIds: new Set(),
    messageRoles: new Map(),
    pendingMessageParts: new Map(),
    backendType: "direct",
    autoApprove: false,
    ...overrides,
  };
  return ctx;
}

async function collectEvents(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function* asAsyncIterable<T>(items: T[]) {
  for (const item of items) {
    yield item;
  }
}

describe("generationManager transitions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockReset();
    insertReturningMock.mockReset();
    insertValuesMock.mockImplementation(() => ({
      returning: insertReturningMock,
    }));
    insertReturningMock.mockResolvedValue([]);
    generationFindFirstMock.mockResolvedValue(null);
    generationFindManyMock.mockResolvedValue([]);
    messageFindFirstMock.mockResolvedValue(null);
    conversationFindFirstMock.mockResolvedValue(null);
    workflowRunFindFirstMock.mockResolvedValue(null);
    workflowFindFirstMock.mockResolvedValue(null);
    queueAddMock.mockReset();
    delete process.env.VERCEL;
    delete process.env.KUMA_PUSH_URL;

    const mgr = asTestManager();
    mgr.activeGenerations.clear();
  });

  it("cancels generation by aborting active context and setting cancel_requested", async () => {
    const ctx = createCtx();
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      status: "running",
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);

    const result = await generationManager.cancelGeneration(ctx.id, ctx.userId);

    expect(result).toBe(true);
    expect(ctx.abortController.signal.aborted).toBe(true);
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it("submits approval, persists running status, and emits approval_result", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: { command: "slack send" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
      },
    });
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    const result = await generationManager.submitApproval(ctx.id, "tool-1", "approve", ctx.userId);

    expect(result).toBe(true);
    expect(ctx.pendingApproval).not.toBeNull();
    expect(ctx.status).toBe("awaiting_approval");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          toolUseId: "tool-1",
          decision: "allow",
        }),
      }),
    );
  });

  it("submits question approval and persists decision for worker reconciliation", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-1",
        toolName: "Question",
        toolInput: { id: "question-request-1" },
        requestedAt: new Date().toISOString(),
        integration: "Bap",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "question-1",
      "approve",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          toolUseId: "question-1",
          decision: "allow",
        }),
      }),
    );
  });

  it("submits question answers selected in the frontend", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-3",
        toolName: "Question",
        toolInput: { id: "question-request-3" },
        requestedAt: new Date().toISOString(),
        integration: "Bap",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "question-3",
      "approve",
      ctx.userId,
      [["  Coding/Development  "]],
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          toolUseId: "question-3",
          decision: "allow",
          questionAnswers: [["Coding/Development"]],
        }),
      }),
    );
  });

  it("submits denied question approval and persists deny decision", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "question-2",
        toolName: "Question",
        toolInput: { id: "question-request-2" },
        requestedAt: new Date().toISOString(),
        integration: "Bap",
        operation: "question",
        command: "Choose one",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(ctx.id, "question-2", "deny", ctx.userId);

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          toolUseId: "question-2",
          decision: "deny",
        }),
      }),
    );
  });

  it("submits permission approval and persists decision for worker reconciliation", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      pendingApproval: {
        toolUseId: "permission-1",
        toolName: "Bash",
        toolInput: { command: "slack send" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
        command: "slack send",
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingApproval: ctx.pendingApproval,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    const result = await generationManager.submitApproval(
      ctx.id,
      "permission-1",
      "approve",
      ctx.userId,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          toolUseId: "permission-1",
          decision: "allow",
        }),
      }),
    );
  });

  it("auto-approves OpenCode permission asks when conversation auto-approve is enabled", async () => {
    const permissionReplyMock = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const ctx = createCtx({
      autoApprove: true,
      opencodeClient: {
        permission: {
          reply: permissionReplyMock,
        },
      },
    });
    const mgr = asTestManager();

    await mgr.handleOpenCodePermissionAsked(
      ctx,
      {
        permission: {
          reply: permissionReplyMock,
        },
      },
      {
        id: "permission-request-auto-approve",
        permission: "external_directory",
        patterns: ["/tmp/non-allowlisted-path"],
      },
    );

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-request-auto-approve",
      reply: "always",
    });
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.status).toBe("running");
  });

  it("auto-approves allowlisted external directories (/tmp and /app)", async () => {
    const permissionReplyMock = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const ctx = createCtx({
      autoApprove: false,
      opencodeClient: {
        permission: {
          reply: permissionReplyMock,
        },
      },
    });
    const mgr = asTestManager();

    await mgr.handleOpenCodePermissionAsked(
      ctx,
      {
        permission: {
          reply: permissionReplyMock,
        },
      },
      {
        id: "permission-request-allowlisted-paths",
        permission: "external_directory",
        patterns: ["/tmp/hello.txt", "/app/output/report.txt"],
      },
    );

    expect(permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-request-allowlisted-paths",
      reply: "always",
    });
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.status).toBe("running");
  });

  it("times out approval into paused status and emits status_change", async () => {
    const ctx = createCtx();
    workflowRunFindFirstMock.mockResolvedValue({ id: "wf-run-1" });
    const stalePendingApproval = {
      toolUseId: "plugin-stale",
      toolName: "Bash",
      toolInput: { command: "slack send" },
      requestedAt: new Date(0).toISOString(),
      expiresAt: new Date(1).toISOString(),
      integration: "slack",
      operation: "send",
      command: "slack send -t hi",
    };

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockImplementation(async (input?: unknown) => {
      const request = input as { with?: { conversation?: boolean } } | undefined;
      if (request?.with?.conversation) {
        return {
          id: ctx.id,
          conversationId: ctx.conversationId,
          status: "awaiting_approval",
          pendingApproval: stalePendingApproval,
          conversation: {
            id: ctx.conversationId,
            userId: ctx.userId,
            autoApprove: false,
          },
        };
      }
      return {
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "awaiting_approval",
        pendingApproval: stalePendingApproval,
        conversation: {
          id: ctx.conversationId,
          userId: ctx.userId,
        },
      };
    });

    const approvalPromise = generationManager.waitForApproval(ctx.id, {
      toolInput: { command: "slack send" },
      integration: "slack",
      operation: "send",
      command: "slack send -t hi",
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    await expect(approvalPromise).resolves.toBe("deny");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        finishedAt: expect.any(Date),
      }),
    );
  });

  it("tracks auth progress, then resumes and persists when all integrations connect", async () => {
    const ctx = createCtx({
      status: "awaiting_auth",
      pendingAuth: {
        integrations: ["slack", "github"],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
      },
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        pendingAuth: {
          integrations: ["slack", "github"],
          connectedIntegrations: [],
          requestedAt: new Date().toISOString(),
        },
        conversation: {
          id: ctx.conversationId,
          userId: ctx.userId,
        },
      })
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        pendingAuth: {
          integrations: ["slack", "github"],
          connectedIntegrations: ["slack"],
          requestedAt: new Date().toISOString(),
        },
        conversation: {
          id: ctx.conversationId,
          userId: ctx.userId,
        },
      });

    const first = await generationManager.submitAuthResult(ctx.id, "slack", true, ctx.userId);
    expect(first).toBe(true);

    const second = await generationManager.submitAuthResult(ctx.id, "github", true, ctx.userId);
    expect(second).toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        pendingAuth: null,
      }),
    );
  });

  it("cancels on auth timeout", async () => {
    const ctx = createCtx();
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    const stalePendingAuth = {
      integrations: ["slack"],
      connectedIntegrations: [],
      requestedAt: new Date(0).toISOString(),
      expiresAt: new Date(1).toISOString(),
    };
    generationFindFirstMock.mockImplementation(async () => ({
      id: ctx.id,
      conversationId: ctx.conversationId,
      status: "awaiting_auth",
      pendingAuth: stalePendingAuth,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
      cancelRequestedAt: null,
    }));

    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);

    const authPromise = generationManager.waitForAuth(ctx.id, {
      integration: "slack",
      reason: "Slack authentication required",
    });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

    await expect(authPromise).resolves.toEqual({ success: false });
    expect(finishSpy).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        pendingAuth: null,
      }),
    );
  });

  it("starts a new generation and enqueues background run", async () => {
    const mgr = asTestManager();
    const runSpy = vi.spyOn(mgr, "runGeneration").mockResolvedValue(undefined);

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-new",
          userId: "user-1",
          model: "anthropic/claude-sonnet-4-6",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-new" }]);

    const result = await generationManager.startGeneration({
      content: "Write a status update",
      userId: "user-1",
    });

    expect(result).toEqual({
      generationId: "gen-new",
      conversationId: "conv-new",
    });
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(mgr.activeGenerations.get("gen-new")).toMatchObject({
      id: "gen-new",
      conversationId: "conv-new",
      backendType: "opencode",
      userId: "user-1",
    });
  });

  it("enqueues run and preparing-stuck check jobs when deferred to worker", async () => {
    process.env.VERCEL = "1";
    const mgr = asTestManager();
    const runSpy = vi.spyOn(mgr, "runGeneration").mockResolvedValue(undefined);

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-new",
          userId: "user-1",
          model: "anthropic/claude-sonnet-4-6",
          autoApprove: false,
          type: "chat",
        },
      ])
      .mockResolvedValueOnce([{ id: "msg-user" }])
      .mockResolvedValueOnce([{ id: "gen-new" }]);

    await generationManager.startGeneration({
      content: "hi",
      userId: "user-1",
    });

    expect(runSpy).not.toHaveBeenCalled();
    expect(queueAddMock).toHaveBeenCalledTimes(2);
    expect(queueAddMock).toHaveBeenNthCalledWith(
      1,
      "generation:preparing-stuck-check",
      { generationId: "gen-new" },
      expect.objectContaining({
        delay: 5 * 60 * 1000,
      }),
    );
    expect(queueAddMock).toHaveBeenNthCalledWith(
      2,
      "generation:chat-run",
      { generationId: "gen-new" },
      expect.any(Object),
    );
  });

  it("reports stuck preparing generations and pushes to kuma", async () => {
    process.env.KUMA_PUSH_URL = "https://kuma.example/push/abc";
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-stuck",
      status: "running",
      sandboxId: null,
      completedAt: null,
      startedAt: new Date(Date.now() - 6 * 60 * 1000),
      conversation: {
        id: "conv-stuck",
        userId: "user-1",
        type: "chat",
      },
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await generationManager.processPreparingStuckCheck("gen-stuck");

    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "GENERATION_PREPARING_STUCK_DETECTED",
      expect.objectContaining({
        generationId: "gen-stuck",
        conversationId: "conv-stuck",
        userId: "user-1",
      }),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain("status=down");
    expect(calledUrl).toContain("conversation%3Dconv-stuck");
    expect(calledUrl).toContain("user%3Duser-1");
  });

  it("rejects startGeneration when an active generation already exists in DB", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-existing",
      status: "running",
    });

    await expect(
      generationManager.startGeneration({
        conversationId: "conv-existing",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Generation already in progress for this conversation");
  });

  it("rejects startGeneration when conversation belongs to another user", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv-1",
      userId: "other-user",
      model: "anthropic/claude-sonnet-4-6",
      autoApprove: false,
    });

    await expect(
      generationManager.startGeneration({
        conversationId: "conv-1",
        content: "hello",
        userId: "user-1",
      }),
    ).rejects.toThrow("Access denied");
  });

  it("starts workflow generation and keeps workflow context fields", async () => {
    const mgr = asTestManager();
    const runSpy = vi.spyOn(mgr, "runGeneration").mockResolvedValue(undefined);

    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "conv-workflow",
          userId: "user-1",
          model: "openai/gpt-4.1-mini",
          autoApprove: true,
          type: "workflow",
        },
      ])
      .mockResolvedValueOnce([{ id: "gen-workflow" }]);

    const result = await generationManager.startWorkflowGeneration({
      workflowRunId: "wf-run-1",
      content: "Create a weekly report",
      userId: "user-1",
      autoApprove: true,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: ["custom-slug"],
      model: "openai/gpt-4.1-mini",
    });

    expect(result).toEqual({
      generationId: "gen-workflow",
      conversationId: "conv-workflow",
    });
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(mgr.activeGenerations.get("gen-workflow")).toMatchObject({
      workflowRunId: "wf-run-1",
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: ["custom-slug"],
      workflowPrompt: undefined,
      workflowPromptDo: undefined,
      workflowPromptDont: undefined,
      triggerPayload: undefined,
    });
  });

  it("returns status from database when context is active", async () => {
    const ctx = createCtx({
      contentParts: [{ type: "text", text: "hello" }],
      usage: { inputTokens: 3, outputTokens: 5, totalCostUsd: 0 },
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: {},
        requestedAt: new Date().toISOString(),
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      status: "running",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: { toolUseId: "tool-db" },
      inputTokens: 6,
      outputTokens: 8,
    });

    const status = await generationManager.getGenerationStatus(ctx.id);

    expect(status).toEqual({
      status: "running",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: expect.objectContaining({ toolUseId: "tool-db" }),
      usage: { inputTokens: 6, outputTokens: 8 },
    });
  });

  it("returns status from database when context is not active", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: { toolUseId: "tool-db" },
      inputTokens: 9,
      outputTokens: 11,
    });

    const status = await generationManager.getGenerationStatus("gen-db");

    expect(status).toEqual({
      status: "paused",
      contentParts: [{ type: "text", text: "persisted" }],
      pendingApproval: { toolUseId: "tool-db" },
      usage: { inputTokens: 9, outputTokens: 11 },
    });
  });

  it("subscribes from DB terminal state and replays terminal events", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-db",
      conversationId: "conv-db",
      status: "completed",
      messageId: "msg-final",
      inputTokens: 7,
      outputTokens: 13,
      errorMessage: null,
      conversation: {
        userId: "user-1",
      },
      contentParts: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
          integration: "slack",
          operation: "send",
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
        { type: "thinking", id: "think-1", content: "..." },
      ],
    });

    const events = await collectEvents(generationManager.subscribeToGeneration("gen-db", "user-1"));

    expect(events).toEqual([
      { type: "text", content: "hi" },
      {
        type: "tool_use",
        toolName: "bash",
        toolInput: { command: "echo hi" },
        toolUseId: "tool-1",
        integration: "slack",
        operation: "send",
      },
      { type: "tool_result", toolName: "bash", result: "ok", toolUseId: "tool-1" },
      { type: "thinking", content: "...", thinkingId: "think-1" },
      { type: "status_change", status: "completed" },
      {
        type: "done",
        generationId: "gen-db",
        conversationId: "conv-db",
        messageId: "msg-final",
        usage: { inputTokens: 7, outputTokens: 13, totalCostUsd: 0 },
      },
    ]);
  });

  it("subscribes from active context and replays pending approval/auth state", async () => {
    const ctx = createCtx({
      status: "awaiting_approval",
      contentParts: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "ls" },
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
      ],
      pendingApproval: {
        toolUseId: "tool-pending",
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/x" },
        requestedAt: new Date().toISOString(),
        integration: "slack",
        operation: "send",
        command: "rm -rf /tmp/x",
      },
      pendingAuth: null,
    });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        pendingAuth: null,
      })
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "awaiting_approval",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: ctx.pendingApproval,
        pendingAuth: null,
      })
      .mockResolvedValueOnce({
        id: ctx.id,
        conversationId: ctx.conversationId,
        status: "cancelled",
        messageId: null,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: null,
        conversation: {
          userId: ctx.userId,
          type: "chat",
        },
        contentParts: ctx.contentParts,
        pendingApproval: null,
        pendingAuth: null,
      });

    const eventsPromise = collectEvents(
      generationManager.subscribeToGeneration(ctx.id, ctx.userId),
    );
    await vi.advanceTimersByTimeAsync(500);
    const events = await eventsPromise;

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text", content: "hi" },
        {
          type: "tool_use",
          toolName: "bash",
          toolInput: { command: "ls" },
          toolUseId: "tool-1",
        },
        { type: "tool_result", toolName: "bash", result: "ok", toolUseId: "tool-1" },
        { type: "status_change", status: "awaiting_approval" },
        {
          type: "pending_approval",
          generationId: "gen-1",
          conversationId: "conv-1",
          toolUseId: "tool-pending",
          toolName: "Bash",
          toolInput: { command: "rm -rf /tmp/x" },
          integration: "slack",
          operation: "send",
          command: "rm -rf /tmp/x",
        },
        {
          type: "cancelled",
          generationId: "gen-1",
          conversationId: "conv-1",
          messageId: undefined,
        },
      ]),
    );
  });

  it("dispatches runGeneration to session reset, direct backend, and opencode backend", async () => {
    const mgr = asTestManager();
    const resetSpy = vi.spyOn(mgr, "handleSessionReset").mockResolvedValue(undefined);
    const directSpy = vi.spyOn(mgr, "runDirectGeneration").mockResolvedValue(undefined);
    const opencodeSpy = vi.spyOn(mgr, "runOpenCodeGeneration").mockResolvedValue(undefined);

    await mgr.runGeneration(createCtx({ userMessageContent: " /new ", backendType: "opencode" }));
    await mgr.runGeneration(createCtx({ userMessageContent: "hello", backendType: "direct" }));
    await mgr.runGeneration(createCtx({ userMessageContent: "hello", backendType: "opencode" }));

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(directSpy).toHaveBeenCalledTimes(1);
    expect(opencodeSpy).toHaveBeenCalledTimes(1);
  });

  it("finishes completed generation, emits done, and cleans up in-memory state", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-1" }]);

    const callback = vi.fn();
    const ctx = createCtx({
      assistantContent: "Final answer",
      contentParts: [{ type: "text", text: "Final answer" }],
      sessionId: "session-1",
      uploadedSandboxFileIds: new Set(),
    });
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    await mgr.finishGeneration(ctx, "completed");

    expect(ctx.status).toBe("completed");
    expect(callback).toHaveBeenCalledWith({
      type: "done",
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      messageId: "msg-assistant-1",
      usage: ctx.usage,
    });
    expect(mgr.activeGenerations.has(ctx.id)).toBe(false);
  });

  it("auto-collects only sandbox files mentioned in final answer text", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-files-1" }]);
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([
      { path: "/app/QUESTIONNAIRE_RCP_rempli.pdf", content: Buffer.from("pdf") },
      { path: "/app/rcp_payload.json", content: Buffer.from("{}") },
    ]);
    vi.mocked(uploadSandboxFile).mockResolvedValue({
      id: "sandbox-file-mentioned",
      filename: "QUESTIONNAIRE_RCP_rempli.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      path: "/app/QUESTIONNAIRE_RCP_rempli.pdf",
      storageKey: "k/QUESTIONNAIRE_RCP_rempli.pdf",
    });

    const ctx = createCtx({
      assistantContent:
        "Questionnaire rempli avec les informations personnelles fournies et télécharge ici : `QUESTIONNAIRE_RCP_rempli.pdf`.",
      contentParts: [
        {
          type: "text",
          text: "Questionnaire rempli avec les informations personnelles fournies et télécharge ici : `QUESTIONNAIRE_RCP_rempli.pdf`.",
        },
      ],
      generationMarkerTime: Date.now() - 1_000,
      sandbox: {} as unknown,
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    await mgr.finishGeneration(ctx, "completed");

    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/app/QUESTIONNAIRE_RCP_rempli.pdf",
      }),
    );
    expect(ctx.uploadedSandboxFileIds?.has("sandbox-file-mentioned")).toBe(true);
  });

  it("does not auto-collect sandbox files when none are mentioned in final answer text", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-files-2" }]);
    vi.mocked(collectNewSandboxFiles).mockResolvedValue([
      { path: "/app/questionnaire-rcp-pdf.template.json", content: Buffer.from("{}") },
    ]);

    const ctx = createCtx({
      assistantContent: "Traitement terminé.",
      contentParts: [{ type: "text", text: "Traitement terminé." }],
      generationMarkerTime: Date.now() - 1_000,
      sandbox: {} as unknown,
      uploadedSandboxFileIds: new Set(),
    });

    const mgr = asTestManager();
    await mgr.finishGeneration(ctx, "completed");

    expect(vi.mocked(uploadSandboxFile)).not.toHaveBeenCalled();
    expect(ctx.uploadedSandboxFileIds?.size).toBe(0);
  });

  it("finishes cancelled generation with interruption marker and emits cancelled", async () => {
    insertReturningMock.mockResolvedValueOnce([{ id: "msg-assistant-2" }]);

    const callback = vi.fn();
    const ctx = createCtx({
      assistantContent: "",
      contentParts: [{ type: "text", text: "partial" }],
      uploadedSandboxFileIds: new Set(),
    });
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);

    await mgr.finishGeneration(ctx, "cancelled");

    expect(ctx.status).toBe("cancelled");
    expect(
      ctx.contentParts.some(
        (p: unknown) =>
          !!p &&
          typeof p === "object" &&
          (p as { type?: unknown }).type === "system" &&
          (p as { content?: unknown }).content === "Interrupted by user",
      ),
    ).toBe(true);
    expect(callback).toHaveBeenCalledWith({
      type: "cancelled",
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      messageId: "msg-assistant-2",
    });
  });

  it("handles submitApproval guard paths (missing context, access denied, mismatched toolUseId)", async () => {
    const missing = await generationManager.submitApproval(
      "missing",
      "tool-1",
      "approve",
      "user-1",
    );
    expect(missing).toBe(false);

    const deniedCtx = createCtx({
      pendingApproval: {
        toolUseId: "tool-1",
        toolName: "Bash",
        toolInput: {},
        requestedAt: new Date().toISOString(),
      },
    });
    const mgr = asTestManager();
    mgr.activeGenerations.set("gen-denied", deniedCtx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-denied",
      conversationId: deniedCtx.conversationId,
      pendingApproval: deniedCtx.pendingApproval,
      conversation: {
        id: deniedCtx.conversationId,
        userId: deniedCtx.userId,
      },
    });

    await expect(
      generationManager.submitApproval("gen-denied", "tool-1", "approve", "other-user"),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-denied",
      conversationId: deniedCtx.conversationId,
      pendingApproval: deniedCtx.pendingApproval,
      conversation: {
        id: deniedCtx.conversationId,
        userId: deniedCtx.userId,
      },
    });
    const mismatch = await generationManager.submitApproval(
      "gen-denied",
      "tool-does-not-match",
      "approve",
      deniedCtx.userId,
    );
    expect(mismatch).toBe(false);
  });

  it("handles submitAuthResult guard paths and cancellation path", async () => {
    const missing = await generationManager.submitAuthResult("missing", "slack", true, "user-1");
    expect(missing).toBe(false);

    const mgr = asTestManager();
    const ctx = createCtx({ pendingAuth: null });
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingAuth: null,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });

    await expect(
      generationManager.submitAuthResult(ctx.id, "slack", true, "other-user"),
    ).rejects.toThrow("Access denied");

    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      pendingAuth: null,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
      },
    });
    const noPending = await generationManager.submitAuthResult(ctx.id, "slack", true, ctx.userId);
    expect(noPending).toBe(false);

    const ctxWithPendingAuth = createCtx({ id: "gen-auth-fail" });
    mgr.activeGenerations.set(ctxWithPendingAuth.id, ctxWithPendingAuth);
    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctxWithPendingAuth.id,
      conversationId: ctxWithPendingAuth.conversationId,
      pendingAuth: {
        integrations: ["slack"],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
      },
      conversation: {
        id: ctxWithPendingAuth.conversationId,
        userId: ctxWithPendingAuth.userId,
      },
    });

    const cancelled = await generationManager.submitAuthResult(
      ctxWithPendingAuth.id,
      "slack",
      false,
      ctxWithPendingAuth.userId,
    );
    expect(cancelled).toBe(true);
    expect(finishSpy).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        pendingAuth: null,
      }),
    );
  });

  it("returns immediate fallback values for waitForApproval/waitForAuth guard paths", async () => {
    await expect(
      generationManager.waitForApproval("missing", {
        toolInput: {},
        integration: "slack",
        operation: "send",
        command: "slack send",
      }),
    ).resolves.toBe("deny");

    await expect(
      generationManager.waitForAuth("missing", {
        integration: "slack",
      }),
    ).resolves.toEqual({ success: false });

    const ctx = createCtx({ autoApprove: true });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValueOnce({
      id: ctx.id,
      conversationId: ctx.conversationId,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: true,
      },
    });

    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: {},
        integration: "github",
        operation: "create-issue",
        command: "github create-issue --title bug",
      }),
    ).resolves.toBe("allow");
  });

  it("auto-approves write requests when autoApprove is enabled", async () => {
    const ctx = createCtx({ autoApprove: true });
    const mgr = asTestManager();
    mgr.activeGenerations.set(ctx.id, ctx);
    generationFindFirstMock.mockResolvedValue({
      id: ctx.id,
      conversationId: ctx.conversationId,
      conversation: {
        id: ctx.conversationId,
        userId: ctx.userId,
        autoApprove: true,
      },
    });

    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: { command: "slack send -c C123 -t hi" },
        integration: "slack",
        operation: "send",
        command: "slack send -c C123 -t hi",
      }),
    ).resolves.toBe("allow");
    await expect(
      generationManager.waitForApproval(ctx.id, {
        toolInput: {},
        integration: "github",
        operation: "create-issue",
        command: "github create-issue --title bug",
      }),
    ).resolves.toBe("allow");
    expect(updateSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        pendingApproval: expect.anything(),
      }),
    );
  });

  it("builds workflow prompt sections only when workflow context is present", () => {
    const mgr = asTestManager();

    expect(
      mgr.buildWorkflowPrompt(createCtx({ workflowPrompt: undefined, triggerPayload: undefined })),
    ).toBeNull();

    const prompt = mgr.buildWorkflowPrompt(
      createCtx({
        workflowPrompt: "Primary workflow instructions",
        workflowPromptDo: "Do this",
        workflowPromptDont: "Do not do that",
        triggerPayload: { event: "cron" },
      }),
    );

    expect(prompt).toContain("## Workflow Instructions");
    expect(prompt).toContain("Primary workflow instructions");
    expect(prompt).toContain("## Do");
    expect(prompt).toContain("## Don't");
    expect(prompt).toContain("## Trigger Payload");
  });

  it("runs OpenCode generation happy path and completes", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", { value: "test-key", configurable: true });

    vi.mocked(getCliEnvForUser).mockResolvedValue({
      GITHUB_ACCESS_TOKEN: "gh-token",
      SLACK_ACCESS_TOKEN: "slack-token",
    });
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["github", "slack"]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("cli instructions");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue(["base-skill"]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("skills prompt");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue(["github"]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("integration skills prompt");
    vi.mocked(syncMemoryToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("memory prompt");
    vi.mocked(collectNewE2BFiles).mockResolvedValue([
      { path: "/app/out/report.txt", content: Buffer.from("report") },
    ]);
    vi.mocked(uploadSandboxFile).mockResolvedValue({
      id: "sandbox-file-1",
      filename: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
      path: "/app/out/report.txt",
      storageKey: "k/report.txt",
    });

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-opencode",
      title: "Conversation",
      opencodeSessionId: "session-existing",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateSession).mockResolvedValue({
      client: {
        event: { subscribe: subscribeMock },
        session: { prompt: promptMock },
      },
      sessionId: "session-1",
      sandbox: {
        sandboxId: "sandbox-1",
        files: {
          write: vi.fn().mockResolvedValue(undefined),
        },
        commands: {
          run: vi.fn().mockResolvedValue({}),
        },
      },
    } as unknown as Awaited<ReturnType<typeof getOrCreateSession>>);

    const mgr = asTestManager();
    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromE2B").mockResolvedValue(undefined);
    vi.spyOn(mgr, "processOpencodeEvent").mockResolvedValue(undefined);
    vi.spyOn(mgr, "handleOpenCodeActionableEvent").mockResolvedValue({
      type: "none",
    });

    const ctx = createCtx({
      id: "gen-opencode",
      conversationId: "conv-opencode",
      backendType: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      allowedIntegrations: ["github"],
      userMessageContent: "Process these files",
      assistantContent: "The generated file is report.txt.",
      attachments: [
        {
          name: "image.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
        {
          name: "notes.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
        },
      ],
      uploadedSandboxFileIds: new Set(),
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(collectNewE2BFiles)).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.arrayContaining(["/home/user/uploads/notes.txt"]),
    );
    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalled();
    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    expect(ctx.uploadedSandboxFileIds?.has("sandbox-file-1")).toBe(true);
  });

  it("streams OpenCode reasoning parts as thinking events", async () => {
    Object.defineProperty(env, "ANTHROPIC_API_KEY", { value: "test-key", configurable: true });

    vi.mocked(getCliEnvForUser).mockResolvedValue({});
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue([]);
    vi.mocked(getCliInstructionsWithCustom).mockResolvedValue("");
    vi.mocked(writeSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(writeResolvedIntegrationSkillsToSandbox).mockResolvedValue([]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("");
    vi.mocked(syncMemoryToSandbox).mockResolvedValue([]);
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("");
    vi.mocked(collectNewE2BFiles).mockResolvedValue([]);

    conversationFindFirstMock.mockResolvedValue({
      id: "conv-reasoning",
      title: "Conversation",
      opencodeSessionId: "session-existing",
    });

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const subscribeMock = vi.fn().mockResolvedValue({
      stream: asAsyncIterable([
        { type: "server.connected", properties: {} },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "reason-1",
              sessionID: "session-1",
              messageID: "msg-1",
              type: "reasoning",
              text: "plan",
              time: { start: Date.now() },
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "reason-1",
              sessionID: "session-1",
              messageID: "msg-1",
              type: "reasoning",
              text: "plan more",
              time: { start: Date.now() },
            },
          },
        },
        { type: "session.idle", properties: {} },
      ]),
    });
    vi.mocked(getOrCreateSession).mockResolvedValue({
      client: {
        event: { subscribe: subscribeMock },
        session: { prompt: promptMock },
      },
      sessionId: "session-1",
      sandbox: {
        sandboxId: "sandbox-1",
        files: { write: vi.fn().mockResolvedValue(undefined) },
        commands: { run: vi.fn().mockResolvedValue({}) },
      },
    } as unknown as Awaited<ReturnType<typeof getOrCreateSession>>);

    const mgr = asTestManager();
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromE2B").mockResolvedValue(undefined);
    vi.spyOn(mgr, "handleOpenCodeActionableEvent").mockResolvedValue({ type: "none" });
    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);

    const streamedEvents: unknown[] = [];
    const ctx = createCtx({
      id: "gen-reasoning",
      conversationId: "conv-reasoning",
      backendType: "opencode",
      model: "openai/gpt-5.2-codex",
      subscribers: new Map([
        [
          "sub-1",
          {
            id: "sub-1",
            callback: (event: unknown) => {
              streamedEvents.push(event);
            },
          },
        ],
      ]),
    });

    await mgr.runOpenCodeGeneration(ctx);

    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    expect(streamedEvents).toEqual(
      expect.arrayContaining([
        { type: "thinking", content: "plan", thinkingId: "reason-1" },
        { type: "thinking", content: " more", thinkingId: "reason-1" },
      ]),
    );
    expect(ctx.contentParts).toEqual(
      expect.arrayContaining([{ type: "thinking", id: "reason-1", content: "plan more" }]),
    );
  });

  it("runs direct generation through multi-tool paths and keeps send_file artifacts even when not mentioned", async () => {
    vi.mocked(getEnabledIntegrationTypes).mockResolvedValue(["github"]);
    vi.mocked(resolvePreferredCommunitySkillsForUser).mockResolvedValue([
      {
        source: "community",
        slug: "skill-one",
        id: "is-1",
        title: "Skill One",
        description: "desc",
        files: [
          { path: "README.md", content: "hi" },
          { path: "nested/file.txt", content: "content" },
        ],
        createdByUserId: "user-1",
      },
    ]);
    vi.mocked(getIntegrationSkillsSystemPrompt).mockReturnValue("integration skills prompt");
    vi.mocked(buildMemorySystemPrompt).mockReturnValue("memory prompt");
    vi.mocked(getDirectModeTools).mockReturnValue([{ name: "bash" }] as ReturnType<
      typeof getDirectModeTools
    >);
    vi.mocked(syncMemoryToSandbox).mockResolvedValue([]);
    vi.mocked(parseBashCommand).mockImplementation((command) => {
      if (command === "slack forbidden") {
        return { integration: "slack" } as ReturnType<typeof parseBashCommand>;
      }
      return null;
    });
    vi.mocked(checkToolPermissions).mockImplementation((toolName) => {
      if (toolName === "auth_tool") {
        return {
          allowed: false,
          needsApproval: false,
          needsAuth: true,
          integration: "slack",
          integrationName: "Slack",
          reason: "auth needed",
        };
      }
      if (toolName === "approve_tool") {
        return {
          allowed: false,
          needsApproval: true,
          needsAuth: false,
          integration: "github",
        };
      }
      return {
        allowed: true,
        needsApproval: false,
        needsAuth: false,
      };
    });
    vi.mocked(parseBashCommand).mockImplementation((command) => {
      if (command === "google-gmail list -l 1") {
        return {
          integration: "gmail",
          operation: "list",
          integrationName: "Gmail",
          isWrite: false,
        };
      }
      return null;
    });
    vi.mocked(readSandboxFileAsBuffer).mockResolvedValue(Buffer.from("file-content"));
    vi.mocked(uploadSandboxFile).mockResolvedValue({
      id: "uploaded-send-file-1",
      filename: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      path: "/tmp/report.txt",
      storageKey: "k/report.txt",
    });
    vi.mocked(toolCallToCommand).mockImplementation((toolName) => {
      if (toolName === "bash_exec") {
        return { command: "run-ok", isWrite: false };
      }
      if (toolName === "bash_fail") {
        return { command: "run-fail", isWrite: false };
      }
      return null;
    });

    const sandbox = {
      setup: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockImplementation(async (command: string) => {
        if (command === "run-ok") {
          return { stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (command === "run-fail") {
          return { stdout: "out", stderr: "err", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getSandboxBackend).mockReturnValue(
      sandbox as unknown as ReturnType<typeof getSandboxBackend>,
    );

    const firstStream = asAsyncIterable([
      { type: "text_delta", text: "Hello " },
      { type: "tool_use_start", toolUseId: "m1", toolName: "memory_write" },
      { type: "tool_use_delta", jsonDelta: '{"content":"note"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "b1", toolName: "bash" },
      { type: "tool_use_delta", jsonDelta: '{"command":"google-gmail list -l 1"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "a1", toolName: "auth_tool" },
      { type: "tool_use_delta", jsonDelta: "{}" },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "ap1", toolName: "approve_tool" },
      { type: "tool_use_delta", jsonDelta: '{"command":"write"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "sf1", toolName: "send_file" },
      { type: "tool_use_delta", jsonDelta: '{"path":"/tmp/report.txt"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "e1", toolName: "bash_exec" },
      { type: "tool_use_delta", jsonDelta: '{"command":"echo hi"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "e2", toolName: "bash_fail" },
      { type: "tool_use_delta", jsonDelta: '{"command":"bad"}' },
      { type: "tool_use_end" },
      { type: "tool_use_start", toolUseId: "u1", toolName: "unknown_tool" },
      { type: "tool_use_delta", jsonDelta: "{}" },
      { type: "tool_use_end" },
      { type: "usage", inputTokens: 2, outputTokens: 3 },
    ]);
    const secondStream = asAsyncIterable([
      { type: "text_delta", text: "done" },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
    ]);
    const llm = {
      chat: vi.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream),
    };

    const mgr = asTestManager();
    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);
    vi.spyOn(mgr, "getLLMBackend").mockResolvedValue(llm);
    vi.spyOn(mgr, "buildMessageHistory").mockResolvedValue([]);
    vi.spyOn(mgr, "executeMemoryTool").mockResolvedValue({
      content: "memory ok",
      isError: false,
    });
    vi.spyOn(mgr, "importIntegrationSkillDraftsFromSandbox").mockResolvedValue(undefined);
    vi.spyOn(mgr, "waitForAuth").mockResolvedValue({ success: false });
    vi.spyOn(mgr, "waitForApproval").mockResolvedValue("deny");

    const ctx = createCtx({
      id: "gen-direct-heavy",
      conversationId: "conv-direct-heavy",
      backendType: "direct",
      model: "openai/gpt-4.1",
      allowedIntegrations: ["github"],
      uploadedSandboxFileIds: new Set(),
    });

    await mgr.runDirectGeneration(ctx);

    expect(finishSpy).toHaveBeenCalledWith(ctx, "completed");
    expect(ctx.assistantContent).not.toContain("report.txt");
    expect(vi.mocked(uploadSandboxFile)).toHaveBeenCalled();
    expect(ctx.uploadedSandboxFileIds?.has("uploaded-send-file-1")).toBe(true);
    expect(ctx.assistantContent).toContain("Hello done");
    expect(ctx.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
          id: "b1",
          name: "bash",
          integration: "gmail",
          operation: "list",
        }),
      ]),
    );
  });

  it("reaps stale generations and evicts matching active contexts", async () => {
    const now = Date.now();
    generationFindManyMock.mockResolvedValue([
      {
        id: "gen-stale-running",
        status: "running",
        startedAt: new Date(now - 7 * 60 * 60 * 1000),
      },
      {
        id: "gen-stale-paused",
        status: "paused",
        startedAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        id: "gen-fresh-running",
        status: "running",
        startedAt: new Date(now - 30 * 60 * 1000),
      },
    ]);

    const mgr = asTestManager();
    mgr.activeGenerations.set("gen-stale-running", createCtx({ id: "gen-stale-running" }));
    mgr.activeGenerations.set("gen-stale-paused", createCtx({ id: "gen-stale-paused" }));
    mgr.activeGenerations.set("gen-fresh-running", createCtx({ id: "gen-fresh-running" }));

    const summary = await generationManager.reapStaleGenerations();

    expect(summary).toEqual({
      scanned: 3,
      stale: 2,
      finalizedRunningAsError: 1,
      finalizedOtherAsCancelled: 1,
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        completedAt: expect.any(Date),
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        completedAt: expect.any(Date),
      }),
    );

    expect(mgr.activeGenerations.has("gen-stale-running")).toBe(false);
    expect(mgr.activeGenerations.has("gen-stale-paused")).toBe(false);
    expect(mgr.activeGenerations.has("gen-fresh-running")).toBe(true);
  });

  it("bounds pending unknown message parts and resets queue after TTL", async () => {
    const mgr = asTestManager();
    const ctx = createCtx({
      userMessageContent: "hello",
    });

    const processEvent = async (id: string, text = "hello") => {
      await mgr.processOpencodeEvent(
        ctx,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id,
              type: "text",
              text,
              messageID: "msg-unknown",
            },
          },
        } as unknown,
        null,
        null,
        () => {},
      );
    };

    for (let i = 0; i < 120; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential enqueueing is intentional in this test
      await processEvent(`part-${i}`);
    }

    const queuedBeforeTtl = ctx.pendingMessageParts.get("msg-unknown") as
      | { firstQueuedAtMs: number; parts: unknown[] }
      | undefined;
    expect(queuedBeforeTtl).toBeDefined();
    expect(queuedBeforeTtl?.parts).toHaveLength(100);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await processEvent("part-after-ttl");

    const queuedAfterTtl = ctx.pendingMessageParts.get("msg-unknown") as
      | { firstQueuedAtMs: number; parts: unknown[] }
      | undefined;
    expect(queuedAfterTtl).toBeDefined();
    expect(queuedAfterTtl?.parts).toHaveLength(1);
  });

  it("truncates oversized OpenCode tool results before storing content parts", async () => {
    const mgr = asTestManager();
    const ctx = createCtx({
      contentParts: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo big" },
        },
      ],
      messageRoles: new Map([["assistant-msg", "assistant"]]),
    });

    const hugeOutput = "x".repeat(120_000);

    await mgr.processOpencodeEvent(
      ctx,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-part-1",
            type: "tool",
            tool: "bash",
            callID: "tool-1",
            messageID: "assistant-msg",
            state: {
              status: "completed",
              output: hugeOutput,
            },
          },
        },
      } as unknown,
      null,
      null,
      () => {},
    );

    const toolResult = ctx.contentParts.find(
      (part) =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "tool_result" &&
        (part as { tool_use_id?: unknown }).tool_use_id === "tool-1",
    ) as { content?: unknown } | undefined;

    expect(toolResult).toBeDefined();
    expect(typeof toolResult?.content).toBe("string");
    expect(String(toolResult?.content)).toContain("... (output truncated)");
    expect(String(toolResult?.content).length).toBeLessThanOrEqual(100_024);
  });
});

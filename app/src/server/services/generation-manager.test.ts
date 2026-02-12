import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateWhereMock, updateSetMock, updateMock, insertValuesMock, insertMock, dbMock } = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const insertValuesMock = vi.fn();
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const dbMock = {
    query: {
      generation: { findFirst: vi.fn() },
    },
    update: updateMock,
    insert: insertMock,
  };

  return { updateWhereMock, updateSetMock, updateMock, insertValuesMock, insertMock, dbMock };
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
  getSandboxBackend: vi.fn(),
}));

vi.mock("@/server/ai/anthropic-backend", () => ({
  AnthropicBackend: class AnthropicBackend {},
}));

vi.mock("@/server/ai/openai-backend", () => ({
  OpenAIBackend: class OpenAIBackend {},
}));

vi.mock("@/server/ai/local-backend", () => ({
  LocalLLMBackend: class LocalLLMBackend {},
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

import { generationManager } from "./generation-manager";

function createCtx(overrides: Partial<Record<string, any>> = {}) {
  const ctx: any = {
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
    model: "gpt-4",
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

describe("generationManager transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);

    const mgr = generationManager as any;
    mgr.activeGenerations.clear();
    mgr.conversationToGeneration.clear();
  });

  it("cancels generation by aborting and delegating to finishGeneration", async () => {
    const ctx = createCtx();
    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);

    const result = await generationManager.cancelGeneration(ctx.id, ctx.userId);

    expect(result).toBe(true);
    expect(ctx.abortController.signal.aborted).toBe(true);
    expect(finishSpy).toHaveBeenCalledWith(ctx, "cancelled");
  });

  it("submits approval, persists running status, and emits approval_result", async () => {
    const callback = vi.fn();
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
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });
    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const result = await generationManager.submitApproval(ctx.id, "tool-1", "approve", ctx.userId);

    expect(result).toBe(true);
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.status).toBe("running");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        pendingApproval: null,
      })
    );

    expect(callback).toHaveBeenCalledWith({
      type: "approval_result",
      toolUseId: "tool-1",
      decision: "approved",
    });
  });

  it("submits question approval and replies to OpenCode with default answers", async () => {
    const callback = vi.fn();
    const questionReplyMock = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const questionRejectMock = vi.fn().mockResolvedValue({ data: true, error: undefined });

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
      opencodeClient: {
        question: {
          reply: questionReplyMock,
          reject: questionRejectMock,
        },
        permission: {
          reply: vi.fn(),
        },
      },
      opencodePendingApprovalRequest: {
        kind: "question",
        request: {
          id: "question-request-1",
          sessionID: "session-1",
          questions: [
            {
              header: "Choice",
              question: "Pick one option",
              options: [
                { label: "A", description: "Option A" },
                { label: "B", description: "Option B" },
              ],
            },
          ],
        },
        defaultAnswers: [["A"]],
      },
    });
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const result = await generationManager.submitApproval(ctx.id, "question-1", "approve", ctx.userId);

    expect(result).toBe(true);
    expect(questionReplyMock).toHaveBeenCalledWith({
      requestID: "question-request-1",
      answers: [["A"]],
    });
    expect(questionRejectMock).not.toHaveBeenCalled();
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.status).toBe("running");
    expect(callback).toHaveBeenCalledWith({
      type: "approval_result",
      toolUseId: "question-1",
      decision: "approved",
    });
  });

  it("submits denied question approval and rejects OpenCode question", async () => {
    const callback = vi.fn();
    const questionReplyMock = vi.fn().mockResolvedValue({ data: true, error: undefined });
    const questionRejectMock = vi.fn().mockResolvedValue({ data: true, error: undefined });

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
      opencodeClient: {
        question: {
          reply: questionReplyMock,
          reject: questionRejectMock,
        },
        permission: {
          reply: vi.fn(),
        },
      },
      opencodePendingApprovalRequest: {
        kind: "question",
        request: {
          id: "question-request-2",
          sessionID: "session-2",
          questions: [
            {
              header: "Choice",
              question: "Pick one option",
              options: [{ label: "A", description: "Option A" }],
            },
          ],
        },
        defaultAnswers: [["A"]],
      },
    });
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const result = await generationManager.submitApproval(ctx.id, "question-2", "deny", ctx.userId);

    expect(result).toBe(true);
    expect(questionReplyMock).not.toHaveBeenCalled();
    expect(questionRejectMock).toHaveBeenCalledWith({
      requestID: "question-request-2",
    });
    expect(ctx.pendingApproval).toBeNull();
    expect(ctx.status).toBe("running");
    expect(callback).toHaveBeenCalledWith({
      type: "approval_result",
      toolUseId: "question-2",
      decision: "denied",
    });
  });

  it("times out approval into paused status and emits status_change", async () => {
    const callback = vi.fn();
    const ctx = createCtx();
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const approvalPromise = generationManager.waitForApproval(ctx.id, {
      toolInput: { command: "slack send" },
      integration: "slack",
      operation: "send",
      command: "slack send -t hi",
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    await expect(approvalPromise).resolves.toBe("deny");
    expect(ctx.status).toBe("paused");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        isPaused: true,
      })
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: "status_change", status: "paused" })
    );
  });

  it("tracks auth progress, then resumes and persists when all integrations connect", async () => {
    const callback = vi.fn();
    const ctx = createCtx({
      status: "awaiting_auth",
      pendingAuth: {
        integrations: ["slack", "github"],
        connectedIntegrations: [],
        requestedAt: new Date().toISOString(),
      },
    });
    ctx.subscribers.set("sub-1", { id: "sub-1", callback });

    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const first = await generationManager.submitAuthResult(ctx.id, "slack", true, ctx.userId);
    expect(first).toBe(true);
    expect(ctx.status).toBe("awaiting_auth");
    expect(ctx.pendingAuth?.connectedIntegrations).toEqual(["slack"]);

    const second = await generationManager.submitAuthResult(ctx.id, "github", true, ctx.userId);
    expect(second).toBe(true);
    expect(ctx.status).toBe("running");
    expect(ctx.pendingAuth).toBeNull();

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        pendingAuth: null,
      })
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth_result",
        success: true,
        integrations: ["slack", "github"],
      })
    );
  });

  it("cancels on auth timeout", async () => {
    const ctx = createCtx();
    const mgr = generationManager as any;
    mgr.activeGenerations.set(ctx.id, ctx);

    const finishSpy = vi.spyOn(mgr, "finishGeneration").mockResolvedValue(undefined);

    const authPromise = generationManager.waitForAuth(ctx.id, {
      integration: "slack",
      reason: "Slack authentication required",
    });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

    await expect(authPromise).resolves.toEqual({ success: false });
    expect(finishSpy).toHaveBeenCalledWith(ctx, "cancelled");
  });
});

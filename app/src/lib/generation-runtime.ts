export type TraceStatus = "streaming" | "complete" | "error" | "waiting_approval" | "waiting_auth";

export type RuntimeMessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
      result?: unknown;
      integration?: string;
      operation?: string;
      isWrite?: boolean;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string }
  | {
      type: "approval";
      toolUseId: string;
      toolName: string;
      toolInput: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
    };

export type RuntimeActivityItem = {
  id: string;
  timestamp: number;
  type: "text" | "thinking" | "tool_call" | "tool_result" | "system";
  content: string;
  toolUseId?: string;
  toolName?: string;
  integration?: string;
  operation?: string;
  status?: "running" | "complete" | "error" | "interrupted";
  input?: unknown;
  result?: unknown;
  elapsedMs?: number;
};

export type RuntimeSegmentApproval = {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  status: "pending" | "approved" | "denied";
};

export type RuntimeSegmentAuth = {
  integrations: string[];
  connectedIntegrations: string[];
  reason?: string;
  status: "pending" | "connecting" | "completed" | "cancelled";
};

export type RuntimeActivitySegment = {
  id: string;
  items: RuntimeActivityItem[];
  approval?: RuntimeSegmentApproval;
  auth?: RuntimeSegmentAuth;
  isExpanded: boolean;
};

export type RuntimeToolUseData = {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  integration?: string;
  operation?: string;
  isWrite?: boolean;
};

export type RuntimeThinkingData = {
  content: string;
  thinkingId: string;
};

export type RuntimePendingApprovalData = {
  generationId: string;
  conversationId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
};

export type RuntimeAuthNeededData = {
  generationId: string;
  conversationId: string;
  integrations: string[];
  reason?: string;
};

export type RuntimeSandboxFileData = {
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type RuntimeDoneData = {
  generationId: string;
  conversationId: string;
  messageId: string;
};

export type RuntimeServerEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string; thinkingId: string }
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
  | { type: "auth_progress"; connected: string; remaining: string[] }
  | { type: "auth_result"; success: boolean }
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
    }
  | { type: "error"; message: string }
  | {
      type: "cancelled";
      generationId: string;
      conversationId: string;
      messageId?: string;
    };

export type RuntimeSnapshot = {
  parts: RuntimeMessagePart[];
  segments: RuntimeActivitySegment[];
  integrationsUsed: string[];
  sandboxFiles: RuntimeSandboxFileData[];
  traceStatus: TraceStatus;
};

export type RuntimeActivityStats = {
  totalToolCalls: number;
  completedToolCalls: number;
  totalToolDurationMs: number;
  maxToolDurationMs: number;
  perToolUseIdMs: Record<string, number>;
};

export type RuntimeAssistantMessage = {
  content: string;
  parts: RuntimeMessagePart[];
  integrationsUsed: string[];
  sandboxFiles?: RuntimeSandboxFileData[];
};

export class GenerationRuntime {
  private parts: RuntimeMessagePart[] = [];
  private segments: RuntimeActivitySegment[] = [];
  private integrationsUsed = new Set<string>();
  private sandboxFiles: RuntimeSandboxFileData[] = [];
  private traceStatus: TraceStatus = "streaming";
  private toolCallCounter = 0;
  private activityCounter = 0;
  private segmentCounter = 0;
  private activityStats: RuntimeActivityStats = {
    totalToolCalls: 0,
    completedToolCalls: 0,
    totalToolDurationMs: 0,
    maxToolDurationMs: 0,
    perToolUseIdMs: {},
  };

  private currentGenerationId?: string;
  private currentConversationId?: string;

  get snapshot(): RuntimeSnapshot {
    return {
      parts: this.parts.map((p) => ({ ...p })),
      segments: this.segments.map((seg, idx) => ({
        ...seg,
        items: seg.items.map((item) => ({ ...item })),
        approval: seg.approval ? { ...seg.approval } : undefined,
        auth: seg.auth
          ? {
              ...seg.auth,
              integrations: [...seg.auth.integrations],
              connectedIntegrations: [...seg.auth.connectedIntegrations],
            }
          : undefined,
        isExpanded: idx === this.segments.length - 1 ? seg.isExpanded : false,
      })),
      integrationsUsed: [...this.integrationsUsed],
      sandboxFiles: [...this.sandboxFiles],
      traceStatus: this.traceStatus,
    };
  }

  setStatus(status: TraceStatus): void {
    this.traceStatus = status;
  }

  getCurrentIds(): { generationId?: string; conversationId?: string } {
    return {
      generationId: this.currentGenerationId,
      conversationId: this.currentConversationId,
    };
  }

  getActivityStats(): RuntimeActivityStats {
    return {
      ...this.activityStats,
      perToolUseIdMs: { ...this.activityStats.perToolUseIdMs },
    };
  }

  handleText(text: string): void {
    const lastPart = this.parts[this.parts.length - 1];
    if (lastPart?.type === "text") {
      lastPart.content += text;
    } else {
      this.parts.push({ type: "text", content: text });
    }

    const currentSeg = this.getCurrentSegment();
    const lastItem = currentSeg.items[currentSeg.items.length - 1];
    if (lastItem?.type === "text") {
      lastItem.content += text;
    } else {
      currentSeg.items.push({
        id: `activity-${this.activityCounter++}`,
        timestamp: Date.now(),
        type: "text",
        content: text,
      });
    }
  }

  handleThinking(data: RuntimeThinkingData): void {
    this.parts.push({
      type: "thinking",
      id: data.thinkingId,
      content: data.content,
    });
    this.getCurrentSegment().items.push({
      id: `activity-${this.activityCounter++}`,
      timestamp: Date.now(),
      type: "thinking",
      content: data.content,
    });
  }

  handleToolUse(data: RuntimeToolUseData): void {
    const toolId = data.toolUseId || `tc-${this.toolCallCounter++}`;
    const now = Date.now();
    this.activityStats.totalToolCalls += 1;

    this.parts.push({
      type: "tool_call",
      id: toolId,
      name: data.toolName,
      input: data.toolInput,
      integration: data.integration,
      operation: data.operation,
      isWrite: data.isWrite,
    });

    if (data.integration) {
      this.integrationsUsed.add(data.integration);
    }

    this.getCurrentSegment().items.push({
      id: `activity-${this.activityCounter++}`,
      timestamp: now,
      type: "tool_call",
      content: data.toolName,
      toolUseId: toolId,
      toolName: data.toolName,
      integration: data.integration,
      operation: data.operation,
      status: "running",
      input: data.toolInput,
    });
  }

  handleToolResult(toolName: string, result: unknown, toolUseId?: string): void {
    if (toolUseId) {
      for (let i = this.parts.length - 1; i >= 0; i -= 1) {
        const part = this.parts[i];
        if (part.type === "tool_call" && part.id === toolUseId && part.result === undefined) {
          part.result = result;
          break;
        }
      }
    } else {
      for (let i = this.parts.length - 1; i >= 0; i -= 1) {
        const part = this.parts[i];
        if (part.type === "tool_call" && part.name === toolName && part.result === undefined) {
          part.result = result;
          break;
        }
      }
    }

    if (toolUseId) {
      for (let i = this.segments.length - 1; i >= 0; i -= 1) {
        const seg = this.segments[i];
        const toolItem = [...seg.items]
          .toReversed()
          .find(
            (item) =>
              item.type === "tool_call" &&
              item.toolUseId === toolUseId &&
              item.status === "running",
          );
        if (toolItem) {
          this.completeToolItem(toolItem, "complete", result);
          break;
        }
      }
    } else {
      for (let i = this.segments.length - 1; i >= 0; i -= 1) {
        const seg = this.segments[i];
        const toolItem = [...seg.items]
          .toReversed()
          .find(
            (item) =>
              item.type === "tool_call" && item.content === toolName && item.status === "running",
          );
        if (toolItem) {
          this.completeToolItem(toolItem, "complete", result);
          break;
        }
      }
    }
  }

  handlePendingApproval(data: RuntimePendingApprovalData): void {
    this.currentGenerationId = data.generationId;
    this.currentConversationId = data.conversationId;

    const currentSeg = this.getCurrentSegment();
    currentSeg.approval = {
      toolUseId: data.toolUseId,
      toolName: data.toolName,
      toolInput: data.toolInput,
      integration: data.integration,
      operation: data.operation,
      command: data.command,
      status: "pending",
    };

    currentSeg.isExpanded = false;
    this.segments.push({
      id: `seg-${this.segmentCounter++}`,
      items: [],
      isExpanded: true,
    });
    this.traceStatus = "waiting_approval";
  }

  setApprovalStatus(toolUseId: string, status: "approved" | "denied"): void {
    for (const seg of this.segments) {
      if (seg.approval?.toolUseId === toolUseId) {
        seg.approval.status = status;
        const toolItem = seg.items.find(
          (item) => item.type === "tool_call" && item.status === "running",
        );
        if (toolItem) {
          this.completeToolItem(toolItem, status === "approved" ? "complete" : "error");
        }
        break;
      }
    }
  }

  handleApprovalResult(toolUseId: string, decision: "approved" | "denied"): void {
    this.setApprovalStatus(toolUseId, decision);
    this.traceStatus = "streaming";
  }

  handleAuthNeeded(data: RuntimeAuthNeededData): void {
    this.currentGenerationId = data.generationId;
    this.currentConversationId = data.conversationId;

    const currentSeg = this.getCurrentSegment();
    currentSeg.auth = {
      integrations: data.integrations,
      connectedIntegrations: [],
      reason: data.reason,
      status: "pending",
    };

    currentSeg.isExpanded = false;
    this.segments.push({
      id: `seg-${this.segmentCounter++}`,
      items: [],
      isExpanded: true,
    });
    this.traceStatus = "waiting_auth";
  }

  setAuthConnecting(): void {
    for (const seg of this.segments) {
      if (seg.auth?.status === "pending") {
        seg.auth.status = "connecting";
        break;
      }
    }
  }

  setAuthPending(): void {
    for (const seg of this.segments) {
      if (seg.auth?.status === "connecting") {
        seg.auth.status = "pending";
        break;
      }
    }
  }

  setAuthCancelled(): void {
    for (const seg of this.segments) {
      if (seg.auth && (seg.auth.status === "pending" || seg.auth.status === "connecting")) {
        seg.auth.status = "cancelled";
        break;
      }
    }
  }

  handleAuthProgress(connected: string, remaining: string[]): void {
    for (const seg of this.segments) {
      if (seg.auth && (seg.auth.status === "pending" || seg.auth.status === "connecting")) {
        if (!seg.auth.connectedIntegrations.includes(connected)) {
          seg.auth.connectedIntegrations.push(connected);
        }
        if (remaining.length === 0) {
          seg.auth.status = "completed";
        }
        break;
      }
    }
  }

  handleAuthResult(success: boolean): void {
    for (const seg of this.segments) {
      if (seg.auth) {
        seg.auth.status = success ? "completed" : "cancelled";
        break;
      }
    }
    if (success) {
      this.traceStatus = "streaming";
    }
  }

  handleSandboxFile(file: RuntimeSandboxFileData): void {
    this.sandboxFiles.push(file);
  }

  handleDone(data: RuntimeDoneData): void {
    this.currentGenerationId = data.generationId;
    this.currentConversationId = data.conversationId;
    this.traceStatus = "complete";
  }

  handleError(): void {
    this.traceStatus = "error";
  }

  handleCancelled(data?: { generationId?: string; conversationId?: string }): void {
    if (data?.generationId) {
      this.currentGenerationId = data.generationId;
    }
    if (data?.conversationId) {
      this.currentConversationId = data.conversationId;
    }

    this.traceStatus = "complete";
    for (const segment of this.segments) {
      for (const item of segment.items) {
        if (item.status === "running") {
          this.completeToolItem(item, "interrupted");
        }
      }
    }

    const interruptionText = "Interrupted by user";
    const hasSystemPart = this.parts.some(
      (part): part is RuntimeMessagePart & { type: "system" } =>
        part.type === "system" && part.content === interruptionText,
    );
    if (!hasSystemPart) {
      this.parts.push({ type: "system", content: interruptionText });
    }

    const currentSegment = this.getCurrentSegment();
    const hasSystemItem = currentSegment.items.some(
      (item) => item.type === "system" && item.content === interruptionText,
    );
    if (!hasSystemItem) {
      currentSegment.items.push({
        id: `activity-${this.activityCounter++}`,
        timestamp: Date.now(),
        type: "system",
        content: interruptionText,
      });
    }
  }

  applyServerEvent(event: RuntimeServerEvent): void {
    switch (event.type) {
      case "text":
        this.handleText(event.content);
        return;
      case "thinking":
        this.handleThinking({
          content: event.content,
          thinkingId: event.thinkingId,
        });
        return;
      case "tool_use":
        this.handleToolUse({
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolUseId: event.toolUseId,
          integration: event.integration,
          operation: event.operation,
          isWrite: event.isWrite,
        });
        return;
      case "tool_result":
        this.handleToolResult(event.toolName, event.result, event.toolUseId);
        return;
      case "pending_approval":
        this.handlePendingApproval(event);
        return;
      case "approval_result":
        this.handleApprovalResult(event.toolUseId, event.decision);
        return;
      case "auth_needed":
        this.handleAuthNeeded(event);
        return;
      case "auth_progress":
        this.handleAuthProgress(event.connected, event.remaining);
        return;
      case "auth_result":
        this.handleAuthResult(event.success);
        return;
      case "sandbox_file":
        this.handleSandboxFile(event);
        return;
      case "done":
        this.handleDone(event);
        return;
      case "error":
        this.handleError();
        return;
      case "cancelled":
        this.handleCancelled(event);
        return;
      default:
        return;
    }
  }

  buildAssistantMessage(): RuntimeAssistantMessage {
    const content = this.parts
      .filter((p): p is RuntimeMessagePart & { type: "text" } => p.type === "text")
      .map((p) => p.content)
      .join("");

    const approvalMap = new Map<string, RuntimeMessagePart & { type: "approval" }>();
    for (const seg of this.segments) {
      if (!seg.approval || seg.approval.status === "pending") {
        continue;
      }
      approvalMap.set(seg.approval.toolUseId, {
        type: "approval",
        toolUseId: seg.approval.toolUseId,
        toolName: seg.approval.toolName,
        toolInput: seg.approval.toolInput,
        integration: seg.approval.integration,
        operation: seg.approval.operation,
        command: seg.approval.command,
        status: seg.approval.status,
      });
    }

    const partsWithApprovals: RuntimeMessagePart[] = [];
    for (const part of this.parts) {
      partsWithApprovals.push({ ...part });
      if (part.type === "tool_call") {
        const approval = approvalMap.get(part.id);
        if (approval) {
          partsWithApprovals.push(approval);
          // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
          approvalMap.delete(part.id);
        }
      }
    }

    // Keep unresolved approvals (if any) rather than dropping data.
    for (const approval of approvalMap.values()) {
      partsWithApprovals.push(approval);
    }

    return {
      content,
      parts: partsWithApprovals.length > 0 ? partsWithApprovals : this.parts.map((p) => ({ ...p })),
      integrationsUsed: [...this.integrationsUsed],
      sandboxFiles: this.sandboxFiles.length > 0 ? [...this.sandboxFiles] : undefined,
    };
  }

  reset(): void {
    this.parts = [];
    this.segments = [];
    this.integrationsUsed.clear();
    this.sandboxFiles = [];
    this.traceStatus = "streaming";
    this.toolCallCounter = 0;
    this.activityCounter = 0;
    this.segmentCounter = 0;
    this.activityStats = {
      totalToolCalls: 0,
      completedToolCalls: 0,
      totalToolDurationMs: 0,
      maxToolDurationMs: 0,
      perToolUseIdMs: {},
    };
    this.currentGenerationId = undefined;
    this.currentConversationId = undefined;
  }

  private completeToolItem(
    item: RuntimeActivityItem,
    status: NonNullable<RuntimeActivityItem["status"]>,
    result?: unknown,
  ): void {
    item.status = status;
    if (result !== undefined) {
      item.result = result;
    }
    if (item.elapsedMs !== undefined) {
      return;
    }
    const elapsedMs = Math.max(0, Date.now() - item.timestamp);
    item.elapsedMs = elapsedMs;
    this.activityStats.completedToolCalls += 1;
    this.activityStats.totalToolDurationMs += elapsedMs;
    this.activityStats.maxToolDurationMs = Math.max(
      this.activityStats.maxToolDurationMs,
      elapsedMs,
    );
    if (item.toolUseId) {
      this.activityStats.perToolUseIdMs[item.toolUseId] = elapsedMs;
    }
  }

  private getCurrentSegment(): RuntimeActivitySegment {
    const existing = this.segments[this.segments.length - 1];
    if (existing) {
      return existing;
    }
    const segment: RuntimeActivitySegment = {
      id: `seg-${this.segmentCounter++}`,
      items: [],
      isExpanded: true,
    };
    this.segments.push(segment);
    return segment;
  }
}

export function createGenerationRuntime(): GenerationRuntime {
  return new GenerationRuntime();
}

import { describe, expect, test } from "bun:test";
import { createGenerationRuntime } from "@/lib/generation-runtime";

describe("GenerationRuntime", () => {
  test("coalesces adjacent text chunks", () => {
    const runtime = createGenerationRuntime();

    runtime.handleText("hello");
    runtime.handleText(" world");

    const snapshot = runtime.snapshot;
    expect(snapshot.parts).toHaveLength(1);
    expect(snapshot.parts[0]).toEqual({ type: "text", content: "hello world" });
  });

  test("links tool_result to the latest running tool_call", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "echo hi" },
      toolUseId: "tool-1",
      integration: "slack",
      operation: "channels",
    });
    runtime.handleToolResult("bash", { ok: true });

    const snapshot = runtime.snapshot;
    const part = snapshot.parts[0];
    if (part?.type !== "tool_call") {
      throw new Error("expected first part to be a tool call");
    }

    expect(part.id).toBe("tool-1");
    expect(part.result).toEqual({ ok: true });
    expect(snapshot.integrationsUsed).toEqual(["slack"]);

    const toolItem = snapshot.segments[0]?.items[0];
    expect(toolItem?.status).toBe("complete");
    expect(toolItem?.result).toEqual({ ok: true });
  });

  test("handles approval flow and adds approval part to assistant message", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "slack send -c general -t hi" },
      toolUseId: "tool-approval",
      integration: "slack",
      operation: "send",
      isWrite: true,
    });

    runtime.handlePendingApproval({
      generationId: "gen-1",
      conversationId: "conv-1",
      toolUseId: "tool-approval",
      toolName: "bash",
      toolInput: { command: "slack send -c general -t hi" },
      integration: "slack",
      operation: "send",
      command: "slack send -c general -t hi",
    });

    expect(runtime.snapshot.traceStatus).toBe("waiting_approval");

    runtime.handleApprovalResult("tool-approval", "approved");

    expect(runtime.snapshot.traceStatus).toBe("streaming");
    const message = runtime.buildAssistantMessage();
    const approvalPart = message.parts.find((part) => part.type === "approval");

    expect(approvalPart).toBeDefined();
    if (approvalPart?.type === "approval") {
      expect(approvalPart.status).toBe("approved");
      expect(approvalPart.toolUseId).toBe("tool-approval");
    }
  });

  test("handles auth flow transitions", () => {
    const runtime = createGenerationRuntime();

    runtime.handleAuthNeeded({
      generationId: "gen-auth",
      conversationId: "conv-auth",
      integrations: ["github", "slack"],
      reason: "GitHub authentication required",
    });

    expect(runtime.snapshot.traceStatus).toBe("waiting_auth");

    runtime.setAuthConnecting();
    runtime.handleAuthProgress("github", ["slack"]);
    runtime.handleAuthProgress("slack", []);
    runtime.handleAuthResult(true);

    const snapshot = runtime.snapshot;
    expect(snapshot.traceStatus).toBe("streaming");
    expect(snapshot.segments[0]?.auth?.connectedIntegrations).toEqual(["github", "slack"]);
    expect(snapshot.segments[0]?.auth?.status).toBe("completed");
  });

  test("marks running activities interrupted on cancellation and appends system message once", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "sleep 5" },
      toolUseId: "tool-cancel",
    });

    runtime.handleCancelled({ generationId: "gen-cancel", conversationId: "conv-cancel" });
    runtime.handleCancelled({ generationId: "gen-cancel", conversationId: "conv-cancel" });

    const snapshot = runtime.snapshot;
    expect(snapshot.traceStatus).toBe("complete");
    expect(snapshot.segments[0]?.items[0]?.status).toBe("interrupted");

    const interruptionParts = snapshot.parts.filter(
      (part) => part.type === "system" && part.content === "Interrupted by user"
    );
    expect(interruptionParts).toHaveLength(1);
  });
});

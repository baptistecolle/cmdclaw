import { describe, expect, it } from "vitest";
import { createGenerationRuntime } from "./generation-runtime";

describe("GenerationRuntime tool result matching", () => {
  it("matches tool results by toolUseId when repeated tool names exist", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "echo first" },
      toolUseId: "tool-1",
    });
    runtime.handleToolUse({
      toolName: "bash",
      toolInput: { command: "echo second" },
      toolUseId: "tool-2",
    });

    runtime.handleToolResult("bash", "second result", "tool-2");

    const snapshot = runtime.snapshot;
    const toolCalls = snapshot.parts.filter((part) => part.type === "tool_call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({ id: "tool-1" });
    expect(toolCalls[0]).not.toHaveProperty("result");
    expect(toolCalls[1]).toMatchObject({ id: "tool-2", result: "second result" });

    const allItems = snapshot.segments.flatMap((segment) => segment.items);
    const firstTool = allItems.find((item) => item.type === "tool_call" && item.toolUseId === "tool-1");
    const secondTool = allItems.find((item) => item.type === "tool_call" && item.toolUseId === "tool-2");
    expect(firstTool).toMatchObject({ status: "running" });
    expect(secondTool).toMatchObject({ status: "complete", result: "second result" });
  });

  it("falls back to tool name matching when toolUseId is missing", () => {
    const runtime = createGenerationRuntime();

    runtime.handleToolUse({
      toolName: "search",
      toolInput: { query: "alpha" },
      toolUseId: "tool-search-1",
    });
    runtime.handleToolResult("search", { ok: true });

    const snapshot = runtime.snapshot;
    const toolCall = snapshot.parts.find(
      (part): part is Extract<(typeof snapshot.parts)[number], { type: "tool_call" }> =>
        part.type === "tool_call",
    );
    expect(toolCall).toMatchObject({ id: "tool-search-1", result: { ok: true } });
  });
});

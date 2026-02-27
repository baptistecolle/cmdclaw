import { describe, expect, it } from "vitest";
import type { Message } from "./message-list";
import { formatChatTranscript, formatPersistedChatTranscript } from "./chat-transcript";

describe("formatChatTranscript", () => {
  it("formats messages, attachments, and sandbox files", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "user",
        content: "Please generate a report",
        attachments: [{ name: "input.csv", mimeType: "text/csv", dataUrl: "" }],
      },
      {
        id: "m2",
        role: "assistant",
        content: "",
        parts: [
          { type: "text", content: "Running report generation." },
          {
            type: "tool_call",
            id: "tool-1",
            name: "generate_report",
            input: { range: "last_30_days" },
            result: { status: "ok" },
            integration: "notion",
            operation: "create_page",
          },
        ],
        sandboxFiles: [
          {
            fileId: "file-1",
            path: "/app/report.pdf",
            filename: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 128,
          },
        ],
      },
    ];

    const transcript = formatChatTranscript(messages);

    expect(transcript).toContain("## 1. User");
    expect(transcript).toContain("Please generate a report");
    expect(transcript).toContain("attachments:");
    expect(transcript).toContain("- input.csv (text/csv)");
    expect(transcript).toContain("## 2. Assistant");
    expect(transcript).toContain("Running report generation.");
    expect(transcript).toContain("[tool_call] generate_report");
    expect(transcript).toContain('result: {\n  "status": "ok"\n}');
    expect(transcript).toContain("sandbox files:");
    expect(transcript).toContain("- /app/report.pdf");
  });

  it("includes streaming assistant parts", () => {
    const transcript = formatChatTranscript(
      [
        {
          id: "m1",
          role: "user",
          content: "hello",
        },
      ],
      [{ type: "text", content: "Working on it..." }],
    );

    expect(transcript).toContain("## Assistant (streaming)");
    expect(transcript).toContain("Working on it...");
  });

  it("includes performance metrics only when enabled", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        content: "done",
        timing: {
          generationDurationMs: 1250,
          phaseDurationsMs: {
            waitForFirstEventMs: 320,
          },
        },
      },
    ];

    const withoutMetrics = formatChatTranscript(messages);
    expect(withoutMetrics).not.toContain("performance metrics:");

    const withMetrics = formatChatTranscript(messages, [], { includeTimingMetrics: true });
    expect(withMetrics).toContain("performance metrics:");
    expect(withMetrics).toContain("- Generation: 1.3s");
    expect(withMetrics).toContain("- First event wait: 320ms");
  });

  it("formats persisted conversation messages", () => {
    const transcript = formatPersistedChatTranscript([
      {
        id: "m1",
        role: "user",
        content: "Summarize this",
      },
      {
        id: "m2",
        role: "assistant",
        content: "",
        contentParts: [
          { type: "text", text: "Done." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "web.search",
            input: { q: "foo" },
          },
          { type: "tool_result", tool_use_id: "tool-1", content: { ok: true } },
          {
            type: "approval",
            tool_use_id: "tool-1",
            tool_name: "question",
            tool_input: { questions: [{ header: "Focus", question: "Pick one", options: [] }] },
            integration: "question",
            operation: "question",
            status: "approved",
            question_answers: [["Coding"]],
          },
        ],
      },
    ]);

    expect(transcript).toContain("## 1. User");
    expect(transcript).toContain("## 2. Assistant");
    expect(transcript).toContain("Done.");
    expect(transcript).toContain("[tool_call] web.search");
    expect(transcript).toContain('result: {\n  "ok": true\n}');
    expect(transcript).toContain("[approval:approved] question");
    expect(transcript).toContain('answers: [\n  [\n    "Coding"\n  ]\n]');
  });

  it("includes persisted performance metrics when enabled", () => {
    const transcript = formatPersistedChatTranscript(
      [
        {
          id: "m1",
          role: "assistant",
          content: "Ready",
          timing: {
            sandboxStartupDurationMs: 800,
          },
        },
      ],
      { includeTimingMetrics: true },
    );

    expect(transcript).toContain("performance metrics:");
    expect(transcript).toContain("- Sandbox connect/create: 800ms");
  });
});

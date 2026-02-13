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
        ],
      },
    ]);

    expect(transcript).toContain("## 1. User");
    expect(transcript).toContain("## 2. Assistant");
    expect(transcript).toContain("Done.");
    expect(transcript).toContain("[tool_call] web.search");
    expect(transcript).toContain('result: {\n  "ok": true\n}');
  });
});

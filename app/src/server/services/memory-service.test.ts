import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  memoryFileFindFirstMock,
  memoryEntryFindManyMock,
  conversationFindFirstMock,
  messageFindManyMock,
  memorySettingsFindFirstMock,
  providerAuthFindFirstMock,
  sessionTranscriptFindManyMock,
  dbExecuteMock,
  dbInsertMock,
  dbMock,
  generateConversationTitleMock,
} = vi.hoisted(() => {
  const memoryFileFindFirstMock = vi.fn();
  const memoryEntryFindManyMock = vi.fn();
  const conversationFindFirstMock = vi.fn();
  const messageFindManyMock = vi.fn();
  const memorySettingsFindFirstMock = vi.fn();
  const providerAuthFindFirstMock = vi.fn();
  const sessionTranscriptFindManyMock = vi.fn();

  const dbExecuteMock = vi.fn();
  const dbInsertMock = vi.fn();

  const dbMock = {
    query: {
      memoryFile: {
        findFirst: memoryFileFindFirstMock,
        findMany: vi.fn(),
      },
      memoryEntry: {
        findMany: memoryEntryFindManyMock,
      },
      conversation: {
        findFirst: conversationFindFirstMock,
      },
      message: {
        findMany: messageFindManyMock,
      },
      memorySettings: {
        findFirst: memorySettingsFindFirstMock,
      },
      providerAuth: {
        findFirst: providerAuthFindFirstMock,
      },
      sessionTranscript: {
        findFirst: vi.fn(),
        findMany: sessionTranscriptFindManyMock,
      },
    },
    execute: dbExecuteMock,
    insert: dbInsertMock,
  };

  const generateConversationTitleMock = vi.fn();

  return {
    memoryFileFindFirstMock,
    memoryEntryFindManyMock,
    conversationFindFirstMock,
    messageFindManyMock,
    memorySettingsFindFirstMock,
    providerAuthFindFirstMock,
    sessionTranscriptFindManyMock,
    dbExecuteMock,
    dbInsertMock,
    dbMock,
    generateConversationTitleMock,
  };
});

vi.mock("@/env", () => ({
  env: {
    OPENAI_API_KEY: "test-openai-key",
  },
}));

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/utils/encryption", () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("@/server/utils/generate-title", () => ({
  generateConversationTitle: generateConversationTitleMock,
}));

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      embeddings = {
        create: vi.fn(async ({ input }: { input: string[] }) => ({
          data: input.map((_item, index) => ({
            embedding: [0.1 + index * 0.01, 0.2 + index * 0.01],
          })),
        })),
      };
    },
  };
});

import {
  chunkMarkdown,
  readMemoryFile,
  searchMemoryWithSessions,
  writeSessionTranscriptFromConversation,
} from "./memory-service";

describe("chunkMarkdown", () => {
  it("keeps chunk boundaries and overlap", () => {
    const content = [
      "line-1",
      "line-2",
      "line-3",
      "line-4",
      "line-5",
    ].join("\n");

    const chunks = chunkMarkdown(content, { tokens: 3, overlap: 1 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBeGreaterThanOrEqual(1);

    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1]!;
      const current = chunks[i]!;
      expect(current.startLine).toBeLessThanOrEqual(prev.endLine);
    }
  });
});

describe("readMemoryFile path resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves MEMORY.md as long-term memory", async () => {
    memoryFileFindFirstMock.mockResolvedValue({
      id: "file-longterm",
      type: "longterm",
      date: null,
    });
    memoryEntryFindManyMock.mockResolvedValue([
      {
        id: "entry-1",
        title: "Preferences",
        tags: ["user"],
        content: "Use concise responses.",
        createdAt: new Date("2026-02-12T08:00:00.000Z"),
      },
    ]);

    const file = await readMemoryFile({ userId: "user-1", path: "MEMORY.md" });

    expect(file?.path).toBe("MEMORY.md");
    expect(file?.text).toContain("# Long-term Memory");
    expect(file?.text).toContain("Use concise responses.");
  });

  it("returns null for invalid paths", async () => {
    const file = await readMemoryFile({ userId: "user-1", path: "notes/random.md" });

    expect(file).toBeNull();
    expect(memoryFileFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("writeSessionTranscriptFromConversation", () => {
  let insertValuesFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    memorySettingsFindFirstMock.mockResolvedValue({
      provider: "none",
      model: "n/a",
      dimensions: 0,
      chunkTokens: 100,
      chunkOverlap: 20,
    });

    generateConversationTitleMock.mockResolvedValue("Session Summary");

    insertValuesFn = vi.fn((values: any) => {
      if (Array.isArray(values)) {
        return Promise.resolve(undefined);
      }
      return {
        returning: vi.fn().mockResolvedValue([
          {
            id: "transcript-1",
            ...values,
          },
        ]),
      };
    });

    dbInsertMock.mockImplementation(() => ({ values: insertValuesFn }));
  });

  it("excludes filtered user messages and non-user/assistant roles", async () => {
    conversationFindFirstMock.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      opencodeSessionId: "session-1",
    });

    messageFindManyMock.mockResolvedValue([
      {
        id: "msg-system-boundary",
        conversationId: "conv-1",
        role: "system",
        content: "--- SESSION BOUNDARY ---\n2026-02-12T10:00:00.000Z",
        contentParts: null,
        createdAt: new Date("2026-02-12T10:00:00.000Z"),
      },
      {
        id: "msg-user-exclude",
        conversationId: "conv-1",
        role: "user",
        content: "ignore me",
        contentParts: null,
        createdAt: new Date("2026-02-12T10:01:00.000Z"),
      },
      {
        id: "msg-user-keep",
        conversationId: "conv-1",
        role: "user",
        content: "keep me",
        contentParts: null,
        createdAt: new Date("2026-02-12T10:02:00.000Z"),
      },
      {
        id: "msg-tool",
        conversationId: "conv-1",
        role: "tool",
        content: "tool output",
        contentParts: null,
        createdAt: new Date("2026-02-12T10:03:00.000Z"),
      },
      {
        id: "msg-assistant",
        conversationId: "conv-1",
        role: "assistant",
        content: "assistant reply",
        contentParts: [{ type: "text", text: "assistant reply" }],
        createdAt: new Date("2026-02-12T10:04:00.000Z"),
      },
    ]);

    const transcript = await writeSessionTranscriptFromConversation({
      userId: "user-1",
      conversationId: "conv-1",
      excludeUserMessages: ["ignore me"],
    });

    expect(transcript).not.toBeNull();

    const insertedValues = insertValuesFn.mock.calls[0]?.[0];
    expect(insertedValues.content).toContain("keep me");
    expect(insertedValues.content).toContain("assistant reply");
    expect(insertedValues.content).not.toContain("ignore me");
    expect(insertedValues.content).not.toContain("tool output");
  });
});

describe("searchMemoryWithSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    memorySettingsFindFirstMock.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 2,
      chunkTokens: 100,
      chunkOverlap: 20,
    });

    providerAuthFindFirstMock.mockResolvedValue(null);

    dbExecuteMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "mem-chunk-1",
            fileId: "mem-file-1",
            entryId: "mem-entry-1",
            content: "memory result",
            distance: 0.1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "session-chunk-1",
            transcriptId: "session-1",
            content: "session result",
            distance: 0.05,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    dbMock.query.memoryFile.findMany = vi.fn().mockResolvedValue([
      {
        id: "mem-file-1",
        type: "daily",
        date: new Date("2026-02-12T00:00:00.000Z"),
      },
    ]);

    memoryEntryFindManyMock.mockResolvedValue([
      {
        id: "mem-entry-1",
        title: "Memory Entry",
      },
    ]);

    sessionTranscriptFindManyMock.mockResolvedValue([
      {
        id: "session-1",
        title: "Session Entry",
        path: "sessions/2026-02-12-100000-session.md",
      },
    ]);
  });

  it("merges memory and session search results and enforces limit", async () => {
    const results = await searchMemoryWithSessions({
      userId: "user-1",
      query: "result",
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe("session");
    expect(results[0]?.path).toBe("sessions/2026-02-12-100000-session.md");
  });
});

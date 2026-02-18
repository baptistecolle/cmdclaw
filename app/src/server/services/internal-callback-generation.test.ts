import { beforeEach, describe, expect, it, vi } from "vitest";

const { generationFindFirstMock, conversationFindFirstMock, dbMock } = vi.hoisted(() => {
  const generationFindFirstMock = vi.fn();
  const conversationFindFirstMock = vi.fn();

  const dbMock = {
    query: {
      generation: { findFirst: generationFindFirstMock },
      conversation: { findFirst: conversationFindFirstMock },
    },
  };

  return {
    generationFindFirstMock,
    conversationFindFirstMock,
    dbMock,
  };
});

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

import { resolveGenerationIdForInternalCallback } from "@/server/services/internal-callback-generation";

describe("resolveGenerationIdForInternalCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationFindFirstMock.mockResolvedValue(null);
    conversationFindFirstMock.mockResolvedValue(null);
  });

  it("prioritizes generationId when valid", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      sandboxId: "sb-1",
    });

    const resolved = await resolveGenerationIdForInternalCallback({
      conversationId: "conv-1",
      generationId: "gen-1",
      sandboxId: "sb-1",
    });

    expect(resolved).toBe("gen-1");
    expect(generationFindFirstMock).toHaveBeenCalledTimes(1);
    expect(conversationFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects generationId when sandboxId mismatches", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-1",
      sandboxId: "sb-actual",
    });

    const resolved = await resolveGenerationIdForInternalCallback({
      conversationId: "conv-1",
      generationId: "gen-1",
      sandboxId: "sb-other",
    });

    expect(resolved).toBeUndefined();
    expect(generationFindFirstMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to sandboxId when generationId is missing", async () => {
    generationFindFirstMock.mockResolvedValueOnce({
      id: "gen-by-sandbox",
    });

    const resolved = await resolveGenerationIdForInternalCallback({
      conversationId: "conv-1",
      sandboxId: "sb-1",
    });

    expect(resolved).toBe("gen-by-sandbox");
    expect(generationFindFirstMock).toHaveBeenCalledTimes(1);
    expect(conversationFindFirstMock).not.toHaveBeenCalled();
  });

  it("falls back to currentGenerationId pointer when sandbox lookup misses", async () => {
    generationFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "gen-current",
    });
    conversationFindFirstMock.mockResolvedValueOnce({
      currentGenerationId: "gen-current",
    });

    const resolved = await resolveGenerationIdForInternalCallback({
      conversationId: "conv-1",
      sandboxId: "sb-missing",
    });

    expect(resolved).toBe("gen-current");
    expect(generationFindFirstMock).toHaveBeenCalledTimes(2);
    expect(conversationFindFirstMock).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when every lookup path misses", async () => {
    generationFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    conversationFindFirstMock.mockResolvedValueOnce({
      currentGenerationId: "gen-terminal-or-missing",
    });

    const resolved = await resolveGenerationIdForInternalCallback({
      conversationId: "conv-1",
      sandboxId: "sb-missing",
    });

    expect(resolved).toBeUndefined();
    expect(generationFindFirstMock).toHaveBeenCalledTimes(2);
    expect(conversationFindFirstMock).toHaveBeenCalledTimes(1);
  });
});

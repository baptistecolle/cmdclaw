// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { NEW_CHAT_DRAFT_KEY, getChatDraftKey, useChatDraftStore } from "./chat-draft-store";

describe("chat-draft-store", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    useChatDraftStore.setState({ drafts: {} });
  });

  it("uses one key for new chat drafts", () => {
    expect(getChatDraftKey(undefined)).toBe(NEW_CHAT_DRAFT_KEY);
    expect(getChatDraftKey("")).toBe(NEW_CHAT_DRAFT_KEY);
  });

  it("stores and reads text", () => {
    const store = useChatDraftStore.getState();

    store.upsertDraft("conv-1", "hello");

    const draft = useChatDraftStore.getState().readDraft("conv-1");
    expect(draft?.text).toBe("hello");
  });

  it("clears draft when content becomes empty", () => {
    const store = useChatDraftStore.getState();

    store.upsertDraft("conv-1", "hello");
    expect(useChatDraftStore.getState().readDraft("conv-1")).toBeTruthy();

    store.upsertDraft("conv-1", "   ");
    expect(useChatDraftStore.getState().readDraft("conv-1")).toBeUndefined();
  });

  it("removes a draft by key", () => {
    const store = useChatDraftStore.getState();

    store.upsertDraft("conv-1", "hello");
    store.clearDraft("conv-1");

    expect(useChatDraftStore.getState().readDraft("conv-1")).toBeUndefined();
  });
});

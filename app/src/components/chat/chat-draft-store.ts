"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "chat-drafts-v1";
export const NEW_CHAT_DRAFT_KEY = "__new_chat__";

export type ChatDraft = {
  text: string;
  updatedAt: number;
};

type ChatDraftState = {
  drafts: Record<string, ChatDraft>;
  hasHydrated: boolean;
  upsertDraft: (key: string, text: string) => void;
  clearDraft: (key: string) => void;
  readDraft: (key: string) => ChatDraft | undefined;
  setHasHydrated: (hydrated: boolean) => void;
};

function isEmptyDraft(text: string): boolean {
  return text.trim().length === 0;
}

export const getChatDraftKey = (conversationId?: string): string =>
  conversationId && conversationId.length > 0 ? conversationId : NEW_CHAT_DRAFT_KEY;

export const useChatDraftStore = create<ChatDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      hasHydrated: false,
      upsertDraft: (key, text) => {
        if (isEmptyDraft(text)) {
          set((state) => {
            if (!(key in state.drafts)) {
              return state;
            }
            const { [key]: _removed, ...remaining } = state.drafts;
            return { drafts: remaining };
          });
          return;
        }

        const nextDraft: ChatDraft = {
          text,
          updatedAt: Date.now(),
        };

        set((state) => ({
          drafts: {
            ...state.drafts,
            [key]: nextDraft,
          },
        }));
      },
      clearDraft: (key) => {
        set((state) => {
          if (!(key in state.drafts)) {
            return state;
          }
          const { [key]: _removed, ...remaining } = state.drafts;
          return { drafts: remaining };
        });
      },
      readDraft: (key) => get().drafts[key],
      setHasHydrated: (hydrated) => {
        set({ hasHydrated: hydrated });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ drafts: state.drafts }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Failed to restore chat drafts:", error);
          state?.setHasHydrated(true);
          return;
        }

        if (!state) {
          return;
        }

        const sanitizedDrafts: Record<string, ChatDraft> = {};
        for (const [key, draft] of Object.entries(state.drafts ?? {})) {
          if (!draft) {
            continue;
          }
          const text = typeof draft.text === "string" ? draft.text : "";
          if (isEmptyDraft(text)) {
            continue;
          }

          sanitizedDrafts[key] = {
            text,
            updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : Date.now(),
          };
        }

        if (Object.keys(sanitizedDrafts).length !== Object.keys(state.drafts ?? {}).length) {
          state.drafts = sanitizedDrafts;
        }
        state.setHasHydrated(true);
      },
    },
  ),
);

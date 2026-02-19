"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PREFERRED_ZEN_FREE_MODEL } from "@/lib/zen-models";

const STORAGE_KEY = "chat-selected-model-v1";

type ChatModelState = {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
};

export const useChatModelStore = create<ChatModelState>()(
  persist(
    (set) => ({
      selectedModel: PREFERRED_ZEN_FREE_MODEL,
      setSelectedModel: (model) => {
        const trimmed = model.trim();
        if (!trimmed) {
          return;
        }
        set({ selectedModel: trimmed });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedModel: state.selectedModel }),
    },
  ),
);

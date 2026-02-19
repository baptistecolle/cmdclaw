"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "chat-advanced-settings-v1";

type ChatAdvancedSettingsState = {
  displayAdvancedMetrics: boolean;
  setDisplayAdvancedMetrics: (enabled: boolean) => void;
};

export const useChatAdvancedSettingsStore = create<ChatAdvancedSettingsState>()(
  persist(
    (set) => ({
      displayAdvancedMetrics: false,
      setDisplayAdvancedMetrics: (enabled) => {
        set({ displayAdvancedMetrics: enabled });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ displayAdvancedMetrics: state.displayAdvancedMetrics }),
    },
  ),
);

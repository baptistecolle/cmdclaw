"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const STORAGE_KEY = "chat-platform-skill-v1";
const EMPTY_SELECTED_SKILLS: string[] = [];

type ChatSkillState = {
  selectedSkillSlugsByScope: Record<string, string[]>;
  getSelectedSkillSlugs: (scopeKey: string) => string[];
  setSelectedSkillSlugs: (scopeKey: string, slugs: string[]) => void;
  toggleSelectedSkillSlug: (scopeKey: string, slug: string) => void;
  clearSelectedSkillSlugs: (scopeKey: string) => void;
};

export const useChatSkillStore = create<ChatSkillState>()(
  persist(
    (set, get) => ({
      selectedSkillSlugsByScope: {},
      getSelectedSkillSlugs: (scopeKey) =>
        get().selectedSkillSlugsByScope[scopeKey] ?? EMPTY_SELECTED_SKILLS,
      setSelectedSkillSlugs: (scopeKey, slugs) => {
        const normalized = Array.from(
          new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => slug.length > 0)),
        );
        set((state) => ({
          selectedSkillSlugsByScope: {
            ...state.selectedSkillSlugsByScope,
            [scopeKey]: normalized,
          },
        }));
      },
      toggleSelectedSkillSlug: (scopeKey, slug) => {
        const normalized = slug.trim().toLowerCase();
        if (!normalized) {
          return;
        }
        set((state) => ({
          selectedSkillSlugsByScope: {
            ...state.selectedSkillSlugsByScope,
            [scopeKey]: (state.selectedSkillSlugsByScope[scopeKey] ?? []).includes(normalized)
              ? (state.selectedSkillSlugsByScope[scopeKey] ?? []).filter(
                  (entry) => entry !== normalized,
                )
              : [...(state.selectedSkillSlugsByScope[scopeKey] ?? []), normalized],
          },
        }));
      },
      clearSelectedSkillSlugs: (scopeKey) =>
        set((state) => ({
          selectedSkillSlugsByScope: {
            ...state.selectedSkillSlugsByScope,
            [scopeKey]: [],
          },
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedSkillSlugsByScope: state.selectedSkillSlugsByScope }),
    },
  ),
);

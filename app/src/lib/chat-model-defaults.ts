import {
  DEFAULT_OPENCODE_FREE_MODEL,
  OPENCODE_FREE_MODEL_PREFERENCE_ORDER,
} from "@/config/opencode-free-model-preferences";

export const DEFAULT_CONNECTED_CHATGPT_MODEL = "openai/gpt-5.2-codex";
export const LEGACY_DEFAULT_CHAT_MODEL = "opencode/glm-5-free";

function normalizeModelIDs(modelIDs: readonly string[]): string[] {
  return modelIDs.map((id) => id.trim()).filter((id) => id.length > 0);
}

function resolvePreferredOpencodeFreeModel(
  availableModelIDs: readonly string[],
): string | undefined {
  const normalized = normalizeModelIDs(availableModelIDs);
  if (normalized.length === 0) {
    return undefined;
  }

  const available = new Set(normalized);
  for (const preferredID of OPENCODE_FREE_MODEL_PREFERENCE_ORDER) {
    if (available.has(preferredID)) {
      return preferredID;
    }
  }

  return normalized[0];
}

export function resolveDefaultChatModel(params: {
  overrideModel?: string | null;
  isOpenAIConnected: boolean;
  availableOpencodeFreeModelIDs?: readonly string[];
}): string {
  const configured = params.overrideModel?.trim();
  if (configured) {
    return configured;
  }

  if (params.isOpenAIConnected) {
    return DEFAULT_CONNECTED_CHATGPT_MODEL;
  }

  return (
    resolvePreferredOpencodeFreeModel(params.availableOpencodeFreeModelIDs ?? []) ??
    DEFAULT_OPENCODE_FREE_MODEL
  );
}

export function shouldMigrateLegacyDefaultModel(params: {
  currentModel?: string | null;
  isOpenAIConnected: boolean;
}): boolean {
  return params.isOpenAIConnected && params.currentModel?.trim() === LEGACY_DEFAULT_CHAT_MODEL;
}

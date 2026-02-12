import type { ProviderListResponses } from "@opencode-ai/sdk/v2/client";

type ProviderListResponse = ProviderListResponses[200];
type ProviderModel = ProviderListResponse["all"][number]["models"][string];
type ModelsDevProvider = { models?: Record<string, ProviderModel> };
type ModelsDevPayload = Record<string, ModelsDevProvider>;

export type ZenModelOption = Pick<ProviderModel, "id" | "name">;

const MODELS_DEV_URL = "https://models.dev/api.json";
export const PREFERRED_ZEN_FREE_MODEL = "kimi-k2.5-free";

function isFreeModel(model: ProviderModel): boolean {
  if (!model.cost) return false;
  return model.cost.input === 0 && model.cost.output === 0;
}

export async function fetchOpencodeFreeModels(): Promise<ZenModelOption[]> {
  const response = await fetch(MODELS_DEV_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenCode models: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ModelsDevPayload;
  const models = Object.values(payload.opencode?.models ?? {});

  return models
    .filter(isFreeModel)
    .map((model) => ({
      id: model.id,
      name: model.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a sensible default free OpenCode model.
 * Priority:
 * 1) explicit override value
 * 2) preferred free model when available
 * 3) first available free model
 * 4) preferred fallback when fetch fails or returns empty
 */
export async function resolveDefaultOpencodeFreeModel(
  overrideModel?: string | null,
): Promise<string> {
  const configured = overrideModel?.trim();
  if (configured) {
    return configured;
  }

  try {
    const freeModels = await fetchOpencodeFreeModels();
    const ids = freeModels.map((model) => model.id);

    if (ids.includes(PREFERRED_ZEN_FREE_MODEL)) {
      return PREFERRED_ZEN_FREE_MODEL;
    }

    return ids[0] ?? PREFERRED_ZEN_FREE_MODEL;
  } catch {
    return PREFERRED_ZEN_FREE_MODEL;
  }
}

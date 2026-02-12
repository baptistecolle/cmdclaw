import { fetchOpencodeFreeModels, type ZenModelOption } from "@/lib/zen-models";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { models: ZenModelOption[]; expiresAt: number } | undefined;

export async function listOpencodeFreeModels(): Promise<ZenModelOption[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.models;
  }

  try {
    const models = await fetchOpencodeFreeModels();
    cache = {
      models,
      expiresAt: now + CACHE_TTL_MS,
    };
    return models;
  } catch (error) {
    console.error("[OpenCode Models] Failed to refresh free models", error);
    return cache?.models ?? [];
  }
}

export async function isOpencodeFreeModel(modelID: string): Promise<boolean> {
  const models = await listOpencodeFreeModels();
  return models.some((model) => model.id === modelID) || modelID.endsWith("-free");
}

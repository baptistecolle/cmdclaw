import type { ProviderListResponses } from "@opencode-ai/sdk/v2/client";
import {
  DEFAULT_OPENCODE_FREE_MODEL,
  OPENCODE_FREE_MODEL_PREFERENCE_ORDER,
} from "@/config/opencode-free-model-preferences";

type ProviderListResponse = ProviderListResponses[200];
type ProviderModel = ProviderListResponse["all"][number]["models"][string];
type ModelsDevProvider = { models?: Record<string, ProviderModel> };
type ModelsDevPayload = Record<string, ModelsDevProvider>;

export type ZenModelOption = Pick<ProviderModel, "id" | "name">;

const MODELS_DEV_URL = "https://models.dev/api.json";
export const PREFERRED_OPENCODE_FREE_MODEL_IDS = OPENCODE_FREE_MODEL_PREFERENCE_ORDER;
export const PREFERRED_ZEN_FREE_MODEL = DEFAULT_OPENCODE_FREE_MODEL;

function isFreeModel(model: ProviderModel): boolean {
  if (!model.cost) {
    return false;
  }
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
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

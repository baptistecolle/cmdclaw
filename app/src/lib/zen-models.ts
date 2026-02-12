import type { ProviderListResponses } from "@opencode-ai/sdk/v2/client";

type ProviderListResponse = ProviderListResponses[200];
type ProviderModel = ProviderListResponse["all"][number]["models"][string];
type ModelsDevProvider = { models?: Record<string, ProviderModel> };
type ModelsDevPayload = Record<string, ModelsDevProvider>;

export type ZenModelOption = Pick<ProviderModel, "id" | "name">;

const MODELS_DEV_URL = "https://models.dev/api.json";

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

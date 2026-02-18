import { fetchOpencodeFreeModels, type ZenModelOption } from "@/lib/zen-models";

export async function listOpencodeFreeModels(): Promise<ZenModelOption[]> {
  return fetchOpencodeFreeModels();
}

export async function isOpencodeFreeModel(modelID: string): Promise<boolean> {
  const models = await listOpencodeFreeModels();
  return models.some((model) => model.id === modelID) || modelID.endsWith("-free");
}

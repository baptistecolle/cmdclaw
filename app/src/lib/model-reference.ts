export const MODEL_PROVIDER_IDS = [
  "opencode",
  "anthropic",
  "openai",
  "google",
  "kimi-for-coding",
] as const;

export type ModelProviderID = (typeof MODEL_PROVIDER_IDS)[number];

const MODEL_PROVIDER_ID_SET = new Set<string>(MODEL_PROVIDER_IDS);

export function formatModelReference(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

export function parseModelReference(reference: string): {
  providerID: ModelProviderID;
  modelID: string;
} {
  const trimmed = reference.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(`Model "${reference}" must use provider/model format`);
  }
  const providerID = trimmed.slice(0, slashIndex);
  const modelID = trimmed.slice(slashIndex + 1);
  if (MODEL_PROVIDER_ID_SET.has(providerID) && modelID.length > 0) {
    return { providerID: providerID as ModelProviderID, modelID };
  }
  throw new Error(`Unknown model provider "${providerID}" in "${reference}"`);
}

import { parseModelReference } from "@/lib/model-reference";

const OPENAI_CHATGPT_MODEL_IDS = new Set([
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
]);

export function isModelAccessibleForNewChat(params: {
  model: string;
  isOpenAIConnected: boolean;
  availableOpencodeFreeModelIDs?: readonly string[];
}): boolean {
  const model = params.model.trim();
  if (!model) {
    return false;
  }

  let parsed: ReturnType<typeof parseModelReference>;
  try {
    parsed = parseModelReference(model);
  } catch {
    return false;
  }

  if (parsed.providerID === "anthropic") {
    return true;
  }

  if (parsed.providerID === "openai") {
    return params.isOpenAIConnected && OPENAI_CHATGPT_MODEL_IDS.has(parsed.modelID);
  }

  if (parsed.providerID === "opencode") {
    const available = params.availableOpencodeFreeModelIDs;
    if (!available || available.length === 0) {
      return true;
    }
    return available.includes(model);
  }

  return false;
}

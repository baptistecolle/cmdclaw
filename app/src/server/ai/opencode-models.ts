import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseModelReference } from "@/lib/model-reference";
import {
  fetchOpencodeFreeModels,
  PREFERRED_OPENCODE_FREE_MODEL_IDS,
  PREFERRED_ZEN_FREE_MODEL,
  type ZenModelOption,
} from "@/lib/zen-models";

const execFileAsync = promisify(execFile);

async function listRuntimeOpencodeModelIDs(): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("opencode", ["models", "opencode"], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    const modelIDs = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("opencode/"))
      .filter(Boolean);
    if (modelIDs.length === 0) {
      return null;
    }
    return Array.from(new Set(modelIDs));
  } catch {
    return null;
  }
}

function orderModelsByPreference(models: ZenModelOption[]): ZenModelOption[] {
  const byID = new Map(models.map((model) => [model.id, model]));
  const preferred = PREFERRED_OPENCODE_FREE_MODEL_IDS.map((id) => byID.get(id)).filter(
    (model): model is ZenModelOption => Boolean(model),
  );
  const preferredIDs = new Set(preferred.map((model) => model.id));
  const remaining = models
    .filter((model) => !preferredIDs.has(model.id))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return [...preferred, ...remaining];
}

export async function listOpencodeFreeModels(): Promise<ZenModelOption[]> {
  const runtimeModelIDs = await listRuntimeOpencodeModelIDs();
  if (!runtimeModelIDs) {
    return orderModelsByPreference(
      (await fetchOpencodeFreeModels()).map((model) => ({
        id: `opencode/${model.id}`,
        name: model.name,
      })),
    );
  }

  try {
    const modelsDevModels = await fetchOpencodeFreeModels();
    const byID = new Map(modelsDevModels.map((model) => [model.id, model]));
    return orderModelsByPreference(
      runtimeModelIDs
        .map((id) => {
          const { modelID } = parseModelReference(id);
          const model = byID.get(modelID);
          return model ? { id, name: model.name } : { id, name: modelID };
        })
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    );
  } catch {
    return orderModelsByPreference(
      runtimeModelIDs
        .map((id) => ({ id, name: parseModelReference(id).modelID }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    );
  }
}

export async function isOpencodeFreeModel(modelID: string): Promise<boolean> {
  const models = await listOpencodeFreeModels();
  // Only treat known IDs as OpenCode free models.
  // A broad suffix check ("-free") can misroute stale/foreign IDs.
  return models.some((model) => model.id === modelID);
}

export async function resolveDefaultOpencodeFreeModel(
  overrideModel?: string | null,
): Promise<string> {
  const configured = overrideModel?.trim();
  if (configured) {
    parseModelReference(configured);
    return configured;
  }

  try {
    const models = await listOpencodeFreeModels();
    if (models.length > 0) {
      return models[0]!.id;
    }
  } catch {
    // Fall back to configured static preference below.
  }
  return PREFERRED_ZEN_FREE_MODEL;
}

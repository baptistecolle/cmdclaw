import { fetchOpencodeFreeModels } from "../../src/lib/zen-models";

export const PREFERRED_ZEN_FREE_MODEL = "kimi-k2.5-free";

let cachedDefaultModelPromise: Promise<string> | undefined;

/**
 * Resolve the model used by live chat E2E tests.
 * Priority:
 * 1) E2E_CHAT_MODEL env override
 * 2) Preferred Zen free model when available
 * 3) First available Zen free model
 * 4) Preferred fallback when model list fetch fails
 */
export function resolveLiveE2EModel(): Promise<string> {
  const configured = process.env.E2E_CHAT_MODEL?.trim();
  if (configured) {
    return Promise.resolve(configured);
  }

  if (!cachedDefaultModelPromise) {
    cachedDefaultModelPromise = fetchOpencodeFreeModels()
      .then((freeModels) => {
        const ids = freeModels.map((model) => model.id);
        if (ids.includes(PREFERRED_ZEN_FREE_MODEL)) return PREFERRED_ZEN_FREE_MODEL;
        return ids[0] ?? PREFERRED_ZEN_FREE_MODEL;
      })
      .catch(() => PREFERRED_ZEN_FREE_MODEL);
  }

  return cachedDefaultModelPromise;
}

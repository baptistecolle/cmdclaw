import { resolveDefaultOpencodeFreeModel } from "../../src/server/ai/opencode-models";

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
    cachedDefaultModelPromise = resolveDefaultOpencodeFreeModel();
  }

  return cachedDefaultModelPromise;
}

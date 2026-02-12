/**
 * In-memory store for pending OAuth PKCE verifiers.
 * Matches OpenCode's approach — verifiers are never sent through the URL.
 * Keyed by the random `state` parameter, auto-expires after 5 minutes.
 */

export interface PendingOAuth {
  userId: string;
  provider: string;
  codeVerifier: string;
}

interface StoredPendingOAuth extends PendingOAuth {
  createdAt: number;
}

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

const pending = new Map<string, StoredPendingOAuth>();

export function storePending(state: string, data: PendingOAuth) {
  // Cleanup expired entries
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.createdAt > EXPIRY_MS) {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
      pending.delete(key);
    }
  }
  pending.set(state, { ...data, createdAt: now });
}

export function consumePending(state: string): PendingOAuth | undefined {
  const data = pending.get(state);
  if (!data) {
    return undefined;
  }
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- Map.delete, not a Drizzle query
  pending.delete(state);
  if (Date.now() - data.createdAt > EXPIRY_MS) {
    return undefined;
  }
  return data;
}

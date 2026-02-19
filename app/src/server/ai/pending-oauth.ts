import { eq, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { providerOauthState } from "@/server/db/schema";

/**
 * Durable store for pending OAuth PKCE verifiers.
 * Keyed by random `state`, single-use via delete+returning, with short TTL cleanup.
 */

export interface PendingOAuth {
  userId: string;
  provider: string;
  codeVerifier: string;
}

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export async function storePending(state: string, data: PendingOAuth): Promise<void> {
  const cutoff = new Date(Date.now() - EXPIRY_MS);
  await db.delete(providerOauthState).where(lt(providerOauthState.createdAt, cutoff));

  await db
    .insert(providerOauthState)
    .values({
      state,
      userId: data.userId,
      provider: data.provider,
      codeVerifier: data.codeVerifier,
    })
    .onConflictDoUpdate({
      target: providerOauthState.state,
      set: {
        userId: data.userId,
        provider: data.provider,
        codeVerifier: data.codeVerifier,
        createdAt: new Date(),
      },
    });
}

export async function consumePending(state: string): Promise<PendingOAuth | undefined> {
  const [row] = await db
    .delete(providerOauthState)
    .where(eq(providerOauthState.state, state))
    .returning();
  if (!row) {
    return undefined;
  }
  if (Date.now() - row.createdAt.getTime() > EXPIRY_MS) {
    return undefined;
  }

  return {
    userId: row.userId,
    provider: row.provider,
    codeVerifier: row.codeVerifier,
  };
}

export async function getPending(state: string): Promise<PendingOAuth | undefined> {
  const row = await db.query.providerOauthState.findFirst({
    where: eq(providerOauthState.state, state),
  });
  if (!row) {
    return undefined;
  }
  if (Date.now() - row.createdAt.getTime() > EXPIRY_MS) {
    return undefined;
  }

  return {
    userId: row.userId,
    provider: row.provider,
    codeVerifier: row.codeVerifier,
  };
}

export async function deletePending(state: string): Promise<void> {
  await db.delete(providerOauthState).where(eq(providerOauthState.state, state));
}

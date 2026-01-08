import type { db } from "@/server/db/client";

type DbClient = typeof db;

export type TRPCContext = {
  headers: Headers;
  /**
   * Lazy DB loader so routes can opt in to database access without eagerly
   * requiring a connection for every request.
   */
  getDb: () => Promise<DbClient>;
};

export function createTRPCContext(opts: { headers: Headers }): TRPCContext {
  return {
    headers: opts.headers,
    getDb: async () => {
      const { db: database } = await import("@/server/db/client");
      return database;
    },
  };
}

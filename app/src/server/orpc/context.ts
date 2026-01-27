import type { Session, User } from "better-auth";
import { db } from "@/server/db/client";
import { auth } from "@/lib/auth";

export type ORPCContext = {
  headers: Headers;
  db: typeof db;
  session: Session | null;
  user: User | null;
};

export async function createORPCContext(opts: {
  headers: Headers;
}): Promise<ORPCContext> {
  // Get session from Better-Auth
  const sessionData = await auth.api.getSession({
    headers: opts.headers,
  });

  return {
    headers: opts.headers,
    db,
    session: sessionData?.session ?? null,
    user: sessionData?.user ?? null,
  };
}

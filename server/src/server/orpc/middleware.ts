import { os, ORPCError } from "@orpc/server";
import type { ORPCContext } from "./context";
import type { Session, User } from "better-auth";

// Base procedure with context
export const baseProcedure = os.$context<ORPCContext>();

// Authenticated context type
export type AuthenticatedContext = ORPCContext & {
  user: User;
  session: Session;
};

// Protected procedure requiring authentication
export const protectedProcedure = baseProcedure.use(async ({ context, next }) => {
  if (!context.user || !context.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "You must be logged in" });
  }

  return next({
    context: {
      ...context,
      user: context.user,
      session: context.session,
    } satisfies AuthenticatedContext,
  });
});

// Optional auth - passes through but includes user if available
export const optionalAuthProcedure = baseProcedure;

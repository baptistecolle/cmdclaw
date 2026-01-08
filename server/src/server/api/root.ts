import { router } from "@/server/api/trpc";
import { healthRouter } from "./routers/health";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

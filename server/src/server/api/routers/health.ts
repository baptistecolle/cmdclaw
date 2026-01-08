import { z } from "zod";

import { publicProcedure, router } from "@/server/api/trpc";

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    message: "pong",
    at: new Date().toISOString(),
  })),

  echo: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(({ input }) => ({
      text: input.text,
      at: new Date().toISOString(),
    })),
});

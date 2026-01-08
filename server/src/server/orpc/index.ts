import { baseProcedure } from "./middleware";
import { chatRouter } from "./routers/chat";
import { conversationRouter } from "./routers/conversation";
import { integrationRouter } from "./routers/integration";

const ping = baseProcedure.handler(async () => ({
  status: "ok" as const,
  timestamp: new Date().toISOString(),
}));

export const appRouter = {
  chat: chatRouter,
  conversation: conversationRouter,
  integration: integrationRouter,
  health: { ping },
};

export type AppRouter = typeof appRouter;

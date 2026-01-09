import { baseProcedure } from "./middleware";
import { chatRouter } from "./routers/chat";
import { conversationRouter } from "./routers/conversation";
import { integrationRouter } from "./routers/integration";
import { voiceRouter } from "./routers/voice";

const ping = baseProcedure.handler(async () => ({
  status: "ok" as const,
  timestamp: new Date().toISOString(),
}));

export const appRouter = {
  chat: chatRouter,
  conversation: conversationRouter,
  integration: integrationRouter,
  voice: voiceRouter,
  health: { ping },
};

export type AppRouter = typeof appRouter;

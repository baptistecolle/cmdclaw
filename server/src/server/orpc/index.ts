import { baseProcedure } from "./middleware";
import { chatRouter } from "./routers/chat";
import { conversationRouter } from "./routers/conversation";
import { generationRouter } from "./routers/generation";
import { integrationRouter } from "./routers/integration";
import { skillRouter } from "./routers/skill";
import { voiceRouter } from "./routers/voice";

const ping = baseProcedure.handler(async () => ({
  status: "ok" as const,
  timestamp: new Date().toISOString(),
}));

export const appRouter = {
  chat: chatRouter,
  conversation: conversationRouter,
  generation: generationRouter,
  integration: integrationRouter,
  skill: skillRouter,
  voice: voiceRouter,
  health: { ping },
};

export type AppRouter = typeof appRouter;

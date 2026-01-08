import { os } from "@orpc/server";
import { chatRouter } from "./routers/chat";
import { conversationRouter } from "./routers/conversation";
import { integrationRouter } from "./routers/integration";

const healthRouter = os.router({
  ping: os.handler(async () => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  })),
});

export const appRouter = os.router({
  chat: chatRouter,
  conversation: conversationRouter,
  integration: integrationRouter,
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

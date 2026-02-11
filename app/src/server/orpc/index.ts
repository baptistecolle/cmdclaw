import { baseProcedure } from "./middleware";
import { conversationRouter } from "./routers/conversation";
import { deviceRouter } from "./routers/device";
import { generationRouter } from "./routers/generation";
import { integrationRouter } from "./routers/integration";
import { integrationSkillRouter } from "./routers/integration-skill";
import { internalRouter } from "./routers/internal";
import { providerAuthRouter } from "./routers/provider-auth";
import { skillRouter } from "./routers/skill";
import { userRouter } from "./routers/user";
import { voiceRouter } from "./routers/voice";
import { workflowRouter } from "./routers/workflow";

const ping = baseProcedure.handler(async () => ({
  status: "ok" as const,
  timestamp: new Date().toISOString(),
}));

export const appRouter = {
  conversation: conversationRouter,
  device: deviceRouter,
  generation: generationRouter,
  integration: integrationRouter,
  integrationSkill: integrationSkillRouter,
  internal: internalRouter,
  providerAuth: providerAuthRouter,
  skill: skillRouter,
  user: userRouter,
  voice: voiceRouter,
  workflow: workflowRouter,
  health: { ping },
};

export type AppRouter = typeof appRouter;

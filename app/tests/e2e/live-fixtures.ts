import { test as base, expect } from "@playwright/test";
import { resolveLiveE2EModel } from "./live-chat-model";

type LiveFixtures = {
  liveChatModel: string;
};

export const test = base.extend<{}, LiveFixtures>({
  liveChatModel: [
    async ({}, provideModel) => {
      const model = await resolveLiveE2EModel();
      await provideModel(model);
    },
    { scope: "worker" },
  ],
});

export { expect };

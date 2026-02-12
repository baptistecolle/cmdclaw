import { test as base, expect } from "@playwright/test";
import { resolveLiveE2EModel } from "./live-chat-model";

type LiveFixtures = {
  liveChatModel: string;
};

export const test = base.extend<{}, LiveFixtures>({
  liveChatModel: [
    async ({}, use) => {
      const model = await resolveLiveE2EModel();
      await use(model);
    },
    { scope: "worker" },
  ],
});

export { expect };

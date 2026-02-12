import { test as base, expect } from "@playwright/test";
import { resolveLiveE2EModel } from "./live-chat-model";

type LiveFixtures = {
  liveChatModel: string;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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

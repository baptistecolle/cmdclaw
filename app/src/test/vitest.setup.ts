import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "@/test/msw/server";

const isLiveE2E = process.env.E2E_LIVE === "1";

beforeAll(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.resetHandlers();
});

afterAll(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.close();
});

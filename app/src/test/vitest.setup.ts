import { config } from "dotenv";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "@/test/msw/server";

for (const envFile of [".env.test.local", ".env.test", ".env"]) {
  config({ path: envFile, override: false });
}

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

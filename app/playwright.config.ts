import { defineConfig, devices } from "@playwright/test";

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER !== "0";
const defaultPort = skipWebServer ? 3000 : 4300;
const port = Number(process.env.PLAYWRIGHT_PORT ?? defaultPort);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const videoMode =
  process.env.PLAYWRIGHT_VIDEO === "off" ||
  process.env.PLAYWRIGHT_VIDEO === "on" ||
  process.env.PLAYWRIGHT_VIDEO === "retain-on-failure" ||
  process.env.PLAYWRIGHT_VIDEO === "on-first-retry"
    ? process.env.PLAYWRIGHT_VIDEO
    : "retain-on-failure";

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/e2e/**/*.e2e.ts", "src/**/*.e2e.test.ts"],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: videoMode,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: `bun run build && bun run start -- --port ${port}`,
        url: baseURL,
        reuseExistingServer,
        timeout: 120_000,
      },
});

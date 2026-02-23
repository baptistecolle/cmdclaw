import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const enforceCoverageThreshold = process.env.COVERAGE_CHECK === "1";
const liveE2EEnabled = process.env.E2E_LIVE === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "tests/e2e/**",
      "src/**/*.e2e.test.{ts,tsx}",
      ...(liveE2EEnabled
        ? []
        : [
            "tests/e2e-cli/**",
            "src/**/*.live.test.{ts,tsx}",
            "tests/**/*.live.test.{ts,tsx}",
            "tests/**/*.live.e2e.test.{ts,tsx}",
          ]),
    ],
    environment: "node",
    setupFiles: ["src/test/vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/sandbox-templates/common/**",
      ],
      thresholds: enforceCoverageThreshold
        ? {
            lines: 60,
            functions: 60,
            branches: 60,
            statements: 60,
          }
        : undefined,
    },
  },
});

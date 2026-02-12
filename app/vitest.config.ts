import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const enforceCoverageThreshold = process.env.COVERAGE_CHECK === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/e2b-template/**",
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

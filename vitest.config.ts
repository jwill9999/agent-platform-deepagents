import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx,cts}", "packages/*/src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: process.env.HARNESS_COVERAGE_DIR ?? "coverage",
      thresholds: {
        perFile: true,
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 80,
      },
    },
  },
});

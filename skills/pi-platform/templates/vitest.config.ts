import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          pool: "forks",
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: ".cache/platform/coverage",
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
      include: ["packages/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});

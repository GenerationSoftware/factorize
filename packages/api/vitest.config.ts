import { defineConfig } from "vitest/config";

export default defineConfig({
  // Database suites create and migrate isolated databases; bound concurrent setup work.
  test: { maxWorkers: 3, hookTimeout: 30_000, testTimeout: 30_000, exclude: ["test/**/*.e2e.test.ts", "**/node_modules/**", "**/.git/**"] },
});

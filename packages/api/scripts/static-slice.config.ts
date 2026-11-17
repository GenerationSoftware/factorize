import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    include: ["test/static-slice.e2e.test.ts", "test/pages-smoke.e2e.test.ts"],
  },
});

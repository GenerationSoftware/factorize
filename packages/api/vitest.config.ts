import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { hookTimeout: 30_000, exclude: ["test/**/*.e2e.test.ts", "**/node_modules/**", "**/.git/**"] },
});

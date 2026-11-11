import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 30_000, include: ["test/static-slice.e2e.test.ts"] } });

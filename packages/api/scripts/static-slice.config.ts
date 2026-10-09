import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/static-slice.e2e.test.ts"] } });

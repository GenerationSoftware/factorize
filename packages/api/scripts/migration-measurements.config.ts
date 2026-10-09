import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/migration-measurements.e2e.test.ts"] } });

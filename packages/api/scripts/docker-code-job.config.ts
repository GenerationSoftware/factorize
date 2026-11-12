import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/docker-code-job.e2e.test.ts"], maxWorkers: 1, hookTimeout: 30_000 } });

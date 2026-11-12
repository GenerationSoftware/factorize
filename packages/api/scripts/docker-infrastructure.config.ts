import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/docker-job-infrastructure.e2e.test.ts"], maxWorkers: 1 } });

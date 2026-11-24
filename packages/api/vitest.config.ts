import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { BalancedValidationSequencer } from "./validation-sequencer";

export default defineConfig({
  test: {
    // The real OAuth provider imports the Worker entrypoint shim in protocol tests.
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    // Isolated database fixtures spend part of their time waiting on PostgreSQL I/O.
    maxWorkers: Number(process.env.FACTORIZE_VITEST_WORKERS ?? Math.min(availableParallelism() + 1, 4)),
    hookTimeout: 30_000,
    sequence: { sequencer: BalancedValidationSequencer },
    testTimeout: 30_000,
    exclude: ["test/**/*.e2e.test.ts", "**/node_modules/**", "**/.git/**"],
  },
});

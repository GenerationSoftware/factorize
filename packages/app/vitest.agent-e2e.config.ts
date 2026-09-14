import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/agent-launch.e2e.test.ts"],
    environment: "node",
  },
});

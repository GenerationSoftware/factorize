import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/functional",
  testMatch: "*.spec.mjs",
  workers: Math.min(availableParallelism(), 4),
  use: { browserName: "chromium", locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" },
  reporter: [["list"]],
});

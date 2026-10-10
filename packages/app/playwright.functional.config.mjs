import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/functional",
  testMatch: "*.spec.mjs",
  // These fixtures share one in-process HTTP server per test worker. Running
  // the small required suite serially avoids cross-test route/server races on
  // constrained CI runners while preserving the same coverage.
  workers: 1,
  fullyParallel: false,
  use: { browserName: "chromium", locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" },
  reporter: [["list"]],
});

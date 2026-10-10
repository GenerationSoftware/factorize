import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/functional",
  testMatch: "*.spec.mjs",
  workers: 2,
  fullyParallel: true,
  use: { browserName: "chromium", locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" },
  reporter: [["list"]],
});

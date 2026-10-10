import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/visual",
  testMatch: "*.spec.mjs",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  workers: 1,
  fullyParallel: false,
  use: { browserName: "chromium", locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" },
  expect: { toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.001 } },
  reporter: [["list"]],
});

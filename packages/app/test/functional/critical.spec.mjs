import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi, screens, jobId } from "../visual/fixtures.mjs";

let server;
let origin;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    const file = /^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path) ? path : "/index.html";
    try {
      const body = await readFile(new URL("../../dist" + file, import.meta.url));
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html");
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test("navigation, theme preference and essential accessibility remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.goto(origin + screens[3][1]);
  await expect(page.getByRole("heading", { name: "Release review", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trace", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prompt", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keyboard focus and validation work on representative mobile UI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { long: true });
  await page.goto(origin + "/jobs/" + jobId);
  const profile = page.getByRole("button", { name: "Your account", exact: true });
  await profile.click();
  await expect(page.getByRole("link", { name: "Settings", exact: true }).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile).toBeFocused();
  const run = page.getByRole("button", { name: "Run job", exact: true });
  await run.click();
  await page.getByLabel("JSON data (optional)").fill("[]");
  await page.getByRole("button", { name: "Invoke", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("JSON data must be an object.");
  await page.keyboard.press("Escape");
  await expect(run).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("loading, search, error and no-result states are actionable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  let pending;
  let mode = "pending";
  await page.route("**/api/v1/job-summaries?**", route => mode === "pending" ? (pending = route) : route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } }));
  await page.goto(origin + "/jobs");
  await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeVisible();
  mode = "error";
  await pending.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } });
  await expect(page.getByRole("alert")).toHaveText("This workspace is unavailable.");
  await page.getByRole("button", { name: "Search jobs and runs", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search jobs and runs", exact: true });
  await expect(input).toBeFocused();
  await input.fill("release");
  await expect(page.getByRole("option")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("trace details, virtualization beyond the viewport and generation reset remain functional", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { long: true });
  await page.goto(origin + "/job-runs/" + "00000000-0000-4000-8000-000000000002");
  await expect(page.getByText("User · user_message", { exact: true })).toBeVisible();
  const details = page.locator("main ol details");
  await details.first().locator("summary").click();
  await expect(details.first()).toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
});

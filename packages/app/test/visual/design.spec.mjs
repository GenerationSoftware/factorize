import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi, screens, jobId } from "./fixtures.mjs";
let server, origin;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    let file = /^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path) ? path : "/index.html";
    try {
      const body = await readFile(new URL("../../dist" + file, import.meta.url));
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  for (const [name, path, heading] of screens) test(`${name} ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.clock.install({ time: new Date("2026-10-09T12:02:00Z") });
    await mockApi(page, { authenticated: name !== "login" });
    await page.goto(origin + path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (name === "editor") await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Review release builds");
    if (name === "trace") {
      await expect(page.getByText("User · user_message", { exact: true })).toBeVisible();
      for (const summary of await page.locator("main ol details > summary").all()) await summary.click();
    }
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}-${theme}-${width}.png`, { fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
    expect(await page.locator("header img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}
for (const saved of ["light", "dark"]) test(`saved ${saved} theme takes precedence before application scripts`, async ({ page }) => {
  await mockApi(page, { authenticated: false });
  await page.emulateMedia({ colorScheme: saved === "light" ? "dark" : "light" });
  await page.addInitScript(value => localStorage.setItem("factorize-theme", value), saved);
  await page.route("**/assets/*.js", route => route.request().url().includes("theme-init-") ? route.continue() : route.abort());
  await page.goto(origin + "/auth/login");
  expect(await page.locator("html").getAttribute("data-theme")).toBe(saved);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe(saved === "light" ? "rgb(252, 251, 246)" : "rgb(21, 20, 16)");
});
test("system changes apply until the user chooses a saved preference", async ({ page }) => {
  await mockApi(page, { authenticated: false }); await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(origin + "/auth/login"); await expect(page.getByRole("heading", { name: "Sign in to Factorize" })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("factorize-theme"))).toBe("dark");
});
test("mobile profile, search and run dialog keyboard/focus behavior; long content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page, { long: true });
  await page.goto(origin + "/jobs/" + jobId);
  const profile = page.getByRole("button", { name: "Your account", exact: true });
  await profile.click(); await expect(page.getByRole("link", { name: "Settings", exact: true }).last()).toBeVisible();
  await page.keyboard.press("Escape"); await expect(profile).toBeFocused();
  await page.getByRole("button", { name: "Search jobs and runs", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search jobs and runs", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  const run = page.getByRole("button", { name: "More run options", exact: true }); await run.click();
  await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).fill("Review");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(run).toBeFocused();
  await expect(page.getByText("Prompt template", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("long-job-mobile.png", { fullPage: true });
});
for (const state of ["running", "failed"]) test(`trace ${state} presentation`, async ({ page }) => {
  await mockApi(page, { state }); await page.clock.install({ time: new Date("2026-10-09T12:02:00Z") });
  await page.goto(origin + screens[3][1]); await expect(page.getByRole("heading", { name: "Release review" })).toBeVisible();
  await expect(page.getByText("User · user_message", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot(`trace-${state}.png`, { fullPage: true });
});
test("empty jobs", async ({ page }) => {
  await mockApi(page, { empty: true }); await page.goto(origin + "/jobs");
  await expect(page.getByRole("heading", { name: "No jobs found" })).toBeVisible();
  await expect(page).toHaveScreenshot("jobs-empty.png");
});
for (const theme of ["light", "dark"]) test(`additional routes and feedback ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  for (const [name, path] of [["keys", "/settings/api-keys"], ["clients", "/settings/authorized-clients"], ["password", "/settings/password"], ["consent", "/authorize?client_id=fixture"], ["device", "/device?user_code=ABCD-EFGH"], ["index", "/"], ["not-found", "/missing"]]) {
    await page.goto(origin + path); await expect(page.locator("main h1")).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}-${theme}-390.png`, { fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto(origin + "/jobs");
  await page.getByRole("heading", { name: "Jobs", exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveScreenshot(`chunk-recovery-${theme}-390.png`);
});
test("loading, error, disabled and search states", async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 });
  let pending, fail = false;
  await page.route("**/api/v1/job-summaries?**", route => fail ? route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } }) : (pending = route));
  await page.goto(origin + "/jobs");
  await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeVisible();
  await expect(page).toHaveScreenshot("jobs-loading-mobile.png");
  fail = true; await pending.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } });
  await expect(page.getByRole("alert")).toHaveText("This workspace is unavailable.");
  await expect(page).toHaveScreenshot("jobs-error-mobile.png");
  await page.getByRole("button", { name: "Search jobs and runs", exact: true }).click();
  await expect(page.getByRole("combobox")).toBeFocused();
  await expect(page).toHaveScreenshot("search-empty-mobile.png");
  await page.getByRole("combobox").fill("release");
  await expect(page.getByRole("option")).toBeVisible();
  await expect(page).toHaveScreenshot("search-results-mobile.png");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Search jobs and runs", exact: true })).toBeFocused();
  await page.goto(origin + "/auth/signup");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("signup-mobile.png");
});
for (const theme of ["light", "dark"]) test(`search loading, error and no results ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page);
  let mode = "pending", pending;
  const failure = { status: 403, json: { error: { code: "forbidden", message: "Search is unavailable for this workspace." } } };
  await page.route("**/api/v1/search?**", route => mode === "pending" ? (pending = route) : mode === "error" ? route.fulfill(failure) : route.fulfill({ json: { items: [] } }));
  await page.goto(origin + "/jobs"); await page.getByRole("heading", { name: "Jobs", exact: true }).waitFor();
  await page.getByRole("button", { name: "Search jobs and runs", exact: true }).click();
  const dialog = page.getByRole("dialog"), input = dialog.getByRole("combobox", { name: "Search jobs and runs", exact: true });
  await input.fill("release"); await expect(dialog.getByRole("status")).toHaveText("Searching…");
  await expect(page).toHaveScreenshot(`search-loading-${theme}-390.png`);
  mode = "error"; await pending.fulfill(failure);
  await expect(dialog.getByRole("alert")).toHaveText("Search is unavailable for this workspace.");
  await expect(page).toHaveScreenshot(`search-error-${theme}-390.png`);
  mode = "empty"; await input.fill("missing");
  await expect(dialog.getByText("No results found.", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot(`search-no-results-${theme}-390.png`);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

for (const theme of ["light", "dark"]) test(`run tabs, context and breadcrumbs on mobile ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: theme });
  await mockApi(page, { long: true });
  await page.goto(origin + screens[3][1]);
  const trace = page.getByRole("tab", { name: "Trace", exact: true });
  await expect(trace).toHaveAttribute("aria-selected", "true");
  await trace.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Info", exact: true })).toBeFocused();
  await page.getByText("Prompt, context and provenance", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prompt", exact: true })).toBeVisible();
  await page.getByText("Diagnostics and artifacts", { exact: true }).click();
  await expect(page.getByText(/"artifacts":/)).toBeVisible();
  await expect(page).toHaveScreenshot(`run-context-${theme}-390.png`, { fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByText("Replay trace", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay retained trace" })).toBeVisible();
  await expect(page).toHaveScreenshot(`run-settings-${theme}-390.png`, { fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumbs.getByRole("link", { name: "Review release builds", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/jobs/" + jobId));
  await expect(page.getByRole("heading", { name: /^Long release review/ })).toBeVisible();
  await page.goto(origin + screens[3][1]);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 400 }]) test(`search geometry stays stable through asynchronous query changes ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport); await mockApi(page);
  let pending;
  await page.route("**/api/v1/search?**", route => { pending = route; });
  await page.goto(origin + "/jobs");
  const opener = page.getByRole("button", { name: "Search jobs and runs", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog"), input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  const geometry = async () => ({ panel: await dialog.boundingBox(), input: await input.boundingBox() });
  const initial = await geometry();
  expect(initial.panel.y).toBeGreaterThanOrEqual(0);
  expect(initial.panel.y + initial.panel.height).toBeLessThanOrEqual(viewport.height);
  const items = count => Array.from({ length: count }, (_, index) => ({ kind: "job", id: jobId, title: `Result ${index + 1}`, subtitle: "Matching job " + "long text ".repeat(8) }));
  for (const [query, count] of [["missing", 0], ["few", 2], ["many", 30], ["changed", 1], ["empty again", 0]]) {
    pending = undefined;
    await input.fill(query);
    await expect(dialog.getByRole("status")).toHaveText("Searching…");
    expect(await geometry()).toEqual(initial);
    await expect.poll(() => pending && new URL(pending.request().url()).searchParams.get("q")).toBe(query);
    await pending.fulfill({ json: { items: items(count) } });
    await expect(dialog.getByRole("option")).toHaveCount(count);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    if (!count) await expect(dialog.getByText("No results found.", { exact: true })).toBeVisible();
    expect(await geometry()).toEqual(initial);
    await expect(input).toBeFocused();
    if (count === 30) {
      await input.press("ArrowUp");
      await expect(input).toHaveAttribute("aria-activedescendant", "search-result-29");
      await expect(dialog.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
      const last = await dialog.getByRole("option").last().boundingBox();
      expect(last.y + last.height).toBeLessThanOrEqual(initial.panel.y + initial.panel.height);
      expect(await dialog.locator("#search-results").evaluate(list => list.parentElement.scrollTop)).toBeGreaterThan(0);
      expect(await geometry()).toEqual(initial);
      await input.press("ArrowDown");
      await expect(input).toHaveAttribute("aria-activedescendant", "search-result-0");
    }
  }
  await input.fill("");
  await expect(dialog.getByText("Find jobs and runs", { exact: false })).toBeVisible();
  expect(await geometry()).toEqual(initial);
  await input.fill("select");
  await expect(dialog.getByRole("status")).toHaveText("Searching…");
  await expect.poll(() => pending && new URL(pending.request().url()).searchParams.get("q")).toBe("select");
  await pending.fulfill({ json: { items: items(2) } });
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await input.press("ArrowDown"); await input.press("Enter");
  await expect(dialog).toHaveCount(0); await expect(page).toHaveURL(origin + "/jobs/" + jobId);
  await opener.click(); await input.fill("click");
  await expect(dialog.getByRole("status")).toHaveText("Searching…");
  await expect.poll(() => pending && new URL(pending.request().url()).searchParams.get("q")).toBe("click");
  await pending.fulfill({ json: { items: items(1) } });
  await dialog.getByRole("option").click(); await expect(dialog).toHaveCount(0);
  await opener.click(); await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
});

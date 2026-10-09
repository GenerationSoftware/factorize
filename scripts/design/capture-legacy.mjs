// Read-only historical rendering: never mount this code in the restored app.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { chromium } from "playwright";
import { mockApi, screens, jobId, runId, events } from "../../packages/app/test/visual/fixtures.mjs";
const root = new URL("../../", import.meta.url).pathname;
const temp = root + "packages/app/test/visual/.legacy";
const reference = "ff4b51b";
await rm(temp, { recursive: true, force: true }); await mkdir(temp, { recursive: true });
const archive = execFileSync("git", ["archive", reference, "packages/api/src"], { cwd: root });
execFileSync("tar", ["-x", "-C", temp], { input: archive });
const src = temp + "/packages/api/src";
await build({ entryPoints: [src + "/ui.ts"], bundle: true, platform: "node", format: "esm", outfile: temp + "/ui.mjs", logLevel: "silent" });
const ui = await import(temp + "/ui.mjs");
const cssSource = await readFile(src + "/tailwind.css", "utf8");
const compiler = await compile(cssSource, { base: root + "packages/app", onDependency: () => {} });
const scanner = new Scanner({ sources: [{ base: src, pattern: "**/*", negated: false }] });
const css = compiler.build(scanner.scan());
const viewer = { email: "owner@example.test" };
const html = {
  jobs: ui.jobsPage(viewer), job: ui.jobDetailPage(viewer, jobId), editor: ui.jobPage(viewer, jobId),
  trace: ui.jobRunPage(viewer, runId), settings: ui.settingsPage(viewer),
  login: ui.authPage("Sign in to Factorize", "login"),
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  if (path === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else if (path === "/bee-mark-monochrome.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile(root + "packages/app/src/assets/bee-mark-monochrome.png")); }
  else { res.setHeader("Content-Type", "text/html"); res.end(html[path.slice(1)] ?? html.jobs); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const output = new URL("../../packages/app/test/visual/references/", import.meta.url); await mkdir(output, { recursive: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [1280, 390]) for (const [name] of screens) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce" });
    await page.clock.install({ time: new Date("2026-10-09T12:02:00Z") });
    await page.clock.pauseAt(new Date("2026-10-09T12:02:00Z"));
    await page.addInitScript(value => localStorage.setItem("factorize-theme", value), theme);
    await mockApi(page, { legacy: true, authenticated: name !== "login" });
    await page.goto(origin + "/" + name);
    if (name === "jobs") await page.locator("#jobs li").first().waitFor();
    if (name === "job" || name === "trace") await page.locator("main h1").waitFor();
    if (name === "editor") await page.locator('input[name="name"]').filter({ visible: true }).waitFor();
    if (name === "settings") await page.locator("#installed-loading").waitFor({ state: "hidden" });
    // Historical native auth omitted the theme script; exercise its existing dark classes explicitly.
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    if (name === "trace") { await page.locator("[data-run-trace] > *").first().waitFor(); if (await page.locator("[data-run-trace] > *").count() !== events.length) throw new Error("Historical trace fixture did not render exactly one copy of each event"); }
    if (name === "editor") await page.waitForFunction(() => document.querySelector('input[name="name"]').value === "Review release builds");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`${name}-${theme}-${width}.png`, output).pathname, fullPage: true, animations: "disabled" });
    console.log(`Captured ${reference} ${name} ${theme} ${width}`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }

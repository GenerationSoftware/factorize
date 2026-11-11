import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi, screens, jobId, projectId, project, job } from "../visual/fixtures.mjs";

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
  await page.getByRole("tab", { name: "Info", exact: true }).click();
  await page.getByText("Prompt, context and provenance", { exact: true }).click();
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
  const options = page.getByRole("button", { name: "More run options", exact: true });
  await options.click();
  await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  await page.getByLabel("JSON data (optional)").fill("[]");
  await page.getByRole("button", { name: "Run with prompt", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("JSON data must be an object.");
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("loading, search, error and no-result states are actionable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  let pending;
  let mode = "pending";
  await page.route("**/api/v1/job-summaries?**", route => mode === "pending" ? (pending = route) : route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } }));
  await page.goto(origin + "/projects/" + projectId);
  await expect(page.getByRole("status").filter({ hasText: "Loading jobs…" })).toBeVisible();
  mode = "error";
  await pending.fulfill({ status: 403, json: { error: { code: "forbidden", message: "This workspace is unavailable." } } });
  await expect(page.getByRole("alert")).toHaveText("This workspace is unavailable.");
  await page.getByRole("button", { name: "Search jobs, runs, and messages", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search jobs and runs by name, title, or issue identifier", exact: true });
  await expect(input).toBeFocused();
  await input.fill("release");
  await expect(page.getByRole("option")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("project and job child requests start after session but do not wait for their detail requests", async ({ page }) => {
  const requests = [];
  let releaseProject, releaseJobs, releaseJob, releaseHistory;
  const projectGate = new Promise(resolve => { releaseProject = resolve; });
  const jobsGate = new Promise(resolve => { releaseJobs = resolve; });
  const jobGate = new Promise(resolve => { releaseJob = resolve; });
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    requests.push({ path, search: url.search });
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner" }, workspace: { id: "tenant", name: "Release" }, capabilities: [] } });
    if (path === `/api/v1/projects/${projectId}`) { await projectGate; return route.fulfill({ json: project }); }
    if (path === "/api/v1/job-summaries") { await jobsGate; return route.fulfill({ json: { items: [], nextCursor: null } }); }
    if (path === `/api/v1/jobs/${jobId}`) { await jobGate; return route.fulfill({ json: job }); }
    if (path === "/api/v1/runs") { await historyGate; return route.fulfill({ json: { items: [], nextCursor: null } }); }
    return route.fulfill({ json: [] });
  });

  const projectNavigation = page.goto(`${origin}/projects/${projectId}?q=release&sort=title&order=desc`);
  await expect.poll(() => requests.map(request => request.path)).toContain("/api/v1/session");
  await expect.poll(() => requests.map(request => request.path)).toContain(`/api/v1/projects/${projectId}`);
  await expect.poll(() => requests.map(request => request.path)).toContain("/api/v1/job-summaries");
  expect(requests.find(request => request.path === "/api/v1/job-summaries").search).toContain(`projectId=${projectId}`);
  expect(requests.find(request => request.path === "/api/v1/job-summaries").search).toContain("q=release");
  releaseProject();
  await projectNavigation;
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  expect(await page.getByRole("status").filter({ hasText: "Loading jobs…" }).isVisible()).toBe(true);
  releaseJobs();
  await expect(page.getByRole("status").filter({ hasText: "Loading jobs…" })).toHaveCount(0);

  const jobNavigation = page.goto(`${origin}/jobs/${jobId}?cursor=cursor-1&sort=created&direction=desc&states=failed`);
  await expect.poll(() => requests.map(request => request.path)).toContain(`/api/v1/jobs/${jobId}`);
  await expect.poll(() => requests.filter(request => request.path === "/api/v1/runs").length).toBe(1);
  const historySearch = requests.find(request => request.path === "/api/v1/runs").search;
  expect(historySearch).toContain("jobId=");
  expect(historySearch).toContain("cursor=cursor-1");
  expect(historySearch).toContain("sort=created");
  expect(historySearch).toContain("direction=desc");
  expect(historySearch).toContain("state=failed");
  releaseJob();
  await jobNavigation;
  await expect(page.getByRole("heading", { name: job.name, exact: true })).toBeVisible();
  expect(await page.getByRole("status").filter({ hasText: "Loading run history…" }).isVisible()).toBe(true);
  releaseHistory();
  await expect(page.getByRole("status").filter({ hasText: "Loading run history…" })).toHaveCount(0);
});

test("intent preloading reuses project detail and jobs queries on click", async ({ page }) => {
  const requestCounts = new Map();
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner" }, workspace: { id: "tenant", name: "Release" }, capabilities: [] } });
    if (path === "/api/v1/projects") return route.fulfill({ json: [project] });
    if (path === `/api/v1/projects/${projectId}`) return route.fulfill({ json: project });
    if (path === "/api/v1/job-summaries") return route.fulfill({ json: { items: new URL(route.request().url()).searchParams.has("projectId") ? [] : [job], nextCursor: null } });
    if (path === `/api/v1/jobs/${jobId}`) return route.fulfill({ json: job });
    if (path === "/api/v1/runs") return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`${origin}/projects`);
  const projectLink = page.getByRole("link", { name: new RegExp(project.name) });
  await projectLink.hover();
  await expect.poll(() => requestCounts.get(`/api/v1/projects/${projectId}`) ?? 0).toBe(1);
  await expect.poll(() => requestCounts.get("/api/v1/job-summaries") ?? 0).toBe(1);
  await projectLink.click();
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  expect(requestCounts.get(`/api/v1/projects/${projectId}`)).toBe(1);
  expect(requestCounts.get("/api/v1/job-summaries")).toBe(1);

  await page.goto(`${origin}/jobs`);
  const jobLink = page.getByRole("link", { name: job.name, exact: true });
  await jobLink.hover();
  await expect.poll(() => requestCounts.get(`/api/v1/jobs/${jobId}`) ?? 0).toBe(1);
  await expect.poll(() => requestCounts.get("/api/v1/runs") ?? 0).toBe(1);
  await jobLink.click();
  await expect(page.getByRole("heading", { name: job.name, exact: true })).toBeVisible();
  expect(requestCounts.get(`/api/v1/jobs/${jobId}`)).toBe(1);
  expect(requestCounts.get("/api/v1/runs")).toBe(1);
});

test("conversation trace renders assistant messages and uses document scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { long: true });
  await page.goto(origin + "/job-runs/" + "00000000-0000-4000-8000-000000000002");
  await expect(page.getByText("Release ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Show full trace" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Show full trace" })).toHaveAttribute("href", /\/job-runs\/00000000-0000-4000-8000-000000000002\/trace$/);
  await expect(page.getByText("Full trace", { exact: true })).toHaveCount(0);
  await expect(page.getByText("events loaded", { exact: false })).toHaveCount(0);
  expect(await page.locator("[data-run-trace]").evaluate(element => getComputedStyle(element).overflow)).not.toBe("auto");
});

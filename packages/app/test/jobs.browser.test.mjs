import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const jobId = "00000000-0000-4000-8000-000000000001", runId = "00000000-0000-4000-8000-000000000002";
const summary = { id: jobId, name: "Review builds", slug: "review-builds", enabled: true, runningCount: 0, concurrencyLimit: 2, lastRunState: null, model: "", effort: "", agentKind: "codex", createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://local").pathname;
    const file = path.startsWith("/assets/") ? path : "/index.html";
    try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function contextFor(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  return { context, page };
}
test("job search/cursors survive direct refresh and mobile keyboard navigation", async () => {
  const { page, context } = await contextFor({ viewport: { width: 390, height: 844 } });
  const requests = [];
  await page.route("**/api/v1/job-summaries?**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { items: [{ ...summary, name: url.searchParams.has("cursor") ? "Second job" : "Review builds" }], nextCursor: url.searchParams.has("cursor") ? null : jobId } });
  });
  await page.goto(origin + "/jobs?q=Review");
  await page.getByRole("link", { name: "Review builds", exact: true }).waitFor();
  await page.getByRole("link", { name: "Next page" }).click();
  await page.getByRole("link", { name: "Second job" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("cursor"), jobId);
  await page.reload(); await page.getByRole("link", { name: "Second job" }).waitFor();
  await page.getByLabel("Search jobs").fill("builds"); await page.getByLabel("Search jobs").press("Enter");
  await page.waitForURL("**/jobs?q=builds*");
  assert.equal(new URL(page.url()).searchParams.has("cursor"), false);
  assert.ok(requests.every(url => url.searchParams.get("limit") === "30"));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await context.close();
});
test("invocation validates JSON, preserves retry idempotency and navigates to lightweight run/trace", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/jobs/${jobId}`, route => route.fulfill({ json: { ...summary, promptTemplate: "Template", runNameTemplate: "", executionTargetId: "local", executionTarget: { connectionId: "local", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: "codex" }, triggers: [], currentRuns: 0, maxConcurrency: 2 } }));
  const inputs = [];
  await page.route(`**/api/v1/jobs/${jobId}/invocations`, route => {
    inputs.push(route.request().postDataJSON());
    return inputs.length === 1 ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Try again" } } }) : route.fulfill({ status: 202, json: { runId, invocationId: "invocation", state: "queued", duplicate: true } });
  });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, job_id: jobId, job_name: "Review builds", run_name: "Manual run", state: "succeeded", finalizing: false, trace_revision: "rev-1", artifact_state: "stored", started_at: null, created_at: summary.createdAt, updated_at: summary.updatedAt, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [{ id: "e1", sequence: 1, type: "reasoning", title: "Thinking", preview: "<script>alert('xss')</script>", display: {} }], nextCursor: null, revision: "rev-1", reset: false } }));
  await page.goto(origin + "/jobs/" + jobId);
  await page.getByLabel("JSON data (optional)").fill("[]"); await page.getByRole("button", { name: "Invoke", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "JSON data must be an object" }).waitFor(); assert.equal(inputs.length, 0);
  await page.getByLabel("JSON data (optional)").fill('{"build":42}'); await page.getByLabel("Prompt", { exact: true }).fill("Review");
  await page.getByRole("button", { name: "Invoke", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Try again" }).waitFor();
  await page.getByRole("button", { name: "Invoke", exact: true }).click(); await page.waitForURL(`**/job-runs/${runId}?**`);
  await page.getByText("Thinking · reasoning", { exact: true }).click();
  await page.getByText("<script>alert('xss')</script>", { exact: true }).waitFor();
  assert.equal(inputs.length, 2); assert.equal(inputs[0].idempotencyKey, inputs[1].idempotencyKey); assert.deepEqual(inputs[1].data, { build: 42 });
  assert.equal(await page.locator("main script").count(), 0); await context.close();
});
test("trace reset between requests discards old pages and finalization keeps terminal polling alive", async () => {
  const { page, context } = await contextFor();
  let statusCalls = 0, reset = false;
  await page.route(`**/api/v1/runs/${runId}/status`, route => { statusCalls++; return route.fulfill({ json: { id: runId, job_id: jobId, job_name: "Review builds", run_name: "Run", state: "succeeded", finalizing: true, trace_revision: "old", artifact_state: "collecting", created_at: summary.createdAt, updated_at: summary.updatedAt, started_at: null, destination_url: null } }); });
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("after") === "100") reset = true;
    return route.fulfill({ json: { items: [{ id: reset ? "new" : "old", sequence: 1, type: "assistant_message", title: reset ? "New projection" : "Old projection", preview: "Safe text", display: {} }], nextCursor: reset ? null : 100, revision: reset ? "new" : "old", reset: reset && query.get("revision") === "old" } });
  });
  await page.goto(origin + "/job-runs/" + runId); await page.getByText("Old projection · assistant_message", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Next trace page" }).click(); await page.getByText("New projection · assistant_message", { exact: true }).waitFor();
  await page.waitForURL("**?after=0");
  assert.equal(await page.getByText("Old projection · assistant_message", { exact: true }).count(), 0);
  await page.waitForTimeout(2200); assert.ok(statusCalls >= 2);
  await context.close();
});

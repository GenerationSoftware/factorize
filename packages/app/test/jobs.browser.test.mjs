import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const jobId = "00000000-0000-4000-8000-000000000001", runId = "00000000-0000-4000-8000-000000000002";
const summary = { id: jobId, name: "Review builds", slug: "review-builds", enabled: true, runningCount: 0, concurrencyLimit: 2, lastRunState: null, model: "", effort: "", agentKind: "codex", createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://local").pathname;
    const file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html";
    try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function contextFor(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  page.setDefaultTimeout(10000);
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  return { context, page };
}
for (const width of [1280, 390, 320]) for (const theme of ["light", "dark"]) test(`compact jobs grouping, pagination, focus and long titles at ${width} ${theme}`, async () => {
  const { page, context } = await contextFor({ viewport: { width, height: 844 }, colorScheme: theme });
  const longTitle = "Zulu " + "long title ".repeat(30);
  const fixtures = Array.from({ length: 31 }, (_, index) => ({ ...summary, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `Idle ${String(index).padStart(2, "0")}`, enabled: index % 2 === 0 }));
  fixtures[0] = { ...fixtures[0], name: longTitle, enabled: true, runningCount: 1, concurrencyLimit: 10 };
  fixtures[30] = { ...fixtures[30], name: "Alpha running", enabled: false, runningCount: 2, concurrencyLimit: 10 };
  const requests = [];
  await page.route("**/api/v1/job-summaries?**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { items: url.searchParams.has("cursor") ? fixtures.slice(30) : fixtures.slice(0, 30), nextCursor: url.searchParams.has("cursor") ? null : fixtures[29].id } });
  });
  await page.route(`**/api/v1/jobs/${fixtures[30].id}`, route => route.fulfill({ json: { ...fixtures[30], promptTemplate: "Template", runNameTemplate: "", executionTargetId: "local", executionTarget: { connectionId: "local", workspace: "ephemeral", cwd: "/workspace", agentKind: "codex" }, triggers: [], currentRuns: 2, maxConcurrency: 10 } }));
  await page.goto(origin + "/jobs?q=Review");
  const table = page.getByRole("table", { name: "Jobs", exact: true });
  await table.getByRole("link", { name: "Alpha running", exact: true }).waitFor();
  assert.deepEqual(await table.locator("thead th").allTextContents(), ["Status", "Running", "Title"]);
  assert.deepEqual(await table.locator("tbody td:last-child").allTextContents(), ["Alpha running", longTitle, ...fixtures.slice(1, 29).map(job => job.name)]);
  assert.deepEqual(await table.locator("tbody tr").first().locator("td").allTextContents(), ["Disabled", "2/10", "Alpha running"]);
  assert.deepEqual(await table.locator("tbody tr").nth(2).locator("td").allTextContents(), ["Disabled", "0/2", "Idle 01"]);
  assert.equal(await page.getByLabel("Search jobs", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Your software factory. Configure prompts, connect triggers, and follow every run.").count(), 0);
  const heading = await page.getByRole("heading", { name: "Jobs", exact: true }).boundingBox(), create = await page.getByRole("link", { name: "Create job", exact: true }).boundingBox();
  assert.ok(create.x > heading.x + heading.width && Math.abs(create.y - heading.y) < 12);
  const longLink = table.getByRole("link", { name: longTitle, exact: true });
  assert.equal(await longLink.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).whiteSpace === "nowrap"), true);
  const first = table.locator("tbody tr").first(), idleColor = await first.evaluate(el => getComputedStyle(el).backgroundColor);
  await first.hover(); await page.waitForFunction(() => getComputedStyle(document.querySelector("tbody tr")).backgroundColor !== "rgba(0, 0, 0, 0)"); assert.notEqual(await first.evaluate(el => getComputedStyle(el).backgroundColor), idleColor);
  await page.mouse.move(0, 0); const link = first.getByRole("link"); await link.focus();
  assert.equal(await link.evaluate(el => el === document.activeElement), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("tbody tr")).backgroundColor !== "rgba(0, 0, 0, 0)");
  assert.notEqual(await first.evaluate(el => getComputedStyle(el).backgroundColor), idleColor);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("link", { name: "Next page" }).click(); await table.getByRole("link", { name: "Idle 29", exact: true }).waitFor();
  await page.reload(); await table.getByRole("link", { name: "Idle 29", exact: true }).waitFor();
  await page.getByRole("link", { name: "First page" }).click(); await table.getByRole("link", { name: "Alpha running", exact: true }).waitFor();
  assert.ok(requests.every(url => url.searchParams.get("limit") === "100" && url.searchParams.get("q") === "Review"));
  await table.getByRole("link", { name: "Alpha running", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.waitForURL(`**/jobs/${fixtures[30].id}`);
  await page.getByRole("heading", { name: "Alpha running", exact: true }).waitFor();
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
  await page.getByRole("button", { name: "Run job", exact: true }).click();
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
test("20k-event continuous trace keeps DOM bounded, retains expanded details on scroll and resets generations", async () => {
  const { page, context } = await contextFor(); let revision = "large", traceRequests = 0, peakNodes = 0; const started = performance.now();
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, job_id: jobId, job_name: "Review builds", run_name: "Large trace", state: "succeeded", finalizing: true, trace_revision: revision, artifact_state: "stored", created_at: summary.createdAt, updated_at: summary.updatedAt, started_at: null, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    traceRequests++; const query = new URL(route.request().url()).searchParams, reset = !!query.get("revision") && query.get("revision") !== revision, after = reset ? 0 : Number(query.get("after") || 0), limit = Number(query.get("limit")), count = revision === "large" ? 20000 : 1;
    return route.fulfill({ json: { items: Array.from({ length: Math.min(limit, count - after) }, (_, index) => ({ id: `${revision}-${after + index + 1}`, sequence: after + index + 1, type: "assistant_message", title: `${revision} event ${after + index + 1}`, preview: "Safe text", display: {} })), nextCursor: after + limit < count ? after + limit : null, revision, reset } });
  });
  await page.goto(origin + "/job-runs/" + runId); await page.getByLabel("Continuous virtualized trace").check();
  const region = page.getByRole("region", { name: "Continuous trace", exact: true });
  await page.getByText("large event 1 · assistant_message", { exact: true }).waitFor(); await page.getByText("large event 1 · assistant_message", { exact: true }).click();
  for (let count = 400; count <= 20000; count += 200) {
    await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.getByRole("status").filter({ hasText: `${count} events loaded` }).waitFor();
    peakNodes = Math.max(peakNodes, await region.locator("li").count());
  }
  assert.ok(await region.locator("li").count() < 60); assert.ok(traceRequests <= 110);
  await region.evaluate(el => { el.scrollTop = 0; }); await page.getByText("large event 1 · assistant_message", { exact: true }).waitFor(); assert.equal(await region.locator("details").first().getAttribute("open"), "");
  const firstSummary = page.getByText("large event 1 · assistant_message", { exact: true });
  await firstSummary.focus(); await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.equal(await firstSummary.evaluate(el => el === document.activeElement), true);
  assert.ok(await region.locator("li").count() < 60);
  await region.evaluate(el => { el.scrollTop = 0; }); await firstSummary.waitFor();
  await region.locator("li[data-index='0'] .trace-content p").evaluate(el => window.getSelection().selectAllChildren(el));
  await region.focus(); await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "Safe text");
  assert.equal(await page.evaluate(() => window.getSelection().anchorNode.isConnected), true);
  assert.ok(await region.locator("li").count() < 60);
  await page.evaluate(() => window.getSelection().removeAllRanges());

  const loadMs = performance.now() - started, loadedRequests = traceRequests;
  revision = "replayed";
  await page.getByText("replayed event 1 · assistant_message", { exact: true }).waitFor(); assert.equal(await page.getByText("large event 1 · assistant_message", { exact: true }).count(), 0);
  if (process.env.GEN_2157_RECORD_TRACE) await writeFile(new URL("../../api/performance/gen-2157-trace-browser.json", import.meta.url), JSON.stringify({ date: "2026-10-09", browser: browser.version(), fixtureEvents: 20000, traceRequests: loadedRequests, peakMountedEvents: peakNodes, loadAllPagesMs: Number(loadMs.toFixed(2)), expandedStatePreserved: true, liveRevisionResetObserved: true, scope: "One compiled-SPA Chromium sample with mocked HTTP trace pages, includes Playwright scrolling and selector waits; no production network/DB or frame-time claim." }, null, 2) + "\n"); await context.close();
});

test("job Runs tab paginates distinct records, supports refresh/back and keeps configuration in Settings on mobile", async () => {
  const { page, context } = await contextFor({ viewport: { width: 390, height: 844 } });
  await page.route(`**/api/v1/jobs/${jobId}`, route => route.fulfill({ json: { ...summary, promptTemplate: "Private template", runNameTemplate: "", executionTargetId: "local", triggers: [] } }));
  const cursors = [];
  await page.route("**/api/v1/runs?**", route => {
    const url = new URL(route.request().url()), cursor = url.searchParams.get("cursor"); cursors.push(cursor);
    assert.equal(url.searchParams.get("jobId"), jobId); assert.equal(url.searchParams.get("limit"), "30");
    assert.equal(url.searchParams.has("state"), false); assert.equal(url.searchParams.has("contextQuery"), false);
    const offset = cursor === "page-3" ? 60 : cursor === "page-2" ? 30 : 0;
    return route.fulfill({ json: { items: Array.from({ length: offset === 60 ? 1 : 30 }, (_, i) => ({ id: `run-${offset + i}`, run_name: `Record ${offset + i}`, state: "succeeded", created_at: summary.createdAt, agent_kind: "codex" })), nextCursor: offset === 60 ? null : offset === 30 ? "page-3" : "page-2" } });
  });
  await page.goto(origin + `/jobs/${jobId}?state=failed&contextQuery=old`);
  await page.getByRole("link", { name: "Record 0", exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Job views" }).getByRole("link", { name: "Runs", exact: true }).getAttribute("aria-current"), "page");
  const activeTab = page.getByRole("navigation", { name: "Job views" }).getByRole("link", { name: "Runs", exact: true });
  assert.deepEqual(await activeTab.evaluate(el => { const css = getComputedStyle(el); return [css.borderBottomWidth, css.borderBottomStyle, css.borderBottomColor]; }), ["2px", "solid", "rgb(253, 201, 1)"]);
  assert.equal(await page.getByRole("table").locator("tbody tr").count(), 30);
  assert.equal(await page.getByText("Prompt template", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Triggers", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Delete job", exact: true }).count(), 0);
  assert.equal(await page.getByRole("textbox").count(), 0);
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await page.getByRole("link", { name: "Record 30", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Record 0", exact: true }).count(), 0);
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await page.getByRole("link", { name: "Record 60", exact: true }).waitFor();
  await page.reload(); await page.getByRole("link", { name: "Record 60", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Next page", exact: true }).isDisabled(), true);
  await page.getByRole("link", { name: "Previous page", exact: true }).click(); await page.getByRole("link", { name: "Record 30", exact: true }).waitFor();
  await page.getByRole("link", { name: "Previous page", exact: true }).click(); await page.getByRole("link", { name: "Record 0", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const region = page.getByRole("region", { name: "Runs table" }); await region.focus(); assert.equal(await region.evaluate(el => el === document.activeElement), true);
  assert.ok(cursors.includes("page-2") && cursors.includes("page-3"));
  await context.close();
});

test("run table headers sort every column accessibly and persist in the URL", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/jobs/${jobId}`, route => route.fulfill({ json: { ...summary, promptTemplate: "Template", executionTargetId: "local", triggers: [] } }));
  const requests = [];
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); return route.fulfill({ json: { items: [{ id: runId, run_name: "Run", issue_title: "", state: "succeeded", created_at: summary.createdAt, agent_kind: "codex" }], nextCursor: null } }); });
  await page.goto(origin + `/jobs/${jobId}`);
  const table = page.getByRole("table");
  for (const label of ["Run", "Status", "Created", "Agent"]) assert.equal(await table.getByRole("columnheader", { name: new RegExp(`^${label}` }).getByRole("button").count(), 1);
  const runHeader = table.getByRole("button", { name: /Run, not sorted/ });
  await runHeader.focus(); await page.keyboard.press("Enter"); await page.waitForURL(`**/jobs/${jobId}?sort=run&direction=asc`);
  assert.equal(await table.getByRole("columnheader", { name: /Run/ }).getAttribute("aria-sort"), "ascending");
  await table.getByRole("button", { name: /Run, sorted ascending/ }).click(); await page.waitForURL(`**/jobs/${jobId}?sort=run&direction=desc`);
  assert.equal(requests.at(-1).searchParams.get("direction"), "desc");
  await context.close();
});

test("job with no runs has an empty table and disabled pagination", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/jobs/${jobId}`, route => route.fulfill({ json: { ...summary, promptTemplate: "Template", executionTargetId: "local", triggers: [] } }));
  await page.goto(origin + `/jobs/${jobId}`); await page.getByRole("cell", { name: "No runs found." }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Previous page", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Next page", exact: true }).isDisabled(), true);
  await context.close();
});

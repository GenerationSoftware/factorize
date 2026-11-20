import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const triggerId = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000003", runId = "00000000-0000-4000-8000-000000000002", time = "2026-10-09T12:00:00Z";
const siblingRunId = "00000000-0000-4000-8000-000000000004";
before(async () => { server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup(locale = "en-US") { const context = await browser.newContext({ locale }), page = await context.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("individual run uses team navigation and retains its run switcher", async () => {
  const { context, page } = await setup();
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Project run", state: "succeeded", finalizing: false, trace_revision: "rev", artifact_state: "stored", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${siblingRunId}/status`, route => route.fulfill({ json: { id: siblingRunId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Sibling run", state: "succeeded", finalizing: false, trace_revision: "rev", artifact_state: "stored", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [{ id: runId, run_name: "Project run" }, { id: siblingRunId, run_name: "Sibling run" }], nextCursor: null } }));
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { id: triggerId, name: "Review builds", projectId, enabled: true, model: "", agentKind: "codex", concurrencyLimit: 1, runningCount: 0, prompt: "Prompt", events: [] } }));
  await page.route(`**/api/v1/projects/${projectId}`, route => route.fulfill({ json: { id: projectId, name: "Release project", description: "", triggerCount: 1 } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [], nextCursor: null, revision: "rev", reset: false } }));
  await page.goto(origin + `/runs/${runId}`);
  const nav = page.getByRole("navigation", { name: "Dashboard navigation" });
  await nav.getByRole("link", { name: "Runs", exact: true }).waitFor();
  assert.equal(await nav.getByRole("link", { name: "Runs", exact: true }).getAttribute("aria-current"), "page");
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  await mainNav.getByRole("link", { name: "Workspace", exact: true }).waitFor();
  assert.equal(await mainNav.getByRole("link",{name:"Review builds",exact:true}).count(),0);
  await page.getByRole("button", { name: "Switch run" }).click();
  await page.getByRole("option", { name: /Project run.*Current/ }).waitFor();
  await page.getByRole("option", { name: "Sibling run" }).click();
  await page.waitForURL(new RegExp(siblingRunId));
  assert.equal(await page.getByRole("navigation", { name: "Breadcrumb" }).count(), 0);
  await context.close();
});
test("an expired run shows a missing state, stops polling, and never loads retained details", async () => {
  const { context, page } = await setup(); let statusReads = 0, detailReads = 0, traceReads = 0;
  await page.clock.install({ time: new Date(time) });
  await page.route(`**/api/v1/runs/${runId}/status`, route => { statusReads++; return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found" } } }); });
  await page.route(`**/api/v1/runs/${runId}`, route => { detailReads++; return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found" } } }); });
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => { traceReads++; return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found" } } }); });
  await page.goto(origin + `/runs/${runId}`);
  await page.getByRole("alert").filter({ hasText: "This run is no longer available" }).waitFor();
  const readsAtMissingState = statusReads;
  await page.clock.runFor(30_000);
  assert.equal(statusReads, readsAtMissingState, "a definitive 404 must not poll again");
  assert.equal(detailReads, 0, "an expired run must not load prompt or provenance data");
  assert.equal(traceReads, 0, "an expired run must not load trace data");
  await context.close();
});
test("run page polling backs off when idle, discovers runs, and stays fast while active", async () => {
  const idle = await setup(); let idleCount = 0;
  await idle.page.clock.install({ time: new Date(time) });
  await idle.page.route("**/api/v1/runs?**", route => { idleCount++; const state = idleCount > 1 ? "running" : "succeeded"; return route.fulfill({ json: { items: [{ id: runId, run_name: "Polling run", state, created_at: time, agent_kind: "codex" }], nextCursor: null } }); });
  await idle.page.goto(origin + "/runs"); await idle.page.getByRole("link", { name: "Polling run", exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(idleCount, 1, "loader data should be reused when the list component mounts");
  await idle.page.clock.runFor(4100); assert.equal(idleCount, 1, "an idle page should make one request in the fixed comparison window");
  await idle.page.clock.runFor(10_900); await idle.page.getByRole("img", { name: "Status: Running" }).waitFor(); assert.equal(idleCount, 2, "idle polling should discover a newly created run within 15 seconds");
  await idle.context.close();

  const active = await setup(); let activeCount = 0;
  await active.page.route("**/api/v1/runs?**", route => { activeCount++; return route.fulfill({ json: { items: [{ id: runId, run_name: "Polling run", state: "running", created_at: time, agent_kind: "codex" }], nextCursor: null } }); });
  await active.page.goto(origin + "/runs"); await active.page.getByRole("link", { name: "Polling run", exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(activeCount, 1, "active loader data should also be reused on mount");
  await new Promise(resolve => setTimeout(resolve, 4100)); assert.equal(activeCount, 3, "active rows should make three requests in the same 4.1-second window");
  await active.context.close();
});
test("run page errors back off for ten seconds and recover", async () => {
  const { context, page } = await setup(); let count = 0;
  await page.clock.install({ time: new Date(time) });
  await page.route("**/api/v1/runs?**", route => {
    count++;
    if (count === 1 || count >= 4) return route.fulfill({ json: { items: [{ id: runId, run_name: "Polling run", state: "succeeded", created_at: time, agent_kind: "codex" }], nextCursor: null } });
    return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Try again" } } });
  });
  await page.goto(origin + "/runs"); await page.getByRole("link", { name: "Polling run", exact: true }).waitFor();
  await page.clock.runFor(16_100); await page.getByRole("alert").filter({ hasText: "Try again" }).waitFor();
  assert.equal(count, 3, "the idle refetch and its single retry should expose an error");
  await page.clock.runFor(9000); assert.equal(count, 3, "errors should wait about ten seconds before another query");
  const recoveredResponse = page.waitForResponse(response => response.url().includes("/api/v1/runs?") && response.status() === 200);
  for (let elapsed = 0; count < 4 && elapsed < 2000; elapsed++) await page.clock.runFor(1);
  await recoveredResponse; await page.getByRole("link", { name: "Polling run", exact: true }).waitFor(); await page.getByRole("alert").waitFor({ state: "detached" }); assert.equal(count, 4, "the ten-second error interval should retry and recover");
  await page.clock.runFor(12_000); assert.equal(count, 4, "a successful response should return to the 15-second idle interval");
  const idleRefetch = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/runs");
  await page.clock.runFor(10_000); await idleRefetch; assert.equal(count, 5, "the idle interval should refresh after about 15 seconds");
  await context.close();
});
test("all-triggers runs index uses a tenant-scoped page, navigation, refresh, and created time", async () => {
  const { context, page } = await setup(); const requests = []; let refreshes = 0;
const runs = Array.from({ length: 21 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, project_id: projectId, project_name: "Project Alpha", trigger_id: triggerId, trigger_name: "Review builds", run_name: `Run ${index}`, state: index === 0 ? "running" : "succeeded", created_at: time, updated_at: time, started_at: index === 0 ? time : null, agent_kind: "codex", elapsed_time: index === 0 ? { low: 60, high: 180 } : { duration: 120 } }));
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); refreshes++; const second = url.searchParams.has("cursor"); return route.fulfill({ json: { items: second ? [runs[20]] : runs.slice(0, 20), nextCursor: second ? null : "page-2" } }); });
  await page.goto(origin + "/runs"); await page.getByRole("heading", { name: "Runs", exact: true }).waitFor(); await page.getByRole("link", { name: "Run 0", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Triggers", exact: true }).count(), 0); assert.equal(await page.getByRole("link", { name: "Skills", exact: true }).count(),1); assert.equal(await page.getByRole("link", { name: "Runs", exact: true }).count(), 1);
  const table = page.getByRole("table"); await table.getByRole("columnheader",{name:"Prompt",exact:true}).waitFor();
 assert.deepEqual(await table.locator("thead th").allTextContents(), ["Status", "Source", "Run", "Prompt", "Elapsed", "Created"]); assert.equal(await page.getByText("Run 0", { exact: true }).count(), 1); assert.equal(await page.getByText("1m–3m", { exact: true }).count(), 1); assert.equal(await page.getByText("2m", { exact: true }).count(), 19); assert.equal(await page.getByRole("link", { name: "Project Alpha", exact: true }).count(), 0); assert.equal(await page.locator("td time").count(), 20); assert.equal(await page.locator("td time").first().getAttribute("datetime"), time);
  const firstRowCells = await table.locator("tbody tr").first().locator("td").all(); const elapsedBox = await firstRowCells[3].boundingBox(); const createdBox = await firstRowCells[4].boundingBox(); assert.ok(elapsedBox && createdBox && elapsedBox.x + elapsedBox.width <= createdBox.x, "Elapsed and Created columns must not overlap");
  assert.ok(requests.every(url => url.searchParams.get("limit") === "20" && !url.searchParams.has("triggerId")));
  await page.getByRole("link", { name: "Next page" }).click(); await page.getByRole("link", { name: "Run 20", exact: true }).waitFor(); await page.reload(); await page.getByRole("link", { name: "Run 20", exact: true }).waitFor(); assert.ok(refreshes >= 2);
  await context.close();
});
test("all-runs table sorts its data columns with accessible headers", async () => {
  const { context, page } = await setup(); const requests = [];
  const runs = [{ id: runId, run_name: "Run", state: "succeeded", created_at: time, updated_at: time, started_at: null, agent_kind: "codex" }];
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); return route.fulfill({ json: { items: runs, nextCursor: null } }); });
  await page.goto(origin + "/runs"); const table = page.getByRole("region", { name: "Trigger runs table" });
  const created = table.getByRole("button", { name: /Created/ }); await created.focus(); await page.keyboard.press("Enter"); await page.waitForURL("**/runs?sort=created&direction=asc");
  await page.waitForFunction(() => document.querySelector('th[aria-sort="ascending"]')?.textContent?.includes("Created"));
  assert.equal(await table.getByRole("columnheader", { name: /Created/ }).getAttribute("aria-sort"), "ascending"); assert.equal(requests.at(-1).searchParams.get("sort"), "created");
  await table.getByRole("button", { name: /Created/ }).click(); await page.waitForURL("**/runs?sort=created&direction=desc");
  await page.waitForFunction(() => document.querySelector('th[aria-sort="descending"]')?.textContent?.includes("Created"));
  assert.equal(await table.getByRole("columnheader", { name: /Created/ }).getAttribute("aria-sort"), "descending");
  await context.close();
});
test("all-runs status header supports multi-select filtering, independent sorting and clearing", async () => {
  const { context, page } = await setup(); const requests = [];
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); const states = url.searchParams.getAll("state"); return route.fulfill({ json: { items: states.length ? states.map((state, index) => ({ id: `${runId}-${index}`, run_name: `${state} run`, state, created_at: time, agent_kind: "codex" })) : [{ id: runId, run_name: "Run", state: "succeeded", created_at: time, agent_kind: "codex" }], nextCursor: null } }); });
  await page.goto(origin + "/runs"); const header = page.getByRole("button", { name: /Status, all statuses/ }); await header.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Status filter and sort" }); await dialog.getByLabel("Failed").click({ noWaitAfter: true }); await page.waitForFunction(() => location.search.includes("state") || location.search.includes("states")); assert.equal(await dialog.isVisible(), true); await page.getByRole("dialog", { name: "Status filter and sort" }).getByLabel("Stopped").click({ noWaitAfter: true }); assert.equal(await dialog.isVisible(), true); await page.getByRole("dialog", { name: "Status filter and sort" }).getByRole("button", { name: "Ascending" }).click();
  await page.waitForFunction(() => location.search.includes("sort=status") && location.search.includes("direction=asc")); await page.waitForTimeout(250); assert.deepEqual(requests.find(url => url.searchParams.getAll("state").length === 2)?.searchParams.getAll("state").sort(), ["failed", "stopped"]); assert.equal(await page.getByRole("columnheader", { name: /Status/ }).getAttribute("aria-sort"), "ascending");
  assert.equal(await page.getByRole("link", { name: "failed run", exact: true }).count(), 1); assert.equal(await page.getByRole("link", { name: "stopped run", exact: true }).count(), 1); assert.equal(await page.getByRole("button", { name: /Status, 2 statuses selected/ }).evaluate(button => getComputedStyle(button.parentElement).zIndex), "auto");
  await page.mouse.click(1200, 700);
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /Status, 2 statuses selected/ }).click();
  const requestCountBeforeClear = requests.length;
  await page.getByRole("dialog", { name: "Status filter and sort" }).getByRole("button", { name: "Clear filters and reset sort" }).click(); await page.waitForFunction(() => { const params = new URLSearchParams(location.search); return location.pathname === "/runs" && !params.has("state") && !params.has("states") && !params.has("sort") && !params.has("direction"); });
  await page.getByRole("link", { name: "Run", exact: true }).waitFor();
  assert.ok(requests.slice(requestCountBeforeClear).every(url => !url.searchParams.has("state") && !url.searchParams.has("states")), "clearing filters must not issue a request with stale status filters");
  assert.ok(requests.some(url => url.pathname === "/api/v1/runs" && !url.searchParams.has("state") && !url.searchParams.has("states")), "clearing filters should fetch the unfiltered run list"); await context.close();
});
test("shared run status dots show running transitions in both tables", async () => {
  const { context, page } = await setup(); let state = "running", failure = null;
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { id: triggerId, name: "Trigger", enabled: true, model: "", agentKind: "codex", concurrencyLimit: 1, runningCount: state === "running" ? 1 : 0, prompt: "Prompt", events: [] } }));
  await page.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [{ id: runId, run_name: "Transition run", state, failure, created_at: time, agent_kind: "codex" }], nextCursor: null } }));
  await page.goto(origin + "/runs"); await page.getByRole("img", { name: "Status: Running" }).waitFor();
  assert.match(await page.getByRole("img", { name: "Status: Running" }).getAttribute("class"), /animate-pulse/);
  state = "succeeded"; await page.reload(); await page.getByRole("img", { name: "Status: Succeeded" }).waitFor();
  assert.doesNotMatch(await page.getByRole("img", { name: "Status: Succeeded" }).getAttribute("class"), /animate-pulse/);
  state = "failed"; await page.goto(origin + `/triggers/${triggerId}`); await page.getByRole("img", { name: "Status: Failed" }).waitFor();
  assert.doesNotMatch(await page.getByRole("img", { name: "Status: Failed" }).getAttribute("class"), /animate-pulse/);
  failure = { source: "run", code: "task_reported_failure", reason: "test assertion failed" }; await page.goto(origin + "/runs"); await page.getByRole("img", { name: "Status: Run failed" }).waitFor();
  failure = { source: "system", code: "vm_unavailable", reason: "VM unavailable" }; await page.reload(); await page.getByRole("img", { name: "Status: System failed" }).waitFor(); await context.close();
});
test("run detail exposes the primary failure and keeps artifact warnings separate", async () => {
  const { context, page } = await setup();
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Failed run", state: "failed", failure_source: "agent", failure: { source: "run", code: "result_invalid", reason: "Required result JSON was invalid" }, finalizing: false, trace_revision: "rev", artifact_state: "partial", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [], nextCursor: null, revision: "rev", reset: false } }));
  await page.route(`**/api/v1/runs/${runId}`, route => route.fulfill({ json: { prompt: "Prompt", invocation: { source: "manual", context: {}, event_id: "event-fixture", created_at: time }, activity: [] } }));
  await page.route(`**/api/v1/runs/${runId}/diagnostics`, route => route.fulfill({ json: { state: "failed", artifact: { state: "partial", error: "Trace collection also failed" }, execution: { detail: "Process exited successfully" } } }));
  await page.goto(origin + "/runs/" + runId);
  await page.getByRole("status").filter({ hasText: "Run failed" }).waitFor();
  await page.getByText("Required result JSON was invalid", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Info", exact: true }).click();
  await page.getByText("Diagnostics and artifacts", { exact: true }).click();
  await page.getByText(/Trace collection also failed/).waitFor();
  assert.equal(await page.getByRole("status").getByText(/Trace collection also failed/).count(), 0);
  await context.close();
});
test("trigger run history restores its cursor on direct refresh and ignores legacy filters", async () => {
  const { context, page } = await setup(); const requests = [];
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { id: triggerId, name: "Trigger", enabled: true, model: "", agentKind: "codex", concurrencyLimit: 1, runningCount: 0, prompt: "Prompt", events: [] } }));
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); return route.fulfill({ json: { items: [{ id: runId, run_name: url.searchParams.has("cursor") ? "Second run" : "First run", state: "succeeded", created_at: time, agent_kind: "codex" }], nextCursor: url.searchParams.has("cursor") ? null : "next-cursor" } }); });
  await page.goto(origin + `/triggers/${triggerId}?state=succeeded&contextQuery=needle`); await page.getByRole("link", { name: "First run", exact: true }).waitFor(); await page.getByRole("link", { name: "Next page" }).click(); await page.getByRole("link", { name: "Second run", exact: true }).waitFor(); await page.reload(); await page.getByRole("link", { name: "Second run", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("cursor"), "next-cursor"); assert.ok(requests.every(url => url.searchParams.get("triggerId") === triggerId && url.searchParams.get("limit") === "30" && !url.searchParams.has("contextQuery") && !url.searchParams.has("state"))); await context.close();
});
test("trigger run history keeps the table visible while sorting and puts status first", async () => {
  const { context, page } = await setup(); let releaseSorted; const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const sorted = new Promise(resolve => { releaseSorted = resolve; });
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { id: triggerId, name: "Trigger", enabled: true, model: "", agentKind: "codex", concurrencyLimit: 1, runningCount: 0, prompt: "Prompt", events: [] } }));
  await page.route("**/api/v1/runs?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("sort")) { await sorted; return route.fulfill({ json: { items: [{ id: runId, run_name: "Sorted run", state: "failed", created_at: createdAt, agent_kind: "codex" }], nextCursor: null } }); }
    return route.fulfill({ json: { items: [{ id: runId, run_name: "Initial run", state: "succeeded", created_at: createdAt, agent_kind: "codex" }], nextCursor: null } });
  });
  await page.goto(origin + `/triggers/${triggerId}`); const table = page.getByRole("region", { name: "Runs table" });
  await table.getByRole("link", { name: "Initial run", exact: true }).waitFor();
  assert.equal(await table.locator("thead th").first().textContent(), "Status");
  assert.equal(await table.getByRole("columnheader", { name: "Execution" }).count(), 0);
  assert.equal(await table.getByRole("columnheader", { name: "Created" }).count(), 1);
  await table.getByText("5 minutes ago", { exact: true }).waitFor();
  await table.getByRole("button", { name: /Run, not sorted/ }).click(); await page.waitForURL(`**/triggers/${triggerId}?sort=run&direction=asc`);
  assert.equal(await page.getByText("Loading run history…", { exact: true }).count(), 0);
  assert.equal(await table.getByRole("link", { name: "Initial run", exact: true }).count(), 1);
  releaseSorted(); await table.getByRole("link", { name: "Sorted run", exact: true }).waitFor(); await context.close();
});
test("prompt/provenance and diagnostics are lazy, terminal replay retries reuse a stable key and reset the visible trace", async () => {
  const { context, page } = await setup(); let revision = "old", detailReads = 0, diagnosticReads = 0; const replays = [];
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Run", state: "succeeded", finalizing: false, trace_revision: revision, artifact_state: "stored", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [{ id: revision, sequence: 1, type: "assistant_message", title: revision === "old" ? "Old trace" : "Replayed trace", preview: "# Safe message\n[unsafe](javascript:alert(1))\n<script>alert(1)</script>", display: {} }], nextCursor: null, revision, reset: false } }));
  await page.route(`**/api/v1/runs/${runId}`, route => { detailReads++; return route.fulfill({ json: { prompt: "Private prompt", invocation: { source: "manual", context: { build: 42 }, event_id: "event-fixture", created_at: time, occurrence: { delivery: "fixture" } }, activity: [{ action: "started", detail: "Launched", created_at: time }] } }); });
  await page.route(`**/api/v1/runs/${runId}/diagnostics`, route => { diagnosticReads++; return route.fulfill({ json: { state: "succeeded", artifact: { state: "stored" }, harnessLog: { object_key: "retained/log.txt" }, execution: { detail: "Safe diagnostic" } } }); });
  await page.route(`**/api/v1/runs/${runId}/trace/replay`, route => { replays.push(route.request().postDataJSON()); if (replays.length === 1) return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Retry replay" } } }); revision = "new"; return route.fulfill({ json: { status: "projected" } }); });
  await page.goto(origin + "/runs/" + runId); await page.getByText("Safe message", { exact: true }).waitFor(); assert.equal(detailReads, 0); assert.equal(diagnosticReads, 0);
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0); assert.equal(await page.locator("main script").count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Trace", exact: true }).getAttribute("aria-selected"), "true");
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  assert.equal(await breadcrumbs.getByRole("link", { name: "Trigger", exact: true }).count(), 0);
  await page.getByRole("tab", { name: "Info", exact: true }).click();
  await page.getByText("Created", { exact: true }).waitFor(); await page.getByText("Started", { exact: true }).waitFor(); await page.getByText("Queue time", { exact: true }).waitFor(); await page.getByText("Runtime", { exact: true }).waitFor(); await page.getByText("Execution destination", { exact: true }).waitFor();
  await page.getByText("Prompt, context and provenance", { exact: true }).click(); await page.getByText("Private prompt", { exact: true }).waitFor(); await page.getByText("event-fixture", { exact: true }).waitFor(); await page.getByRole("heading", { name: "Event context and occurrence" }).waitFor(); await page.getByText("Diagnostics and artifacts", { exact: true }).click(); await page.getByText(/retained\/log.txt/).waitFor(); assert.equal(detailReads, 1); assert.equal(diagnosticReads, 1);
  await page.getByRole("tab", { name: "Info", exact: true }).click();
  await page.getByText("Replay trace", { exact: true }).click(); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Replay retained trace" }).click(); await page.getByRole("alert").filter({ hasText: "Retry replay" }).waitFor(); await page.getByRole("tab", { name: "Trace", exact: true }).click(); await page.getByRole("tab", { name: "Info", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Retry replay" }).waitFor(); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Replay retained trace" }).click(); await page.getByRole("status").filter({ hasText: "Trace replay completed." }).waitFor(); assert.equal(await page.getByText("projected", { exact: true }).count(), 0); await page.getByRole("tab", { name: "Trace", exact: true }).click(); await page.getByText("Safe message", { exact: true }).waitFor();
  assert.equal(replays[0].requestId, replays[1].requestId); await context.close();
});
test("stopping a run submits once, observes stopping state and keeps terminal finalization visible", async () => {
  const { context, page } = await setup(); let state = "running", stops = 0, releaseStop; const pendingStop = new Promise(resolve => { releaseStop = resolve; });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Run", state, finalizing: state === "stopped", trace_revision: "rev", artifact_state: "collecting", created_at: time, updated_at: time, started_at: time, destination_url: "https://example.test/run" } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [{ id: "command", sequence: 1, type: "command", title: "Build command", preview: '\x1b[31m<script>untrusted</script>\x1b[0m', display: {} }], nextCursor: null, revision: "rev", reset: false } }));
  await page.route(`**/api/v1/runs/${runId}/stop`, async route => { stops++; state = "stopping"; await pendingStop; return route.fulfill({ json: { state } }); });
  await page.goto(origin + "/runs/" + runId); assert.equal(await page.getByText("<script>untrusted</script>", { exact: true }).count(), 0); assert.equal(await page.locator("main script").count(), 0);
  await page.getByRole("button", { name: "Stop run", exact: true }).click(); await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Stop run" && button.disabled)); releaseStop();
  await page.getByRole("status").filter({ hasText: /^stopping$/ }).waitFor(); assert.equal(stops, 1); state = "stopped";
  await page.getByText("stopped · Finalizing trace and artifacts", { exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Stop run", exact: true }).count(), 0);
  await context.close();
});
test("run rename supports keyboard save and cancel, validates names, and preserves drafts during polling", async () => {
  const { context, page } = await setup(); let name = "Original run", saves = [];
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: name, state: "running", finalizing: false, trace_revision: "rev", artifact_state: "pending", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [], nextCursor: null, revision: "rev", reset: false } }));
  await page.route(`**/api/v1/runs/${runId}`, route => route.request().method() === "PATCH" ? (saves.push(route.request().postDataJSON()), name = saves.at(-1).name, route.fulfill({ json: { run_name: name } })) : route.fulfill({ json: {} }));
  await page.goto(origin + "/runs/" + runId); await page.getByRole("heading", { name: "Original run", exact: true }).waitFor();
  await page.getByRole("button", { name: "Rename", exact: true }).click(); const input = page.getByRole("textbox", { name: "Run name" }); await input.fill("Draft survives polling"); await page.waitForTimeout(2200); assert.equal(await input.inputValue(), "Draft survives polling");
  await input.fill("   "); await page.keyboard.press("Enter"); await page.getByRole("alert").filter({ hasText: "between 1 and 120" }).waitFor(); assert.equal(saves.length, 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await page.getByRole("heading", { name: "Original run", exact: true }).waitFor();
  await page.getByRole("button", { name: "Rename", exact: true }).click(); await page.getByRole("textbox", { name: "Run name" }).fill("Escape cancel"); await page.keyboard.press("Escape"); await page.getByRole("heading", { name: "Original run", exact: true }).waitFor();
  await page.getByRole("button", { name: "Rename", exact: true }).click(); await page.getByRole("textbox", { name: "Run name" }).fill("Saved name"); await page.keyboard.press("Enter"); await page.getByRole("heading", { name: "Saved name", exact: true }).waitFor(); assert.deepEqual(saves, [{ name: "Saved name", expectedName: "Original run" }]);
  await page.reload(); await page.getByRole("heading", { name: "Saved name", exact: true }).waitFor(); await context.close();
});
test("running trace shows animated dots and polls forward from its latest event", async () => {
  const { context, page } = await setup(); const tailRequests = [];
  const inputEvent = sequence => ({ id: `live-${sequence}`, sequence, type: "assistant_message", title: `Live ${sequence}`, preview: `Live ${sequence}`, display: {} });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Live run", state: "running", finalizing: false, trace_revision: "live", artifact_state: "pending", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("after")) {
      const after = Number(query.get("after")); tailRequests.push(after);
      return route.fulfill({ json: { items: [inputEvent(after + 1)], nextCursor: null, previousCursor: null, revision: "live", reset: false } });
    }
    return route.fulfill({ json: { items: [inputEvent(1)], nextCursor: null, previousCursor: null, revision: "live", reset: false } });
  });
  await page.goto(origin + "/runs/" + runId + "/trace");
  const indicator = page.locator("[data-run-trace-live]"); await indicator.waitFor();
  assert.equal(await indicator.locator(".trace-live-dots > span").count(), 3);
  assert.equal(await indicator.locator(".trace-live-dots > span").first().evaluate(element => getComputedStyle(element).animationName), "trace-dot-pulse");
  await page.getByText("Live 3", { exact: true }).waitFor({ timeout: 7000 });
  assert.deepEqual(tailRequests.slice(0, 2), [1, 2], "each poll should request events after the latest displayed sequence");
  await context.close();
});
test("active trigger run preview refreshes recent activity without scrolling and shows Running at the bottom", async () => {
  const { context, page } = await setup(); const tailRequests = [];
  const inputEvent = sequence => ({ id: `preview-${sequence}`, sequence, type: "assistant_message", title: `Preview ${sequence}`, preview: `Preview ${sequence}`, display: {} });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Live preview", state: "running", finalizing: false, trace_revision: "preview", artifact_state: "pending", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("after")) {
      const after = Number(query.get("after")); tailRequests.push(after);
      return route.fulfill({ json: { items: [inputEvent(after + 1)], nextCursor: null, previousCursor: null, revision: "preview", reset: false } });
    }
    return route.fulfill({ json: { items: [inputEvent(1)], nextCursor: null, previousCursor: null, revision: "preview", reset: false } });
  });
  await page.goto(origin + "/runs/" + runId);
  const trace = page.locator("[data-run-trace-preview]");
  const indicator = trace.locator("[data-run-trace-live]");
  await indicator.waitFor();
  assert.equal(await indicator.locator(".trace-live-dots > span").count(), 3);
  assert.equal(await trace.locator("[data-run-trace-scroll]").count(), 0, "recent activity should not use the scrolling history trace");
  await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
  await page.getByText("Preview 3", { exact: true }).waitFor({ timeout: 7000 });
  assert.deepEqual(tailRequests.slice(0, 2), [1, 2], "preview polling should continue after the latest displayed sequence");
  assert.ok(await trace.getByText("Preview 3", { exact: true }).count());
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, "new activity should not auto-scroll the page through older entries");
  await context.close();
});
test("full run trace uses pull-to-load history, preserves the anchor, and never crashes on disclosure toggles", async () => {
  const { context, page } = await setup(); const requests = [];
  const inputEvent = (sequence, type = "assistant_message") => ({ id: `trace-${sequence}`, sequence, type, title: `Trace ${sequence}`, preview: `Trace ${sequence}`, display: {} });
  const longCommand = `start-${"x".repeat(5000)}-end`;
  const call = { ...inputEvent(25, "tool_call"), title: "bash", preview: JSON.stringify({ command: longCommand }), display: { arguments: { command: longCommand } } };
  const result = { ...inputEvent(26, "tool_result"), title: "bash", preview: `output-start-${"y".repeat(5000)}-output-end`, display: { isError: false } };
  const recent = [...Array.from({ length: 14 }, (_, index) => inputEvent(index + 11)), call, result];
  const olderPages = [Array.from({ length: 10 }, (_, index) => inputEvent(index + 1)), Array.from({ length: 10 }, (_, index) => inputEvent(index + 27)), Array.from({ length: 10 }, (_, index) => inputEvent(index + 37)), Array.from({ length: 10 }, (_, index) => inputEvent(index + 47)), Array.from({ length: 10 }, (_, index) => inputEvent(index + 57)), Array.from({ length: 10 }, (_, index) => inputEvent(index + 67))];
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Run", state: "succeeded", finalizing: false, trace_revision: "rev", artifact_state: "stored", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.has("before")) { const page = requests.filter(request => request.searchParams.has("before")).length - 1; return route.fulfill({ json: { items: olderPages[page], nextCursor: null, previousCursor: page < olderPages.length - 1 ? page + 1 : null, revision: "rev", reset: false } }); }
    if (url.searchParams.has("after")) return route.fulfill({ json: { items: [], nextCursor: null, previousCursor: null, revision: "rev", reset: false } });
    return route.fulfill({ json: { items: recent, nextCursor: null, previousCursor: 10, revision: "rev", reset: false } });
  });
  await page.goto(origin + "/runs/" + runId + "/trace"); const scroller = page.locator("[data-run-trace-scroll]");
  await page.getByText("Trace 24", { exact: true }).waitFor();
  const tracePanel = page.locator("#run-panel-trace");
  assert.equal(await tracePanel.locator(":scope > section").count(), 0, "trace should not contain a redundant nested section");
  assert.equal(await tracePanel.locator(":scope > [data-run-trace-scroll]").count(), 1, "trace viewport should belong directly to the tab panel");
  const presentation = await scroller.evaluate(element => { const style = getComputedStyle(element); return { border: style.borderWidth, radius: style.borderRadius, padding: style.padding }; });
  assert.equal(presentation.border, "0px"); assert.equal(presentation.radius, "0px"); assert.equal(presentation.padding, "0px");
  await page.getByText("1 Tool Call", { exact: true }).click();
  await page.getByRole("heading", { name: "bash", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Output", exact: true }).waitFor();
  assert.match(await page.getByLabel("bash command").textContent(), /^\{\n  "command": "start-/);
  assert.match(await page.getByLabel("bash command").textContent(), /\.\.\./);
  assert.match(await page.getByLabel("Tool output").textContent(), /^output-start-/);
  assert.match(await page.getByLabel("Tool output").textContent(), /\.\.\./);
  assert.equal(await page.getByText("Cannot read properties of null", { exact: false }).count(), 0);
  const initial = await scroller.evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight }));
  assert.ok(initial.height > initial.client && initial.top > 0, "initial trace should be bottom-aligned inside its own scroller");
  const before = await scroller.evaluate(element => element.scrollHeight);
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await new Promise(resolve => { const check = () => requests.filter(url => url.searchParams.has("before")).length >= 3 ? resolve() : setTimeout(check, 20); check(); });
  assert.equal(requests.filter(url => url.searchParams.has("before")).length, 3, "desktop top scroll should load history");
  await scroller.evaluate(element => { element.scrollTop = 0; const inputEvent = new Event("touchstart", { bubbles: true }); Object.defineProperty(inputEvent, "touches", { value: [{ clientY: 100 }] }); element.dispatchEvent(inputEvent); });
  await scroller.evaluate(element => { const inputEvent = new Event("touchmove", { bubbles: true }); Object.defineProperty(inputEvent, "touches", { value: [{ clientY: 180 }] }); element.dispatchEvent(inputEvent); });
  await scroller.evaluate(element => { const inputEvent = new Event("touchend", { bubbles: true }); Object.defineProperty(inputEvent, "touches", { value: [] }); element.dispatchEvent(inputEvent); });
  await new Promise(resolve => { const check = () => requests.filter(url => url.searchParams.has("before")).length >= 6 ? resolve() : setTimeout(check, 20); check(); });
  const after = await scroller.evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight }));
  assert.equal(requests.filter(url => url.searchParams.has("before")).length, 6, "a pull should load several history pages");
  assert.ok(after.top > 0 && after.height > before, "prepending history should preserve the visible anchor");
  await page.setViewportSize({ width: 900, height: 700 }); const shortHeight = await scroller.evaluate(element => element.clientHeight);
  await page.setViewportSize({ width: 900, height: 900 }); const tallHeight = await scroller.evaluate(element => element.clientHeight);
  assert.ok(tallHeight > shortHeight, "trace viewport should resize with the window");
  await page.setViewportSize({ width: 390, height: 700 });
  const mobilePresentation = await scroller.evaluate(element => { const style = getComputedStyle(element); return { border: style.borderWidth, radius: style.borderRadius, padding: style.padding }; });
  assert.equal(mobilePresentation.border, "0px"); assert.equal(mobilePresentation.radius, "0px"); assert.equal(mobilePresentation.padding, "0px");
  await context.close();
});
test("continuous trace virtualizes 20k groups, deduplicates IDs and mounts tool bodies on expansion", async () => {
  const { context, page } = await setup(); let traceRequests = 0;
  const inputEvents = Array.from({ length: 20000 }, (_, index) => ({ id: `large-${index + 1}`, sequence: index + 1, type: index === 100 ? "tool_call" : index === 101 ? "tool_result" : "assistant_message", title: index === 100 ? "bash" : `Event ${index + 1}`, preview: `Safe event ${index + 1}`, display: {} }));
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Trigger", run_name: "Large trace", state: "running", finalizing: false, trace_revision: "large", artifact_state: "pending", created_at: time, updated_at: time, started_at: time, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    traceRequests++; const query = new URL(route.request().url()).searchParams;
    if (query.has("after")) return route.fulfill({ json: { items: [{ ...inputEvents[19999], sequence: 20001, preview: "Duplicate should not replace first" }], nextCursor: null, revision: "large", reset: false } });
    return route.fulfill({ json: { items: [...inputEvents, { ...inputEvents[0], sequence: 20000, preview: "Duplicate ID" }], nextCursor: null, revision: "large", reset: false } });
  });
  const started = performance.now(); const tailResponse = page.waitForResponse(response => response.url().includes(`/api/v1/runs/${runId}/trace-pages`) && new URL(response.url()).searchParams.has("after")); await page.goto(origin + "/runs/" + runId + "/trace"); await tailResponse;
  await page.getByText("Safe event 20000", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-run-trace] [data-trace-index]').length > 0);
  const scroller = page.locator("[data-run-trace-scroll]");
  const profile = await page.locator("[data-run-trace]").evaluate(el => ({ groups: el.querySelectorAll(":scope > [data-trace-index]").length, events: el.querySelectorAll("article, details").length, totalHeight: el.scrollHeight }));
  assert.equal(await page.getByText("Safe event 1", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Duplicate should not replace first", { exact: true }).count(), 0);
  assert.ok(profile.groups < 60, `expected viewport sized group DOM, got ${profile.groups}`);
  assert.equal(profile.totalHeight > 20000, true);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  await page.getByText("Safe event 10000", { exact: true }).waitFor();
  assert.ok(await page.locator("[data-run-trace] [data-trace-index]").count() < 60);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.getByText("Safe event 1", { exact: true }).waitFor();
  assert.equal(await page.getByText("Safe event 1", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Duplicate ID", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Output", exact: true }).count(), 0, "collapsed tool disclosures must not mount event bodies");
  await scroller.evaluate(el => { el.scrollTop = 17700; });
  await page.waitForFunction(() => !!document.querySelector('[data-run-trace] [data-trace-index="100"]'));
  await page.getByText("1 Tool Call", { exact: true }).click();
  await page.getByRole("heading", { name: "Output", exact: true }).waitFor();
  assert.equal(traceRequests >= 1, true);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  const firstText = page.locator('[data-trace-index="0"] .trace-content p'); await firstText.waitFor();
  await firstText.evaluate(el => window.getSelection().selectAllChildren(el));
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "Safe event 1");
  assert.equal(await page.evaluate(() => window.getSelection().anchorNode.isConnected), true);
  await scroller.evaluate(el => { el.scrollTop = 17700; });
  const toolSummary = page.getByText("1 Tool Call", { exact: true }); await toolSummary.focus();
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  assert.equal(await toolSummary.evaluate(el => el === document.activeElement), true);
  assert.ok(await page.locator("[data-run-trace] [data-trace-index]").count() < 60);
  const elapsedMs = Number((performance.now() - started).toFixed(1));
  console.log(JSON.stringify({ fixtureEvents: 20000, mountedGroups: profile.groups, mountedEventBodies: profile.events, estimatedUnvirtualizedGroups: 20000, initialLoadAndScrollMs: elapsedMs, traceRequests }));
  await context.close();
});
test("run table metadata widths stay fixed across filters, pages, locale content, and viewport sizes", async () => {
  const { context, page } = await setup();
  const states = ["queued", "reserved", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "ignored", "done"];
  const longRunName = "A representative exceptionally long run name that must truncate within its shared Run column";
  const longFailure = "A long failure summary that must stay clipped to the Run column without pushing metadata aside";
  const fresh = new Date().toISOString();
  const old = "2020-01-02T15:04:00.000Z";
  await page.route("**/api/v1/projects", route => route.fulfill({ json: [{ id: projectId, name: "A very long representative project name", description: "", triggerCount: 1 }] }));
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [{ id: triggerId, name: "A very long representative trigger name", projectId, runningCount: 0 }], nextCursor: null } }));
  await page.route("**/api/v1/runs?**", route => {
    const url = new URL(route.request().url()), pageTwo = url.searchParams.has("cursor");
    const empty = url.searchParams.getAll("state").includes("ignored");
    const item = pageTwo
      ? { id: siblingRunId, run_name: longRunName, state: "failed", failure: { reason: longFailure }, elapsed_time: { low: 3599, high: 3720 }, created_at: old }
      : { id: runId, run_name: longRunName, state: "running", elapsed_time: { duration: 359999999 }, created_at: fresh };
    const itemRows = pageTwo ? [item] : [item, { id: "00000000-0000-4000-8000-000000000005", run_name: "Short duration run", state: "done", elapsed_time: { duration: 59 }, created_at: fresh }, { id: "00000000-0000-4000-8000-000000000006", run_name: "Missing elapsed run", state: "queued", created_at: fresh }];
    return route.fulfill({ json: { items: empty ? [] : itemRows.map(run => ({ ...run,prompt_preview:"Fixture prompt", project_id: projectId, project_name: "A very long representative project name", trigger_id: triggerId, trigger_name: "A very long representative trigger name", agent_kind: "codex" })), nextCursor: pageTwo || empty ? null : "second-page" } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/runs");
  const region = page.getByRole("region", { name: "Trigger runs table" }), table = region.getByRole("table");
  await table.getByRole("link", { name: longRunName }).waitFor();
  await table.getByText("99999h 59m", { exact: true }).waitFor();
  await table.getByText("59s", { exact: true }).waitFor();
  await table.getByText("—", { exact: true }).waitFor();
  const widths = async () => table.locator("thead th").evaluateAll(headers => headers.map(cell => Math.round(cell.getBoundingClientRect().width)));
  const baselineWidths = await widths();
  assert.equal(baselineWidths[0], 120, "Status is fixed at its 7.5rem measured envelope");
  assert.equal(baselineWidths[4], 160, "Elapsed is fixed at its 10rem measured envelope");
  assert.equal(baselineWidths[5], 208, "Created is fixed at its 13rem measured envelope");
  assert.ok(baselineWidths[2] >= 150, "Run retains a useful share after bounded project and trigger columns");
  assert.ok(await table.locator("thead th").evaluateAll(cells => cells.every(cell => getComputedStyle(cell).textAlign === "left")));
  const evidenceDir = "/home/exedev/.factorize-trigger/GEN-2919";
  if (process.env.GEN_2919_CAPTURE_EVIDENCE === "1") { await mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: `${evidenceDir}/all-runs-wide.png`, fullPage: true }); }
  const row = table.locator("tbody tr").first(), runLink = row.getByRole("link", { name: longRunName });
  assert.ok(await runLink.evaluate(node => node.clientWidth < node.scrollWidth), "long run names truncate inside Run");
  assert.equal(await row.locator("td").nth(4).getAttribute("title"), "99999h 59m");
  assert.ok(await row.locator("td").nth(4).locator("span").evaluate(node => node.clientWidth >= node.scrollWidth), "large hour counts inside the representative envelope fit");
  const createdValue = row.locator("time");
  assert.ok(await createdValue.evaluate(node => node.clientWidth >= node.scrollWidth), "the English full timestamp fits in Created");
  assert.equal(await createdValue.getAttribute("title"), await createdValue.textContent());
  await page.getByRole("button", { name: /Run, not sorted/ }).click();
  await page.waitForURL("**/runs?sort=run&direction=asc");
  assert.deepEqual(await widths(), baselineWidths, "sorting and row updates do not change any column width");
  await page.getByRole("link", { name: "Next page" }).click();
  await table.getByText("59m 59s–1h 2m", { exact: true }).waitFor();
  assert.deepEqual(await widths(), baselineWidths, "paging to a long range and failure summary does not change column widths");
  assert.ok(await table.locator("tbody tr").first().getByRole("link", { name: longRunName }).evaluate(node => node.clientWidth < node.scrollWidth));
  assert.equal(await table.locator("tbody tr").first().locator("td").nth(4).getAttribute("title"), "59m 59s–1h 2m");

  const statusWidths = [];
  for (const direction of ["asc", "desc"]) {
    const query = new URLSearchParams([...[...states].map(state => ["states", state]), ["sort", "status"], ["direction", direction]]);
    await page.goto(`${origin}/runs?${query}`);
    await table.getByRole("button", { name: /Status, 11 statuses selected/ }).waitFor();
    const header = table.locator("thead th").first();
    statusWidths.push(await header.evaluate(node => ({ width: Math.round(node.getBoundingClientRect().width), client: node.clientWidth, scroll: node.scrollWidth, height: node.getBoundingClientRect().height })));
    assert.ok(await header.locator("button").evaluate(node => node.clientWidth >= node.scrollWidth), `maximum Status label and ${direction} arrow fit without clipping`);
    assert.deepEqual(await widths(), baselineWidths, "the 11-status count and either sort arrow keep every column width stable");
  }
  assert.deepEqual(statusWidths[0], statusWidths[1], "either sort arrow keeps Status width stable");
  await page.goto(`${origin}/runs?states=ignored`);
  await table.getByText("No runs match the selected statuses.", { exact: true }).waitFor();
  assert.deepEqual(await widths(), baselineWidths, "an empty filter result keeps the same column widths");

  const frenchContext = await browser.newContext({ locale: "fr-FR" }), french = await frenchContext.newPage();
  french.setDefaultTimeout(10000); await french.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  await french.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { id: triggerId, name: "Trigger", enabled: true, model: "", agentKind: "codex", concurrencyLimit: 1, runningCount: 0, prompt: "Prompt", events: [] } }));
  await french.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [{ id: runId, run_name: longRunName, state: "succeeded", elapsed_time: { low: 3599, high: 3720 }, created_at: old, agent_kind: "codex" }], nextCursor: null } }));
  await french.setViewportSize({ width: 390, height: 844 }); await french.goto(origin + `/triggers/${triggerId}`);
  await french.getByRole("region", { name: "Runs table" }).getByRole("link", { name: longRunName }).waitFor();
  const history = french.getByRole("region", { name: "Runs table" }), historyTable = history.getByRole("table");
  const overflow = await history.evaluate(node => ({ pageWidth: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, shellWidth: node.clientWidth, tableWidth: node.querySelector("table").scrollWidth }));
  assert.ok(overflow.pageWidth <= overflow.viewport, "narrow run history scrolling stays inside its table shell");
  assert.ok(overflow.tableWidth > overflow.shellWidth, "narrow run history keeps a horizontally scrollable table");
  assert.ok(await historyTable.locator("thead th").evaluateAll(cells => cells.every(cell => getComputedStyle(cell).textAlign === "left")));
  assert.equal(await historyTable.locator("td time").getAttribute("title"), await historyTable.locator("td time").textContent());
  assert.ok(await historyTable.locator("td time").evaluate(node => node.clientWidth >= node.scrollWidth), "the French full timestamp fits in Created");
  assert.ok(await historyTable.locator("td").nth(4).locator("span").evaluate(node => node.clientWidth >= node.scrollWidth), "the representative elapsed range fits in Elapsed");
  if (process.env.GEN_2919_CAPTURE_EVIDENCE === "1") { await mkdir(evidenceDir, { recursive: true }); await french.screenshot({ path: `${evidenceDir}/job-history-narrow-fr-FR.png`, fullPage: true }); }

  const projectPage = await context.newPage();
  await projectPage.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  await projectPage.route(`**/api/v1/projects/${projectId}`, route => route.fulfill({ json: { id: projectId, name: "Project", description: "", triggerCount: 1 } }));
  await projectPage.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [{ id: triggerId, name: "Trigger", projectId, runningCount: 0 }], nextCursor: null } }));
  await projectPage.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [{ id: runId, project_id: projectId, project_name: "Project", trigger_id: triggerId, trigger_name: "Trigger", run_name: longRunName, state: "failed", failure: { reason: longFailure }, elapsed_time: { low: 3599, high: 3720 }, created_at: old, agent_kind: "codex" }], nextCursor: null } }));
  await projectPage.setViewportSize({ width: 1440, height: 900 }); await projectPage.goto(origin + "/runs");
  const projectTable = projectPage.getByRole("region", { name: "Trigger runs table" }).getByRole("table"); await projectTable.getByRole("link", { name: longRunName }).waitFor();
  const projectWidths = await projectTable.locator("thead th").evaluateAll(headers => headers.map(cell => Math.round(cell.getBoundingClientRect().width)));
  assert.deepEqual([projectWidths[0], projectWidths[4], projectWidths[5]], [120, 160, 208]); assert.ok(projectWidths[2] >= 150);
  if (process.env.GEN_2919_CAPTURE_EVIDENCE === "1") { await mkdir(evidenceDir, { recursive: true }); await projectPage.screenshot({ path: `${evidenceDir}/project-runs-wide.png`, fullPage: true }); }
  await projectPage.setViewportSize({ width: 390, height: 844 });
  const projectShell = projectPage.getByRole("region", { name: "Trigger runs table" });
  const projectOverflow = await projectShell.evaluate(node => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, shell: node.clientWidth, table: node.querySelector("table").scrollWidth }));
  assert.ok(projectOverflow.page <= projectOverflow.viewport, "narrow project run scrolling stays inside its table shell"); assert.ok(projectOverflow.table > projectOverflow.shell);
  if (process.env.GEN_2919_CAPTURE_EVIDENCE === "1") { await projectPage.screenshot({ path: `${evidenceDir}/project-runs-narrow.png`, fullPage: true }); }
  await projectPage.close(); await french.close(); await frenchContext.close(); await context.close();
});

test("filter direct runs by launch skill and start another in the team", async () => {
  const { context, page } = await setup();
  const skillId = "00000000-0000-4000-8000-000000000099";
  const project = { id: projectId, name: "Development", triggerCount: 0, description: "" };
  const run = { id: runId, run_name: "Review", launch_skill_key: "dev", project_id: projectId,
    project_name: project.name, trigger_id: null, trigger_name: null, state: "succeeded", created_at: time, updated_at: time };
  let submitted;
  await page.route(`**/api/v1/projects/${projectId}`, route => route.fulfill({json: project}));
  await page.route("**/api/v1/skills?**", route => route.fulfill({json: {items: [{id: skillId, key: "dev"}]}}));
  await page.route("**/api/v1/runs?**", route => route.fulfill({json: {
    items: new URL(route.request().url()).searchParams.get("skillId") === skillId ? [run] : [], nextCursor: null
  }}));
  await page.route("**/api/v1/runs", route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({status: 202, json: {runId, duplicate: false, url: origin+"/runs/"+runId, outcomeUri: "factorize://runs/"+runId+"/outcome"}});
  });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({json: {...run, finalizing: false, artifact_state: "stored", trace_revision: "rev"}}));
  try {
    await page.goto(origin+"/runs?skillId="+skillId);
    assert.equal(await page.getByLabel("Skill",{exact:true}).count(),0);
    const row = page.getByRole("row").filter({hasText: "Review"});
    await row.getByText("manual", {exact: true}).waitFor();
    await row.getByText("/dev", {exact: true}).waitFor();
    await page.getByRole("button", {name: "Start run"}).click();
    const form = page.locator("form").filter({has: page.getByLabel("Prompt", {exact: true})});
    await form.getByLabel("Skill").selectOption(skillId);
    await form.getByLabel("Prompt").fill("Review the migration");
    await page.getByRole("button", {name: "Start run", exact: true}).click();
    await page.waitForURL(new RegExp("/runs/"+runId));
    assert.deepEqual(submitted, {prompt: "Review the migration", skill: skillId, idempotencyKey: submitted.idempotencyKey});
    assert.match(submitted.idempotencyKey, /^[\da-f-]{36}$/);
  } finally {
    await context.close();
  }
});

test("direct run uploads unchanged image bytes before admitting an image-only run",async t=>{
 const {context,page}=await setup();t.after(()=>context.close());
 const artifactId="00000000-0000-4000-8000-000000000099",bytes=Buffer.from([137,80,78,71,0,1,2,255]);let metadata,uploaded,launch;
 await page.route("**/api/v1/runs?**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
 await page.route("**/api/v1/skills?**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
 await page.route("**/api/v1/media/uploads",route=>{metadata=route.request().postDataJSON();return route.fulfill({status:201,json:{artifactId,mediaType:"image/png",byteSize:bytes.length,sha256:metadata.sha256,state:"pending",uploadUrl:origin+"/api/v1/media/"+artifactId,readUrl:origin+"/api/v1/media/"+artifactId}});});
 await page.route("**/api/v1/media/"+artifactId,route=>{uploaded=route.request().postDataBuffer();return route.fulfill({json:{artifactId,state:"ready"}});});
 await page.route("**/api/v1/runs",route=>{launch=route.request().postDataJSON();return route.fulfill({status:202,json:{runId,duplicate:false,url:origin+"/runs/"+runId,outcomeUri:"factorize://runs/"+runId+"/outcome"}});});
 await page.route(`**/api/v1/runs/${runId}/status`,route=>route.fulfill({json:{id:runId,run_name:"Image run",state:"running",finalizing:false,trace_revision:"image",artifact_state:"pending",created_at:time}}));
 await page.goto(origin+"/runs");await page.getByRole("button",{name:"Start run",exact:true}).click();
 await page.getByLabel("Images",{exact:true}).setInputFiles({name:"image.png",mimeType:"image/png",buffer:bytes});
 await page.getByRole("button",{name:"Start run",exact:true}).click();await page.waitForURL(new RegExp("/runs/"+runId));
 assert.deepEqual(uploaded,bytes);assert.equal(metadata.byteSize,bytes.length);assert.match(metadata.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(launch.attachments,[{artifactId}]);assert.equal(launch.prompt,undefined);
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`Source and Prompt snapshots keep run names and scroll safely at ${viewport.width}px`,async t=>{
 const {context,page}=await setup();t.after(()=>context.close());await page.setViewportSize(viewport);
 const long="This is a long prompt <script>alert('never')</script> "+"😀 text ".repeat(45);
 const items=[
  {id:runId,trigger_id:triggerId,trigger_name:"renamed-trigger",source:"original-trigger",run_name:"Keep this run name",launch_skill_key:"original-skill",prompt_preview:long,execution_type:"agent",state:"succeeded",created_at:time},
  {id:siblingRunId,trigger_id:null,trigger_name:null,source:"manual",run_name:"Manual script run",launch_skill_key:null,prompt_preview:"printf '%s' hello; echo script",execution_type:"code",state:"succeeded",created_at:time},
  {id:"legacy",trigger_id:null,trigger_name:"deleted-trigger",source:"deleted-trigger",run_name:"Retained old run",launch_skill_key:"deleted-skill",prompt_preview:"Historical instructions",execution_type:"agent",state:"failed",created_at:time},
 ];
 await page.route("**/api/v1/runs?**",route=>route.fulfill({json:{items,nextCursor:null}}));
 await page.route("**/api/v1/skills?**",route=>route.fulfill({json:{items:[],nextCursor:null}}));
 await page.route("**/api/v1/trigger-summaries?**",route=>route.fulfill({json:{items:[{id:triggerId,name:"renamed-trigger"}],nextCursor:null}}));
 await page.route(`**/api/v1/triggers/${triggerId}`,route=>route.fulfill({json:{id:triggerId,name:"renamed-trigger",enabled:true,model:"fixture",agentKind:"pi",concurrencyLimit:1,runningCount:0,prompt:"Changed",events:[]}}));
 await page.goto(origin+"/runs");const table=page.getByRole("region",{name:"Trigger runs table"});
 await table.getByRole("columnheader",{name:"Prompt",exact:true}).waitFor();
 assert.deepEqual(await table.locator("thead th").allTextContents(),["Status","Source","Run","Prompt","Elapsed","Created"]);
 const row=table.getByRole("row").filter({hasText:"Keep this run name"});await row.getByText("original-skill",{exact:true}).waitFor();
 assert.equal(await row.locator("td").nth(3).textContent(),"/original-skill "+long);assert.equal(await row.locator("script").count(),0);
 assert.equal(await table.getByRole("row").filter({hasText:"Manual script run"}).locator("td").nth(1).textContent(),"manual");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const sizing=await table.evaluate(node=>({width:node.clientWidth,content:node.scrollWidth}));if(viewport.width===390)assert.ok(sizing.content>sizing.width);
 await page.goto(origin+`/triggers/${triggerId}`);const history=page.getByRole("region",{name:"Runs table",exact:true});await history.getByText("Keep this run name",{exact:true}).waitFor();
 assert.equal(await history.getByRole("columnheader",{name:"Source",exact:true}).count(),1);assert.equal(await history.getByRole("columnheader",{name:"Prompt",exact:true}).count(),1);
 assert.equal(await history.getByRole("row").filter({hasText:"Retained old run"}).locator("td").nth(3).textContent(),"/deleted-skill Historical instructions");
});

test("manual and triggered detail/full trace retain team navigation and omit trigger breadcrumbs",async()=>{
 for(const triggered of [false,true])for(const suffix of ["","/trace"]){
  const {page,context}=await setup();
  await page.route(`**/api/v1/runs/${runId}/status`,route=>route.fulfill({json:{id:runId,trigger_id:triggered?triggerId:null,trigger_name:triggered?"Original trigger":null,run_name:"Navigation run",state:"succeeded",finalizing:false,trace_revision:"rev",artifact_state:"stored",created_at:time,updated_at:time,started_at:time,destination_url:null}}));
  await page.route(`**/api/v1/triggers/${triggerId}`,route=>route.fulfill({json:{id:triggerId,name:"Original trigger",events:[]}}));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`,route=>route.fulfill({json:{items:[],nextCursor:null,revision:"rev",reset:false}}));
  await page.goto(origin+`/runs/${runId}${suffix}`);
  await page.getByRole("heading",{name:"Navigation run",exact:true}).waitFor();
  const nav=page.getByRole("navigation",{name:"Dashboard navigation",exact:true});
  assert.equal(await nav.getByRole("link",{name:"Runs",exact:true}).getAttribute("aria-current"),"page");
  assert.equal(await page.getByRole("navigation",{name:"Trigger navigation",exact:true}).count(),0);
  assert.equal(await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("link",{name:"Original trigger",exact:true}).count(),0);
  assert.equal(await page.getByRole("navigation",{name:"Breadcrumb",exact:true}).getByRole("link",{name:"Original trigger",exact:true}).count(),0);
  await context.close();
 }
});

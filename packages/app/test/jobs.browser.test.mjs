import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const triggerId = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000010", runId = "00000000-0000-4000-8000-000000000002";
const summary = { id: triggerId, projectId, name: "Review builds", slug: "review-builds", enabled: true, runningCount: 0, concurrencyLimit: 2, lastRunState: null, model: "", effort: "", agentKind: "codex", createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
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
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  await page.route(`**/api/v1/projects/${projectId}`, route => route.fulfill({ json: { id: projectId, name: "Release project", description: "Project triggers", triggerCount: 31 } }));
  return { context, page };
}
test("a 1,000-trigger workspace loads one bounded first page and one request on Next", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  const fixtures = Array.from({ length: 1000 }, (_, index) => ({ ...summary, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `Trigger ${String(index + 1).padStart(4, "0")}` }));
  fixtures[900] = { ...fixtures[900], name: "Active beyond old first 100", runningCount: 2 };
  const serverOrder = [fixtures[900], ...fixtures.filter((_, index) => index !== 900).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))];
  const requests = [];
  await page.route("**/api/v1/trigger-summaries?**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const offset = url.searchParams.has("cursor") ? 30 : 0;
    return route.fulfill({ json: { items: serverOrder.slice(offset, offset + 30), nextCursor: offset + 30 < serverOrder.length ? "server-cursor-30" : null } });
  });
  await page.goto(origin + "/triggers");
  const table = page.getByRole("table", { name: "Triggers", exact: true });
  await table.getByRole("link", { name: "Active beyond old first 100", exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("limit"), "30");
  assert.equal(requests[0].searchParams.get("sort"), "active");
  assert.equal(await table.locator("tbody tr").count(), 30);
  await page.getByRole("link", { name: "Next page" }).click();
  await table.getByRole("link", { name: "Trigger 0030", exact: true }).waitFor();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("cursor"), "server-cursor-30");
  assert.equal(requests[1].searchParams.get("limit"), "30");
  await context.close();
});
test("triggers carry search and enabled filters and reset the cursor when sorting changes", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  const requests = [];
  await page.route("**/api/v1/trigger-summaries?**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { items: [{ ...summary, id: triggerId, name: "Filtered trigger" }], nextCursor: null } });
  });
  await page.goto(origin + "/triggers?q=needle&enabled=false&cursor=old-cursor&sort=running&order=desc");
  const table = page.getByRole("table", { name: "Triggers", exact: true });
  await table.getByRole("link", { name: "Filtered trigger", exact: true }).waitFor();
  assert.equal(requests[0].searchParams.get("q"), "needle");
  assert.equal(requests[0].searchParams.get("enabled"), "false", requests[0].href);
  assert.equal(requests[0].searchParams.get("cursor"), "old-cursor");
  const nextRequest = page.waitForRequest(request => {
    const url = new URL(request.url()); return url.pathname === "/api/v1/trigger-summaries" && url.searchParams.get("sort") === "title";
  });
  await table.getByRole("button", { name: /Title sort/ }).click();
  const sorted = new URL((await nextRequest).url());
  assert.equal(sorted.searchParams.get("q"), "needle");
  assert.equal(sorted.searchParams.get("enabled"), "false", sorted.href);
  assert.equal(sorted.searchParams.has("cursor"), false);
  await context.close();
});
test("triggers can sort running and title in both directions with accessible state", async () => {
  const { page, context } = await contextFor();
  const fixtures = [
    { ...summary, id: "trigger-z", name: "Zulu", runningCount: 1 },
    { ...summary, id: "trigger-a", name: "Alpha", runningCount: 3, enabled: false },
    { ...summary, id: "trigger-b", name: "Beta", runningCount: 3 },
    { ...summary, id: "trigger-i", name: "Idle", runningCount: 0 },
  ];
  await page.route("**/api/v1/trigger-summaries?**", route => {
    const url = new URL(route.request().url());
    const sort = url.searchParams.get("sort"), direction = url.searchParams.get("direction") ?? "asc";
    const rows = [...fixtures].sort((a, b) => {
      if (sort === "running") return (Number(a.runningCount) - Number(b.runningCount)) * (direction === "asc" ? 1 : -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      if (sort === "title") return a.name.localeCompare(b.name) * (direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
      return Number(b.runningCount > 0) - Number(a.runningCount > 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    return route.fulfill({ json: { items: rows, nextCursor: null } });
  });
  await page.goto(origin + "/triggers");
  const table = page.getByRole("table", { name: "Triggers", exact: true });
  await table.getByRole("link", { name: "Zulu", exact: true }).waitFor();
  assert.deepEqual(await table.locator("tbody a").allTextContents(), ["Alpha", "Beta", "Zulu", "Idle"]);
  const running = table.getByRole("button", { name: /Running sort/ });
  await running.click();
  await page.waitForFunction(() => document.querySelector("thead th:nth-child(1)")?.getAttribute("aria-sort") === "ascending");
  assert.equal(await table.locator("th").nth(0).getAttribute("aria-sort"), "ascending");
  assert.deepEqual(await table.locator("tbody a").allTextContents(), ["Idle", "Zulu", "Alpha", "Beta"]);
  await running.click();
  await page.waitForFunction(() => document.querySelector("thead th:nth-child(1)")?.getAttribute("aria-sort") === "descending");
  assert.equal(await table.locator("th").nth(0).getAttribute("aria-sort"), "descending");
  assert.deepEqual(await table.locator("tbody a").allTextContents(), ["Alpha", "Beta", "Zulu", "Idle"]);
  const title = table.getByRole("button", { name: /Title sort/ });
  await title.click();
  await page.waitForFunction(() => document.querySelectorAll("thead th")[1]?.getAttribute("aria-sort") === "ascending");
  assert.equal(await table.locator("th").nth(1).getAttribute("aria-sort"), "ascending");
  assert.deepEqual(await table.locator("tbody a").allTextContents(), ["Alpha", "Beta", "Idle", "Zulu"]);
  await page.reload(); await table.getByRole("link", { name: "Alpha", exact: true }).waitFor();
  assert.equal(await table.locator("th").nth(1).getAttribute("aria-sort"), "ascending");
  await title.click();
  await page.waitForFunction(() => document.querySelectorAll("thead th")[1]?.getAttribute("aria-sort") === "descending");
  assert.equal(await table.locator("th").nth(1).getAttribute("aria-sort"), "descending");
  assert.deepEqual(await table.locator("tbody a").allTextContents(), ["Zulu", "Idle", "Beta", "Alpha"]);
  await context.close();
});
test("split invocation runs defaults immediately and supports prompt-only modal", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", runNameTemplate: "", executionConfigId: "local", executionConfig: { connectionId: "local", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: "codex" }, events: [], currentRuns: 0, maxConcurrency: 2 } }));
  const inputs = [];
  await page.route(`**/api/v1/triggers/${triggerId}/invocations`, route => {
    inputs.push(route.request().postDataJSON());
    return inputs.length < 3 ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Try again" } } }) : route.fulfill({ status: 202, json: { runId, invocationId: "invocation", state: "queued", duplicate: true } });
  });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Manual run", state: "succeeded", finalizing: false, trace_revision: "rev-1", artifact_state: "stored", started_at: null, created_at: summary.createdAt, updated_at: summary.updatedAt, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [{ id: "e1", sequence: 1, type: "assistant_message", title: "Assistant", preview: "<script>alert('xss')</script>", display: {} }], nextCursor: null, revision: "rev-1", reset: false } }));
  await page.goto(origin + "/triggers/" + triggerId);
  await page.getByRole("button", { name: "Run trigger", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Try again" }).waitFor();
  assert.equal(inputs.length, 1); assert.equal(inputs[0].prompt, ""); assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "More run options", exact: true }).click(); await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  assert.equal(await page.getByLabel("Run name (optional)").count(), 1); assert.equal(await page.getByLabel("JSON data (optional)").count(), 1);
  await page.mouse.click(1, 1); await page.waitForTimeout(50); assert.equal(await page.getByRole("dialog").count(), 0); assert.equal(inputs.length, 1);
  await page.getByRole("button", { name: "More run options", exact: true }).click(); await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).fill("Review");
  await page.getByRole("heading", { name: "Run with prompt", exact: true }).click(); assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "Run with prompt", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Try again" }).waitFor();
  await page.getByRole("button", { name: "Run with prompt", exact: true }).click(); await page.waitForURL(`**/runs/${runId}?**`);
  await page.getByText("<script>alert('xss')</script>", { exact: true }).waitFor();
  assert.equal(inputs.length, 3); assert.equal(inputs[1].prompt, "Review"); assert.equal(inputs[1].idempotencyKey, inputs[2].idempotencyKey);
  assert.equal(await page.locator("main script").count(), 0); await context.close();
});
test("invocation preserves retry idempotency and navigates to lightweight run/trace", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", runNameTemplate: "", executionConfigId: "local", executionConfig: { connectionId: "local", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: "codex" }, events: [], currentRuns: 0, maxConcurrency: 2 } }));
  const inputs = [];
  await page.route(`**/api/v1/triggers/${triggerId}/invocations`, route => {
    inputs.push(route.request().postDataJSON());
    return inputs.length === 1 ? route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Try again" } } }) : route.fulfill({ status: 202, json: { runId, invocationId: "invocation", state: "queued", duplicate: true } });
  });
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Manual run", state: "succeeded", finalizing: false, trace_revision: "rev-1", artifact_state: "stored", started_at: null, created_at: summary.createdAt, updated_at: summary.updatedAt, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => route.fulfill({ json: { items: [{ id: "e1", sequence: 1, type: "assistant_message", title: "Assistant", preview: "<script>alert('xss')</script>", display: {} }], nextCursor: null, revision: "rev-1", reset: false } }));
  await page.goto(origin + "/triggers/" + triggerId);
  await page.getByRole("button", { name: "More run options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).fill("Review");
  await page.getByRole("button", { name: "Run with prompt", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Try again" }).waitFor();
  await page.getByRole("button", { name: "Run with prompt", exact: true }).click(); await page.waitForURL(`**/runs/${runId}?**`);
  await page.getByText("<script>alert('xss')</script>", { exact: true }).waitFor();
  assert.equal(inputs.length, 2); assert.equal(inputs[0].idempotencyKey, inputs[1].idempotencyKey); assert.equal(inputs[1].prompt, "Review");
  assert.equal(await page.locator("main script").count(), 0); await context.close();
});
test("prompt modal Escape restores focus and does not run", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", runNameTemplate: "", executionConfigId: "local", executionConfig: { connectionId: "local", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: "codex" }, events: [], currentRuns: 0, maxConcurrency: 2 } }));
  const inputs = [];
  await page.route(`**/api/v1/triggers/${triggerId}/invocations`, route => { inputs.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { runId, invocationId: "invocation", state: "queued", duplicate: false } }); });
  await page.goto(origin + "/triggers/" + triggerId);
  await page.getByRole("button", { name: "More run options", exact: true }).click(); await page.getByRole("menuitem", { name: "Run with prompt", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).fill("Do not run"); await page.keyboard.press("Escape");
  assert.equal(inputs.length, 0); assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "More run options", exact: true }).focus(); assert.equal(await page.getByRole("button", { name: "More run options", exact: true }).evaluate(el => el === document.activeElement), true);
  await context.close();
});
for (const width of [1280, 390]) test(`trigger header actions and status remain usable at ${width}px`, async () => {
  const { page, context } = await contextFor({ viewport: { width, height: 844 } });
  let enabled = true;
  const longTitle = "Production deployment " + "with a deliberately long title ".repeat(12);
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, name: longTitle, enabled, runningCount: 1, concurrencyLimit: 3, prompt: "Template", executionConfigId: "local", events: [] } }));
  await page.goto(origin + "/triggers/" + triggerId);
  assert.equal(await page.getByRole("heading", { name: longTitle, exact: true }).count(), 0);
  assert.equal(await page.getByText("codex · Default model · 1/3 running", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Enabled", { exact: true }).count(), 0);
  const actions = page.getByRole("group", { name: "Trigger actions" });
  const runButton = actions.getByRole("button", { name: "Run trigger", exact: true });
  const disableButton = actions.getByRole("button", { name: "Disable trigger", exact: true });
  assert.equal(await runButton.isEnabled(), true);
  assert.equal(await disableButton.count(), 1);
  assert.equal((await runButton.boundingBox()).height, (await disableButton.boundingBox()).height);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  enabled = false;
  await page.reload();
  assert.equal(await page.getByRole("heading", { name: longTitle, exact: true }).count(), 0);
  assert.equal(await actions.getByRole("button", { name: "Run trigger", exact: true }).isDisabled(), true);
  assert.equal(await actions.getByRole("button", { name: "Enable trigger", exact: true }).count(), 1);
  assert.equal((await actions.getByRole("button", { name: "Run trigger", exact: true }).boundingBox()).height, (await actions.getByRole("button", { name: "Enable trigger", exact: true }).boundingBox()).height);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await context.close();
});
test("trace reset between requests discards old pages and finalization keeps terminal polling alive", async () => {
  const { page, context } = await contextFor();
  let statusCalls = 0, reset = false;
  await page.route(`**/api/v1/runs/${runId}/status`, route => { statusCalls++; return route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Run", state: "succeeded", finalizing: true, trace_revision: "old", artifact_state: "collecting", created_at: summary.createdAt, updated_at: summary.updatedAt, started_at: null, destination_url: null } }); });
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("after") === "1") reset = true;
    return route.fulfill({ json: { items: [{ id: reset ? "new" : "old", sequence: 1, type: "assistant_message", title: reset ? "New projection" : "Old projection", preview: "Safe text", display: {} }], nextCursor: reset ? null : 100, revision: reset ? "new" : "old", reset: reset && query.get("revision") === "old" } });
  });
  await page.goto(origin + "/runs/" + runId); await page.getByText("Safe text", { exact: true }).waitFor();
  await page.getByText("Safe text", { exact: true }).waitFor();
  assert.equal(await page.getByText("Old projection · assistant_message", { exact: true }).count(), 0);
  await page.waitForTimeout(2200); assert.ok(statusCalls >= 2);
  await context.close();
});
test("20k-event continuous trace keeps DOM bounded, retains expanded details on scroll and resets generations", { skip: !process.env.FACTORIZE_STRESS }, async () => {
  const { page, context } = await contextFor(); let revision = "large", traceRequests = 0, peakNodes = 0; const started = performance.now();
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { id: runId, trigger_id: triggerId, trigger_name: "Review builds", run_name: "Large trace", state: "succeeded", finalizing: true, trace_revision: revision, artifact_state: "stored", created_at: summary.createdAt, updated_at: summary.updatedAt, started_at: null, destination_url: null } }));
  await page.route(`**/api/v1/runs/${runId}/trace-pages?**`, route => {
    traceRequests++; const query = new URL(route.request().url()).searchParams, reset = !!query.get("revision") && query.get("revision") !== revision, after = reset ? 0 : Number(query.get("after") || 0), limit = Number(query.get("limit")), count = revision === "large" ? 20000 : 1;
    return route.fulfill({ json: { items: Array.from({ length: Math.min(limit, count - after) }, (_, index) => ({ id: `${revision}-${after + index + 1}`, sequence: after + index + 1, type: "assistant_message", title: `${revision} event ${after + index + 1}`, preview: "Safe text", display: {} })), nextCursor: after + limit < count ? after + limit : null, revision, reset } });
  });
  await page.goto(origin + "/runs/" + runId);
  const region = page.getByRole("region", { name: "Full trace", exact: true });
  await page.getByText("large event 1 · assistant_message", { exact: true }).waitFor(); await page.getByText("large event 1 · assistant_message", { exact: true }).click();
  for (let count = 400; count <= 20000; count += 200) {
    await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(expected => Math.max(...[...document.querySelectorAll('[role="status"]')].map(element => Number(element.textContent?.match(/^(\d+) events loaded/)?.[1] ?? 0))) >= expected, count);
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

test("trigger Runs tab paginates distinct records, supports refresh/back and keeps configuration in Settings on mobile", async () => {
  const { page, context } = await contextFor({ viewport: { width: 390, height: 844 } });
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Private template", runNameTemplate: "", executionConfigId: "local", events: [] } }));
  const cursors = [];
  await page.route("**/api/v1/runs?**", route => {
    const url = new URL(route.request().url()), cursor = url.searchParams.get("cursor"); cursors.push(cursor);
    assert.equal(url.searchParams.get("triggerId"), triggerId); assert.equal(url.searchParams.get("limit"), "30");
    assert.equal(url.searchParams.has("state"), false); assert.equal(url.searchParams.has("contextQuery"), false);
    const offset = cursor === "page-3" ? 60 : cursor === "page-2" ? 30 : 0;
    return route.fulfill({ json: { items: Array.from({ length: offset === 60 ? 1 : 30 }, (_, i) => ({ id: `run-${offset + i}`, run_name: `Record ${offset + i}`, state: "succeeded", created_at: summary.createdAt, agent_kind: "codex" })), nextCursor: offset === 60 ? null : offset === 30 ? "page-3" : "page-2" } });
  });
  await page.goto(origin + `/triggers/${triggerId}?state=failed&contextQuery=old`);
  await page.getByRole("link", { name: "Record 0", exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Trigger views" }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Review builds", exact: true }).count(), 0);
  const actions = page.getByRole("group", { name: "Trigger actions" });
  assert.equal(await actions.getByRole("button", { name: "Run trigger", exact: true }).count(), 1);
  assert.equal(await actions.getByRole("button", { name: "Disable trigger", exact: true }).count(), 1);
  assert.equal(await page.getByRole("table").locator("tbody tr").count(), 30);
  assert.equal(await page.getByRole("columnheader", { name: "Prompt", exact: true }).count(), 1);
  assert.equal(await page.getByText("Events", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Delete trigger", exact: true }).count(), 0);
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
  await page.goto(origin + `/triggers/${triggerId}/settings`);
  await page.getByRole("heading", { name: "General", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/triggers/${triggerId}/settings/general`);
  assert.equal(await page.getByRole("navigation", { name: "Breadcrumb" }).count(), 0);
  assert.equal(await page.getByRole("navigation", { name: "Trigger settings sections" }).getByRole("link").count(), 5);
  assert.equal(await page.getByRole("navigation", { name: "Trigger views" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Run trigger", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Disable trigger", exact: true }).count(), 0);
  await page.getByRole("navigation", { name: "Trigger settings sections" }).getByRole("link", { name: "VM" }).click();
  await page.getByRole("heading", { name: "VM", exact: true }).waitFor();
  assert.equal(await page.getByLabel("VM image").count(), 1);
  await context.close();
});

test("run table headers sort every column accessibly and persist in the URL", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", executionConfigId: "local", events: [] } }));
  const requests = [];
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); return route.fulfill({ json: { items: [{ id: runId, run_name: "Run", issue_title: "", state: "succeeded", created_at: summary.createdAt, agent_kind: "codex" }], nextCursor: null } }); });
  await page.goto(origin + `/triggers/${triggerId}`);
  const table = page.getByRole("table");
  await table.getByRole("columnheader").nth(0).getByRole("button").waitFor();
  assert.deepEqual(await table.locator("thead th").allTextContents(), ["Status", "Source", "Run", "Prompt", "Elapsed", "Created"]);
  assert.equal(await table.getByRole("columnheader", { name: /Execution/ }).count(), 0);
  for (const index of [0, 2, 5]) assert.equal(await table.getByRole("columnheader").nth(index).getByRole("button").count(), 1);
  const runButton = page.getByRole("button", { name: "Run trigger", exact: true }), optionsButton = page.getByRole("button", { name: "More run options", exact: true });
  const runBox = await runButton.boundingBox(), optionsBox = await optionsButton.boundingBox();
  assert.equal(runBox.x + runBox.width, optionsBox.x);
  const runHeader = table.getByRole("button", { name: /Run, not sorted/ });
  const widths = await table.locator("thead th").evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().width)));
  assert.ok(widths[2] > widths[4], "Run column is wider than Elapsed");
  await runHeader.focus(); await page.keyboard.press("Enter"); await page.waitForURL(`**/triggers/${triggerId}?sort=run&direction=asc`);
  assert.equal(await table.getByRole("columnheader", { name: /Run/ }).getAttribute("aria-sort"), "ascending");
  assert.deepEqual(await table.locator("thead th").evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().width))), widths);
  await table.getByRole("button", { name: /Run, sorted ascending/ }).click(); await page.waitForURL(`**/triggers/${triggerId}?sort=run&direction=desc`);
  assert.equal(requests.at(-1).searchParams.get("direction"), "desc");
  await context.close();
});
test("trigger run history shares status filtering and keeps it across pagination", async () => {
  const { page, context } = await contextFor(); const requests = [];
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", executionConfigId: "local", events: [] } }));
  await page.route("**/api/v1/runs?**", route => { const url = new URL(route.request().url()); requests.push(url); return route.fulfill({ json: { items: [{ id: runId, run_name: "Failed run", state: "failed", created_at: summary.createdAt, agent_kind: "codex" }], nextCursor: "next" } }); });
  await page.goto(origin + `/triggers/${triggerId}`); await page.getByRole("button", { name: /Status, all statuses/ }).click(); const dialog = page.getByRole("dialog", { name: "Status filter and sort" }); await dialog.getByLabel("Failed").click({ noWaitAfter: true }); await page.waitForFunction(() => location.search.includes("state") || location.search.includes("states")); await page.waitForTimeout(250); assert.equal(requests.find(url => url.searchParams.get("state") === "failed")?.searchParams.get("state"), "failed");
  assert.equal(await dialog.isVisible(), true);
  await page.mouse.click(1200, 700);
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Next page" }).click(); await page.waitForURL(/cursor=next/); assert.equal(requests.at(-1).searchParams.get("state"), "failed"); await page.getByRole("button", { name: /Status, 1 status selected/ }).click(); await page.getByRole("dialog", { name: "Status filter and sort" }).getByRole("button", { name: "Clear filters and reset sort" }).click(); await page.waitForFunction(() => { const params = new URLSearchParams(location.search); return location.pathname.endsWith("/" + "00000000-0000-4000-8000-000000000001") && !params.has("state") && !params.has("states"); }); await new Promise((resolve, reject) => { const deadline = Date.now() + 2000; const check = () => requests.some(url => !url.searchParams.has("state")) ? resolve() : Date.now() >= deadline ? reject(new Error("status filter clear did not refetch")) : setTimeout(check, 25); check(); }); assert.equal([...requests].reverse().find(url => !url.searchParams.has("state"))?.searchParams.has("state"), false); await context.close();
});

test("trigger with no runs has an empty table and disabled pagination", async () => {
  const { page, context } = await contextFor();
  await page.route(`**/api/v1/triggers/${triggerId}`, route => route.fulfill({ json: { ...summary, prompt: "Template", executionConfigId: "local", events: [] } }));
  await page.goto(origin + `/triggers/${triggerId}`); await page.getByRole("cell", { name: "No runs found." }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Previous page", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Next page", exact: true }).isDisabled(), true);
  await context.close();
});

test("flat dashboard lists team triggers without project requests and retires project pages", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  const requests = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [summary], nextCursor: null } }));
  await page.goto(origin + "/triggers");
  const table = page.getByRole("table", { name: "Triggers", exact: true });
  await table.getByRole("link", { name: summary.name }).waitFor();
  assert.equal(await table.getByRole("columnheader", { name: "Project", exact: true }).count(), 0);
  assert.equal(requests.some(path => path.startsWith("/api/v1/projects")), false);
  await page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Runs", exact: true }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  assert.equal(await page.getByRole("combobox", { name: "Project", exact: true }).count(), 0);
  await page.goto(origin + "/projects");
  await page.getByRole("heading", { name: "Page not found" }).waitFor();
  await context.close();
});

test("team graph groups every connection with directions, state, selection, and dismissal", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 }, hasTouch: true });
  const secondTrigger = "00000000-0000-4000-8000-000000000012";
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: {
    nodes: [
      { id: triggerId, type: "trigger", label: "Build", triggerKind: "Agent", enabled: true, runningCount: 2, concurrencyLimit: 4 },
      { id: secondTrigger, type: "trigger", label: "Deploy", triggerKind: "Code", enabled: false, runningCount: 0, concurrencyLimit: 1 },
    ], edges: [
      { id: "lifecycle-a", source: triggerId, target: secondTrigger, label: "Failed, Stopped", kind: "lifecycle", enabled: false },
      { id: "idle-a", source: triggerId, target: secondTrigger, label: "Idle", kind: "idle", enabled: false },
      { id: "idle-b", source: triggerId, target: secondTrigger, label: "Idle", kind: "idle", enabled: true },
      { id: "manual-a", source: secondTrigger, target: triggerId, label: "Manual", kind: "manual", enabled: false },
      { id: "lifecycle-reverse", source: secondTrigger, target: triggerId, label: "Succeeded", kind: "lifecycle", enabled: true },
    ],
  } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("region", { name: /2 triggers and 5 connections/ });
  await graph.waitFor();
  const running = page.getByRole("img", { name: "Status: Running", exact: true });
  await running.waitFor();
  assert.match(await running.locator("[aria-hidden]").getAttribute("class"), /bg-blue-500.*motion-safe:animate-pulse/);
  assert.match(await running.locator("..").textContent(), /running · 2\/4/i);
  await page.getByText("Not running", { exact: true }).waitFor();
  const badge = page.getByRole("button", { name: /5 events/ });
  await badge.waitFor();
  assert.equal(await page.getByRole("button", { name: /events/ }).count(), 1);
  assert.equal(await graph.locator(".react-flow__edge").count(), 1);
  assert.equal(await graph.locator(".react-flow__edge path[marker-start]").count(), 1);
  assert.equal(await graph.locator(".react-flow__edge path[marker-end]").count(), 1);
  await badge.tap();
  const dropdown = page.getByRole("dialog", { name: "Grouped connections" });
  await dropdown.waitFor();
  const dropdownBox = await dropdown.boundingBox(), viewport = page.viewportSize();
  assert.ok(dropdownBox.x >= 0 && dropdownBox.y >= 0 && dropdownBox.x + dropdownBox.width <= viewport.width);
  assert.equal(await dropdown.getByRole("button").count(), 5);
  assert.equal(await dropdown.getByRole("button", { name: /Idle/ }).count(), 2);
  assert.equal(await dropdown.getByText("Build → Deploy", { exact: true }).count(), 3);
  assert.equal(await dropdown.getByText("Deploy → Build", { exact: true }).count(), 2);
  assert.equal(await dropdown.getByText("Manual invocation permission · Disabled", { exact: true }).count(), 1);
  assert.equal(await dropdown.getByText("Automatic event · Enabled", { exact: true }).count(), 2);
  const graphTransform = await graph.locator(".react-flow__viewport").getAttribute("style");
  await dropdown.getByRole("button", { name: /Failed, Stopped/ }).click();
  assert.equal(await graph.locator(".react-flow__viewport").getAttribute("style"), graphTransform);
  await page.getByRole("button", { name: "Close connection details" }).click();
  await badge.click();
  const idleChoices = dropdown.getByRole("button", { name: /Idle/ });
  await idleChoices.nth(0).click();
  await page.getByRole("heading", { name: "Idle", exact: true }).waitFor();
  await page.getByText(/Automatic event · Disabled/).waitFor();
  await badge.click();
  await dropdown.getByRole("button", { name: /Idle/ }).nth(1).click();
  await page.getByText(/Automatic event · Enabled/).waitFor();
  await badge.click();
  for (const label of ["Failed, Stopped", "Manual", "Succeeded"]) {
    const choice = dropdown.getByRole("button", { name: new RegExp(label) }).first();
    await choice.click();
    await page.getByRole("heading", { name: label, exact: true }).waitFor();
    if (label !== "Succeeded") await badge.click();
  }
  await badge.click();
  await page.keyboard.press("Escape");
  await dropdown.waitFor({ state: "detached" });
  assert.equal(await badge.evaluate(el => el === document.activeElement), true);
  await badge.click();
  await graph.locator(".react-flow__controls-button").last().click();
  await dropdown.waitFor({ state: "detached" });
  await badge.click();
  await page.getByRole("link", { name: "Deploy, disabled, not running" }).click();
  await page.waitForURL(new RegExp(`/triggers/${secondTrigger}`));
  await context.close();
});

test("single graph connections keep a readable label and open details", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  const secondTrigger = "00000000-0000-4000-8000-000000000012";
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: { nodes: [
    { id: triggerId, type: "trigger", label: "Build", triggerKind: "Agent", enabled: true }, { id: secondTrigger, type: "trigger", label: "Deploy", triggerKind: "Code", enabled: true },
  ], edges: [{ id: "manual-edge", source: triggerId, target: secondTrigger, label: "Manual", kind: "manual", enabled: true }] } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: /Manual connection/ }).click();
  await page.getByRole("heading", { name: "Manual", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close connection details" }).click();
  assert.equal(await page.getByRole("heading", { name: "Manual", exact: true }).count(), 0);
  await context.close();
});
test("team graph does not zoom when the desktop wheel scrolls over it", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: {
    nodes: [{ id: triggerId, type: "trigger", label: "Build", triggerKind: "Agent", enabled: true, runningCount: 0, concurrencyLimit: 1 }],
    edges: [],
  } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("region", { name: /1 triggers and 0 connections/ });
  await graph.waitFor();
  const viewport = graph.locator(".react-flow__viewport");
  await page.waitForFunction(async () => {
    const element = document.querySelector('[role="region"] .react-flow__viewport');
    if (!element) return false;
    const first = element.getAttribute("style");
    await new Promise(requestAnimationFrame);
    const second = element.getAttribute("style");
    await new Promise(requestAnimationFrame);
    return first === second && second === element.getAttribute("style");
  });
  const initialTransform = await viewport.getAttribute("style");
  const bounds = await graph.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -400);
  assert.equal(await viewport.getAttribute("style"), initialTransform);
  await context.close();
});
test("mobile team graph leaves one-finger page scrolling and pans with two fingers", async () => {
  const { page, context } = await contextFor({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: {
    nodes: [{ id: triggerId, type: "trigger", label: "Build", triggerKind: "Agent", enabled: true, runningCount: 0, concurrencyLimit: 1 }],
    edges: [],
  } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("region", { name: /1 triggers and 0 connections/ });
  await graph.waitFor();
  const viewport = graph.locator(".react-flow__viewport");
  const initialTransform = await viewport.getAttribute("style");
  const gesture = await graph.evaluate(element => {
    const pane = element.querySelector(".react-flow__pane");
    const touch = (identifier, clientX, clientY) => new Touch({ identifier, target: pane, clientX, clientY });
    const dispatch = (type, touches) => {
      const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: touches });
      pane.dispatchEvent(event);
      return event;
    };
    const touchAction = getComputedStyle(pane).touchAction;
    const first = touch(1, 100, 100), second = touch(2, 200, 100);
    dispatch("touchstart", [first, second]);
    const movedFirst = touch(1, 100, 180), movedSecond = touch(2, 200, 180);
    const move = dispatch("touchmove", [movedFirst, movedSecond]);
    dispatch("touchend", []);
    return { touchAction, prevented: move.defaultPrevented };
  });
  await page.waitForFunction((before) => document.querySelector(".react-flow__viewport")?.getAttribute("style") !== before, initialTransform);
  assert.equal(gesture.touchAction, "pan-y");
  assert.equal(gesture.prevented, true);
  assert.notEqual(await viewport.getAttribute("style"), initialTransform);
  await context.close();
});
test("team graph renders dense cyclic, webhook and self-loop routes and fits their labels", async () => {
  const { page, context } = await contextFor({ viewport: { width: 390, height: 844 } });
  const ids = [triggerId, "00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013", "00000000-0000-4000-8000-000000000014"];
  const nodes = [
    { id: ids[0], type: "webhook", label: "Deploy hook", provider: "GitHub", enabled: true },
    ...ids.slice(1).map((id, index) => ({ id, type: "trigger", label: ["Build", "Test", "Deploy"][index], triggerKind: "Agent", enabled: true, runningCount: 0, concurrencyLimit: 1 })),
  ];
  const edges = [
    { id: "hook", source: ids[0], target: ids[1], label: "push", kind: "webhook", enabled: true },
    { id: "skip", source: ids[1], target: ids[3], label: "success", kind: "lifecycle", enabled: true },
    { id: "cycle-a", source: ids[3], target: ids[2], label: "rollback", kind: "lifecycle", enabled: true },
    { id: "cycle-b", source: ids[2], target: ids[1], label: "retry", kind: "lifecycle", enabled: true },
    { id: "self", source: ids[2], target: ids[2], label: "repeat", kind: "lifecycle", enabled: true },
    { id: "branch-a", source: ids[1], target: ids[2], label: "passed", kind: "lifecycle", enabled: true },
    { id: "branch-b", source: ids[1], target: ids[2], label: "failed", kind: "lifecycle", enabled: true },
  ];
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: { nodes, edges } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("region", { name: /3 triggers and 7 connections/ });
  await graph.waitFor();
  assert.equal(await page.locator(".react-flow__node-webhook").count(), 1);
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge-path").length === 5);
  assert.equal(await page.locator(".react-flow__edge-path").count(), 5);
  assert.equal(await page.getByRole("button", { name: /3 events/ }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Fit graph to view" }).count(), 1);
  await graph.locator(".react-flow__controls-button").first().click();
  await page.getByRole("button", { name: "Fit graph to view" }).click();
  const view = await page.locator(".react-flow__viewport").getAttribute("style");
  assert.match(view, /transform/);
  await page.waitForTimeout(250);
  const graphBox = await graph.boundingBox();
  const labelBoxes = await graph.locator(".react-flow__edgelabel-renderer button").evaluateAll(labels => labels.map(label => { const { x, y, width, height } = label.getBoundingClientRect(); return { x, y, width, height }; }));
  assert.equal(labelBoxes.length, 5);
  for (const box of labelBoxes) assert.ok(box.x >= graphBox.x && box.y >= graphBox.y && box.x + box.width <= graphBox.x + graphBox.width && box.y + box.height <= graphBox.y + graphBox.height, "fit view clips an edge label");
  await context.close();
});
test("team graph keeps opaque webhook resource IDs out of labels and available in details", async () => {
  const { page, context } = await contextFor({ viewport: { width: 1280, height: 844 } });
  const projectUuid = "00000000-0000-4000-8000-000000000099", linearSource = `webhook:linear:${projectUuid}`, clickupSource = "webhook:clickup:123456789";
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/triggers/graph", route => route.fulfill({ json: {
    nodes: [
      { id: triggerId, type: "trigger", label: "Build", triggerKind: "Agent", enabled: true, runningCount: 0 },
      { id: linearSource, type: "webhook", label: "Linear", provider: "linear", resource: projectUuid },
      { id: clickupSource, type: "webhook", label: "ClickUp", provider: "clickup", resource: "123456789" },
    ], edges: [
      { id: `event:${linearSource}:${triggerId}`, source: linearSource, target: triggerId, label: "Linear", details: `Linear · ${projectUuid}`, kind: "webhook", enabled: true },
      { id: `event-copy:${linearSource}:${triggerId}`, source: linearSource, target: triggerId, label: "Linear", details: "Linear · 00000000-0000-4000-8000-000000000098", kind: "webhook", enabled: true },
      { id: `event:${clickupSource}:${triggerId}`, source: clickupSource, target: triggerId, label: "ClickUp", details: "ClickUp · 123456789", kind: "webhook", enabled: true },
    ],
  } }));
  await page.goto(origin + "/triggers");
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  const graph = page.getByRole("region", { name: /1 triggers and 3 connections/ });
  await graph.waitFor();
  const labels = await graph.locator(".react-flow__edgelabel-renderer button").allTextContents();
  assert.ok(labels.some(label => label.includes("Linear")));
  assert.ok(labels.some(label => label.includes("ClickUp")));
  assert.ok(labels.every(value => !value.includes(projectUuid) && !value.includes("123456789")));
  await graph.getByRole("button", { name: /2 events/ }).click();
  await page.getByRole("dialog", { name: "Grouped connections" }).getByRole("button", { name: /Linear/ }).first().click();
  await page.getByText("Linear · 00000000-0000-4000-8000-000000000098", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close connection details" }).click();
  await graph.getByRole("button", { name: /2 events/ }).click();
  await page.getByRole("dialog", { name: "Grouped connections" }).getByRole("button", { name: /Linear/ }).nth(1).click();
  await page.getByText(`Linear · ${projectUuid}`, { exact: true }).waitFor();
  await context.close();
});

for (const view of ["table", "graph"]) test(`${view} view creates and opens a team Trigger on mobile`, async () => {
  const {page, context} = await contextFor({viewport: {width: 390, height: 844}});
  let saved;
  const detail = () => ({...summary,model:"fixture",modelAccountId:"00000000-0000-4000-8000-000000000090", ...saved, events: [], executionConfig: {connectionId: "vm", agentKind: "pi"}, prompt: "Review", runNameTemplate: "", runScopes: []});
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session" || path === "/api/v1/runs") return route.fallback();
    const fixtures = {
      "/api/v1/integrations": {exeConnections: [{connectionId:"vm",agentKind:"pi",models:[],tags:[]}],ampConnections:[],linear:null},
      "/api/v1/github-installations": [], "/api/v1/x/connections": {connections:[]},
      "/api/v1/team":{id:"team",runDefaults:{model:"fixture",modelAccountId:"00000000-0000-4000-8000-000000000090",requiresVm:false}},
      "/api/v1/model-accounts": {accounts:[{id:"00000000-0000-4000-8000-000000000090",name:"Fixture",credentialConfigured:true}]}, "/api/v1/integrations/bearer": {integrations:[]},
      "/api/v1/fly/connection": {connection:null}, "/api/v1/fly/execution-configurations": {configurations:[]},
      "/api/v1/vm-presets": {presets:[]}, "/api/v1/skills": {items:[],nextCursor:null},
      "/api/v1/trigger-event-availability": {manual:true,schedule:true,triggerLifecycle:true},
      "/api/v1/event-contexts": {},
      "/api/v1/trigger-summaries": {items:saved?[detail()]:[],nextCursor:null},
      "/api/v1/triggers/graph": {nodes:saved?[{id:triggerId,type:"trigger",label:saved.name,enabled:true}]:[],edges:[]},
    };
    if (path === "/api/v1/triggers" && route.request().method() === "POST") {saved=route.request().postDataJSON();return route.fulfill({status:201,json:detail()});}
    if (path === `/api/v1/triggers/${triggerId}`) return route.fulfill({json:detail()});
    return route.fulfill({json:fixtures[path] ?? {items:[],nextCursor:null}});
  });
  await page.goto(origin + "/triggers" + (view === "graph" ? "?view=graph" : ""));
  await page.getByRole("link", {name:"Create trigger",exact:true}).click();
  assert.equal(await page.getByLabel("Slug",{exact:true}).count(),0);
  assert.equal(await page.getByLabel("Description",{exact:true}).count(),0);
  await page.getByLabel("Name",{exact:true}).fill("review-builds");
  await page.getByLabel("Requires VM",{exact:true}).check();
  await page.getByRole("combobox",{name:/^Integration/}).selectOption("vm");
  await page.getByLabel("Prompt",{exact:true}).fill("Review");
  await page.getByRole("button",{name:"Create trigger",exact:true}).click();
  await page.waitForURL(`**/triggers/${triggerId}`);
  assert.equal(saved.name,"review-builds");
  await page.goto(origin + "/triggers" + (view === "graph" ? "?view=graph" : ""));
  const views = page.getByRole("navigation",{name:"Trigger views"});
  assert.equal(await views.getByRole("link",{name:view === "graph" ? "Graph" : "Table",exact:true}).getAttribute("aria-current"),"page");
  await page.getByRole("link",{name:view === "graph" ? "review-builds, not running" : "review-builds",exact:true}).click();
  await page.waitForURL(`**/triggers/${triggerId}`);
  await context.close();
});

for (const view of ["table", "graph"]) test(`${view} view displays loading, recoverable errors and empty team state`, async () => {
  const {page,context} = await contextFor();
  let release;
  const blocked = new Promise(resolve => {release=resolve;});
  let fail=true;
  await page.route(view === "table" ? "**/api/v1/trigger-summaries?**" : "**/api/v1/triggers/graph", async route => {
    await blocked;
    return fail ? route.fulfill({status:503,json:{error:{message:"Temporarily unavailable"}}}) : route.fulfill({json:view === "table" ? {items:[],nextCursor:null} : {nodes:[],edges:[]}});
  });
  await page.goto(origin + "/triggers" + (view === "graph" ? "?view=graph" : ""));
  await page.getByRole("status").filter({hasText:view === "table" ? "Loading triggers" : "Loading team graph"}).waitFor();
  release();
  await page.getByRole("alert").filter({hasText:"Temporarily unavailable"}).waitFor();
  fail=false;
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await page.getByText(view === "table" ? "No triggers yet" : "No triggers yet.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("link",{name:"Create trigger",exact:true}).count(),1);
  await context.close();
});

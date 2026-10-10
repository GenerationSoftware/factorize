import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const id = "00000000-0000-4000-8000-000000000001", triggerId = "00000000-0000-4000-8000-000000000003";
const initial = { id, name: "Review builds", slug: "review-builds", enabled: true, promptTemplate: "Original prompt", runNameTemplate: "", executionTargetId: "vm", executionTarget: { connectionId: "vm", agentKind: "codex" }, model: "gpt-6", effort: "high", concurrencyLimit: 2, runningCount: 0, currentRuns: 0, maxConcurrency: 2, agentKind: "codex", lastRunState: null, triggers: [{ id: triggerId, jobId: id, slug: "trigger-1", kind: "manual", enabled: true, config: {}, createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" }], createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" };
before(async () => {
  server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [], nextCursor: null } })); page.setDefaultTimeout(10000);
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  await page.route("**/api/v1/execution-targets", route => route.fulfill({ json: [{ id: "vm", kind: "exe-vm", name: "VM", workspace: "ephemeral", cwd: "/workspace", agentKind: "codex", models: ["gpt-6"], efforts: ["high"], capabilities: ["stop"] }] }));
  await page.route("**/api/v1/trigger-contexts", route => route.fulfill({ json: { manual: [{ path: "prompt", type: "string", description: "Manual prompt" }] } }));
  await page.route("**/api/v1/job-trigger-availability", route => route.fulfill({ json: { manual: true, schedule: true, jobLifecycle: true, linear: true, clickup: true, github: true, cloudflareTail: true } }));
  return { context, page };
}
test("stale editor reconciles non-overlapping fields, requires explicit conflict choice and preserves trigger identity", async () => {
  const { context, page } = await setup(); let current = structuredClone(initial); const writes = [];
  await page.route(`**/api/v1/jobs/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    const body = route.request().postDataJSON(); writes.push(body);
    if (writes.length === 1) { current = { ...current, name: "Someone else's name", concurrencyLimit: 4, updatedAt: "2026-10-09T13:00:00.000Z" }; return route.fulfill({ status: 409, json: { error: { code: "stale_job", message: "This job changed" } } }); }
    current = { ...current, ...body }; return route.fulfill({ json: current });
  });
  await page.goto(origin + `/jobs/${id}/edit`); await page.getByLabel("Name", { exact: true }).fill("My name"); await page.getByLabel("Prompt template", { exact: true }).fill("My prompt");
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.getByRole("button", { name: "Reconcile my changes" }).click();
  await page.getByRole("button", { name: "Keep latest name" }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Someone else's name"); assert.equal(await page.getByLabel("Prompt template", { exact: true }).inputValue(), "My prompt"); assert.equal(await page.getByLabel("Concurrency limit").inputValue(), "4");
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Job settings saved." }).waitFor();
  assert.equal(writes[0].expectedUpdatedAt, initial.updatedAt); assert.equal(writes[1].expectedUpdatedAt, "2026-10-09T13:00:00.000Z"); assert.equal(writes[1].triggers[0].id, triggerId); assert.equal(writes[1].triggers[0].slug, "trigger-1"); assert.equal(writes[1].promptTemplate, "My prompt"); await context.close();
});
test("create uses bounded lifecycle selector, lazy provider reads, schedule preview and typed form submission on mobile", async () => {
  const { context, page } = await setup({ viewport: { width: 390, height: 844 } }); let body, providerReads = 0; const selectors = [];
  await page.route("**/api/v1/providers/**", route => { providerReads++; return route.fulfill({ json: [] }); });
  await page.route("**/api/v1/job-selector?**", route => { selectors.push(new URL(route.request().url())); return route.fulfill({ json: { items: [{ id, name: "Source", slug: "source", enabled: true }], nextCursor: null } }); });
  await page.route("**/api/v1/schedules/preview", route => route.fulfill({ json: { nextRunAt: "2026-10-09T14:00:00.000Z" } }));
  await page.route("**/api/v1/jobs", route => { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...initial, ...body } }); });
  await page.route(`**/api/v1/jobs/${id}`, route => route.fulfill({ json: initial }));
  await page.goto(origin + "/jobs/new"); await page.getByLabel("Name", { exact: true }).fill("Created job"); await page.getByLabel("Slug", { exact: true }).fill("created-job"); await page.getByLabel("Execution target").selectOption("vm"); await page.getByLabel("Prompt template", { exact: true }).fill("Do work");
  await page.getByRole("button", { name: "Add trigger" }).click(); await page.getByRole("button", { name: "Preview schedule" }).click(); await page.getByText("Next run: 2026-10-09T14:00:00.000Z").waitFor();
  await page.getByLabel("New trigger kind").selectOption("jobLifecycle"); await page.getByRole("button", { name: "Add trigger" }).click(); await page.getByLabel("Search source jobs").fill("Source"); await page.getByLabel("Source", { exact: true }).check();
  assert.equal(providerReads, 0); assert.ok(selectors.every(url => url.searchParams.get("limit") === "30"));
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.waitForURL(`**/jobs/${id}`);
  assert.equal(body.name, "Created job"); assert.deepEqual(body.triggers[2].config.sourceJobIds, [id]); assert.equal(body.expectedUpdatedAt, undefined); await context.close();
});
test("template insertion escapes values and navigation protects unsaved work", async () => {
  const { context, page } = await setup(); await page.route(`**/api/v1/jobs/${id}`, route => route.fulfill({ json: initial }));
  await page.goto(origin + `/jobs/${id}/edit`); await page.getByText("Insert a prompt template variable", { exact: true }).click(); await page.getByLabel("Prompt template", { exact: true }).focus(); await page.getByLabel("Prompt template", { exact: true }).press("End"); await page.getByRole("button", { name: "trigger-1.prompt", exact: true }).click();
  assert.equal(await page.getByLabel("Prompt template", { exact: true }).inputValue(), "Original prompt{{trigger-1.prompt}}");
  page.once("dialog", dialog => dialog.dismiss()); await page.locator("main").getByRole("link", { name: "Jobs", exact: true }).click(); assert.ok(page.url().includes("/settings")); await context.close();
});
test("provider editor fetches only the selected provider and submits project/matching/conditions configuration explicitly", async () => {
  const { context, page } = await setup(); const reads = [], writes = []; let current = structuredClone(initial);
  await page.route(`**/api/v1/jobs/${id}`, route => { if (route.request().method() === "GET") return route.fulfill({ json: current }); const body = route.request().postDataJSON(); writes.push(body); current = { ...current, ...body, triggers: body.triggers.map((trigger, index) => ({ ...trigger, id: trigger.id ?? `00000000-0000-4000-8000-00000000000${index + 4}`, jobId: id, createdAt: initial.createdAt, updatedAt: initial.updatedAt })) }; return route.fulfill({ json: current }); });
  await page.route("**/api/v1/providers/**", route => { reads.push(new URL(route.request().url()).pathname); return route.fulfill({ json: route.request().url().endsWith("/projects") ? [{ id: "project", name: "Release" }] : { statuses: [{ id: "done", name: "Done" }], users: [], labels: [] } }); });
  await page.route("**/api/v1/job-conditions/test", route => route.fulfill({ json: { decision: "match", details: [] } }));
  await page.goto(origin + `/jobs/${id}/edit`); assert.equal(reads.length, 0); await page.getByLabel("New trigger kind").selectOption("webhook"); await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByLabel("Linear project").selectOption("project"); await page.getByRole("button", { name: "Add matching rule" }).click(); await page.getByLabel("Match value").selectOption("done"); await page.getByLabel("Conditions JSON (optional)").fill('{"all":[{"fact":"webhook","path":"$.issue.id","operator":"equal","value":"i1"}]}');
  await page.getByText("Test webhook conditions", { exact: true }).click(); await page.getByRole("button", { name: "Test conditions", exact: true }).click(); await page.getByRole("status").filter({ hasText: '"decision": "match"' }).waitFor();
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Job settings saved." }).waitFor();
  assert.ok(reads.every(path => path.startsWith("/api/v1/providers/linear/"))); assert.deepEqual(writes[0].triggers[1].config, { provider: "linear", projectId: "project", matchRules: [{ type: "status", targetId: "done" }], conditions: { all: [{ fact: "webhook", path: "$.issue.id", operator: "equal", value: "i1" }] } }); assert.equal(writes[0].triggers[0].id, triggerId); await context.close();
});
test("search dialog keeps keyboard focus, escapes results and leaves a draft intact after chunk failure", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/jobs/" + id, route => route.fulfill({ json: initial }));
  await page.route("**/api/v1/search?**", route => route.fulfill({ json: { items: [{ kind: "job", id, title: "<script>unsafe</script> Build", subtitle: "Matching job", url: "/jobs/" + id }] } }));
  await page.goto(origin + "/jobs/" + id + "/edit");
  await page.getByLabel("Name", { exact: true }).fill("Unsaved draft");
  await page.getByRole("button", { name: "Search jobs and runs", exact: true }).click();
  await page.getByRole("combobox", { name: "Search jobs and runs", exact: true }).fill("build");
  await page.getByRole("listbox", { name: "Search results" }).getByRole("option").waitFor();
  assert.match(await page.getByRole("listbox", { name: "Search results" }).getByRole("option").innerText(), /<script>unsafe<\/script>/);
  assert.equal(await page.locator("dialog script").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Unsaved draft");
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));
  await page.getByText("A page could not load. Copy any unsaved changes before reloading.").waitFor();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Unsaved draft");
  await context.close();
});
test("provider changes load ClickUp, GitHub and Tail resources lazily and submit the selected configuration", async () => {
  const { context, page } = await setup(); const reads = []; let written;
  const value = { ...initial, triggers: [...initial.triggers, { ...initial.triggers[0], id: "00000000-0000-4000-8000-000000000004", slug: "trigger-2", kind: "webhook", config: { provider: "clickup", listId: "list", matchRules: [{ type: "status", targetId: "open" }], conditions: { fact: "webhook", path: "$.event", operator: "notEqual", value: "ignored" } } }] };
  await page.route("**/api/v1/providers/**", route => {
    const path = new URL(route.request().url()).pathname; reads.push(path);
    const json = path.endsWith("/clickup/lists") ? [{ id: "list", name: "Build tasks" }] : path.endsWith("/installations") ? [{ installationId: "123", accountLogin: "owner", state: "active" }] : path.endsWith("/repositories") ? [{ id: 456, fullName: "owner/repo" }] : { statuses: [{ id: "open", name: "Open" }], users: [], labels: [] };
    return route.fulfill({ json });
  });
  await page.route("**/api/v1/integrations/cloudflare-tail", route => { reads.push("tail"); return route.fulfill({ json: [{ integrationId: "tail", name: "Worker logs" }] }); });
  await page.route("**/api/v1/jobs/" + id, route => { if (route.request().method() === "PUT") { written = route.request().postDataJSON(); return route.fulfill({ json: { ...value, ...written } }); } return route.fulfill({ json: value }); });
  await page.goto(origin + "/jobs/" + id + "/edit"); await page.getByLabel("ClickUp list", { exact: true }).selectOption("list");
  assert.ok(reads.some(path => path.endsWith("/clickup/lists"))); assert.ok(!reads.some(path => path.includes("github") || path === "tail" || path.includes("linear")));
  await page.getByLabel("Provider", { exact: true }).selectOption("github"); await page.getByLabel("GitHub installation", { exact: true }).selectOption("123"); await page.getByLabel("GitHub repository", { exact: true }).selectOption("456");
  await page.getByLabel("Provider", { exact: true }).selectOption("cloudflareTail"); await page.getByLabel("Tail integration", { exact: true }).selectOption("tail"); await page.getByRole("button", { name: "Save job", exact: true }).click();
  await page.getByRole("heading", { name: initial.name, exact: true }).waitFor(); assert.deepEqual(written.triggers[1].config, { provider: "cloudflareTail", integrationId: "tail", conditions: value.triggers[1].config.conditions }); assert.equal(written.expectedUpdatedAt, initial.updatedAt);
  await context.close();
});
for (const config of [
  { provider: "linear", projectId: "p", matchRules: [{ type: "status", targetId: "done" }] },
  { provider: "clickup", listId: "l", matchRules: [{ type: "status", targetId: "done" }] },
  { provider: "github", installationId: 123, repositoryId: 456, event: "check_suite", action: "completed" },
  { provider: "cloudflareTail", integrationId: "tail" },
]) test(`${config.provider} edit/save round-trips conditions, routing and trigger identity`, async () => {
  const { context, page } = await setup(); let written, preview;
  const conditions = { not: { all: [{ fact: "webhook", path: "$.ignored", operator: "equal", value: true }] } };
  const changed = { all: [{ fact: "webhook", path: "$.provider", operator: "equal", value: config.provider }] };
  const hook = { ...initial.triggers[0], id: "00000000-0000-4000-8000-000000000004", slug: "trigger-2", kind: "webhook", config: { ...config, conditions, ...(config.provider === "cloudflareTail" ? { destination: "https://tail.example.test/webhook" } : {}) } };
  const value = { ...initial, triggers: [...initial.triggers, hook] };
  await page.route("**/api/v1/providers/**", route => { const path = new URL(route.request().url()).pathname; return route.fulfill({ json: path.endsWith("/projects") || path.endsWith("/lists") || path.endsWith("/installations") || path.endsWith("/repositories") ? [] : { statuses: [], labels: [], users: [] } }); });
  await page.route("**/api/v1/integrations/cloudflare-tail", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/jobs/" + id, route => { if (route.request().method() === "PUT") { written = route.request().postDataJSON(); return route.fulfill({ json: { ...value, ...written } }); } return route.fulfill({ json: value }); });
  await page.route("**/api/v1/job-conditions/test", route => { preview = route.request().postDataJSON(); return route.fulfill({ json: { decision: "match", details: [] } }); });
  await page.goto(origin + "/jobs/" + id + "/edit");
  if (config.provider === "cloudflareTail") await page.getByText("https://tail.example.test/webhook", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await page.getByLabel("Conditions JSON (optional)").inputValue()), conditions);
  if (config.provider === "github") { assert.equal(await page.getByLabel("GitHub event").inputValue(), "check_suite"); assert.equal(await page.getByLabel("GitHub action").inputValue(), "completed"); }
  await page.getByLabel("Conditions JSON (optional)").fill("{");
  await page.getByLabel("Name", { exact: true }).fill("Draft name");
  await page.getByRole("button", { name: "Save job", exact: true }).click();
  assert.equal(written, undefined); await page.getByText("Conditions must be valid JSON before saving.").waitFor();
  await page.getByLabel("Conditions JSON (optional)").fill(JSON.stringify(changed));
  await page.getByText("Test webhook conditions", { exact: true }).click();
  await page.getByLabel("Example webhook JSON").fill(JSON.stringify({ provider: config.provider }));
  await page.getByRole("button", { name: "Test conditions", exact: true }).click();
  await page.getByRole("status").filter({ hasText: '"decision": "match"' }).waitFor();
  assert.deepEqual(preview, { conditions: changed, webhook: { provider: config.provider } });
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Job settings saved." }).waitFor();
  assert.deepEqual(written.triggers[1], { id: hook.id, slug: hook.slug, kind: hook.kind, enabled: hook.enabled, config: { ...config, conditions: changed } });
  assert.deepEqual(JSON.parse(await page.getByLabel("Conditions JSON (optional)").inputValue()), changed); await context.close();
});
test("conditions save surfaces strict server validation errors", async () => {
  const { context, page } = await setup();
  const value = { ...initial, triggers: [...initial.triggers, { ...initial.triggers[0], id: "00000000-0000-4000-8000-000000000004", slug: "trigger-2", kind: "webhook", config: { provider: "cloudflareTail", integrationId: "tail" } }] };
  await page.route("**/api/v1/integrations/cloudflare-tail", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/jobs/" + id, route => route.request().method() === "PUT" ? route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Request validation failed", details: [{ path: ["triggers", 1, "config", "conditions"], message: "Condition groups must not be empty." }] } } }) : route.fulfill({ json: value }));
  await page.goto(origin + "/jobs/" + id + "/edit"); await page.getByLabel("Conditions JSON (optional)").fill('{"all":[]}');
  await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Condition groups must not be empty." }).waitFor();
  await context.close();
});

test("Settings edits and saves repeatedly, preserves revision, protects dirty tab navigation and deletes from Settings on mobile", async () => {
  const { page, context } = await setup({ viewport: { width: 390, height: 844 } });
  let current = structuredClone(initial), deleting, finishSave;
  const writes = [];
  await page.route(`**/api/v1/jobs/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    if (route.request().method() === "DELETE") { deleting = true; return route.fulfill({ status: 204 }); }
    const body = route.request().postDataJSON(); writes.push(body);
    current = { ...current, ...body, updatedAt: `2026-10-09T1${writes.length}:00:00.000Z` };
    if (writes.length === 1) { finishSave = () => route.fulfill({ json: current }); return; }
    return route.fulfill({ json: current });
  });
  await page.route("**/api/v1/job-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto(origin + `/jobs/${id}`);
  const tabs = page.getByRole("navigation", { name: "Job views" });
  await tabs.getByRole("link", { name: "Settings", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.waitForURL(`**/jobs/${id}/settings`);
  await page.getByLabel("Name", { exact: true }).fill("Renamed job");
  await page.getByLabel("Prompt template", { exact: true }).fill("Updated instructions");
  page.once("dialog", dialog => dialog.dismiss()); await tabs.getByRole("link", { name: "Runs", exact: true }).click();
  assert.ok(page.url().endsWith("/settings"));
  await page.getByRole("button", { name: "Save job", exact: true }).click();
  await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Saving…", exact: true }).isDisabled(), true);
  await finishSave(); await page.getByRole("status").filter({ hasText: "Job settings saved." }).waitFor();
  assert.equal(writes[0].name, "Renamed job"); assert.equal(writes[0].promptTemplate, "Updated instructions");
  assert.ok(page.url().endsWith("/settings"));
  await page.getByLabel("Prompt template", { exact: true }).fill("Second update");
  await page.getByRole("button", { name: "Save job", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Job settings saved." }).waitFor();
  assert.equal(writes[1].expectedUpdatedAt, "2026-10-09T11:00:00.000Z");
  await page.reload(); await page.getByLabel("Prompt template", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Prompt template", { exact: true }).inputValue(), "Second update");
  await page.getByRole("heading", { name: "Delete this job", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel("Name", { exact: true }).fill("Unsaved name before deletion");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Delete job", exact: true }).click();
  await page.waitForURL("**/jobs?q=*"); assert.equal(deleting, true);
  await context.close();
});

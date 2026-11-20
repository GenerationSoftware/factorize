import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
const id = "00000000-0000-4000-8000-000000000001", eventId = "00000000-0000-4000-8000-000000000003";
const initial = { requiresVm:true,modelAccountId:"model",id, name: "review-builds", slug: "review-builds", enabled: true, prompt: "Original prompt", runNameTemplate: "", executionConfigId: "vm", executionConfig: { connectionId: "vm", agentKind: "codex" }, model: "gpt-6", effort: "high", concurrencyLimit: 2, runningCount: 0, currentRuns: 0, maxConcurrency: 2, agentKind: "codex", lastRunState: null, events: [{ id: eventId, triggerId: id, slug: "event-1", kind: "manual", enabled: true, config: {}, createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" }], createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" };
before(async () => {
  server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route("**/api/v1/runs?**", route => route.fulfill({ json: { items: [], nextCursor: null } })); page.setDefaultTimeout(30000);
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [{ connectionId: "vm", agentKind: "codex", tags: [], models: ["gpt-6"] }], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/team", route => route.fulfill({json:{id:"tenant",name:"Team",runDefaults:{model:"gpt-6",modelAccountId:"model"}}}));
  await page.route("**/api/v1/model-accounts",route=>route.fulfill({json:{revision:1,accounts:[{id:"model",name:"Local model",credentialConfigured:true}]}}));
  await page.route("**/api/v1/vm-presets", route => route.fulfill({ json: { presets: [] } }));
  await page.route("**/api/v1/github-installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/x/connections", route => route.fulfill({ json: { connections: [] } }));
  await page.route("**/api/v1/event-contexts", route => route.fulfill({ json: { manual: [{ path: "prompt", type: "string", description: "Manual prompt" }] } }));
  await page.route("**/api/v1/trigger-event-availability", route => route.fulfill({ json: { manual: true, schedule: true, triggerLifecycle: true, linear: true, clickup: true, github: true, cloudflareTail: true } }));
  return { context, page };
}
test("Integrations displays credentials cached by the Trigger editor", async t => {
  const { context, page } = await setup();
  t.after(() => context.close());
  const bearer = { id: "bearer-1", name: "Build API", origin: "https://api.example.test", description: null, revision: 1 };
  const account = { id: "account-1", name: "Build account", credentialConfigured: true, revision: 1 };
  await page.route(`**/api/v1/triggers/${id}`, route => route.fulfill({ json: { ...initial, modelAccess: "portable" } }));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({ json: { revision: 1, integrations: [bearer] } }));
  await page.route("**/api/v1/model-accounts", route => route.fulfill({ json: { revision: 1, accounts: [account] } }));
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.goto(origin + `/triggers/${id}/settings/permissions`);
  await page.getByRole("checkbox", { name: bearer.name }).waitFor();
  await page.getByRole("option", { name: account.name }).waitFor({ state: "attached" });
  await page.getByRole("link", { name: "Factorize dashboard" }).click();
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  const list = page.getByRole("list", { name: "Your integrations" });
  await list.getByText(bearer.name, { exact: true }).waitFor();
  await list.getByText(account.name, { exact: true }).waitFor();
});

test("stale editor reconciles non-overlapping fields, requires explicit conflict choice and preserves event identity", async () => {
  const { context, page } = await setup(); let current = structuredClone(initial); const writes = [];
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    const body = route.request().postDataJSON(); writes.push(body);
    if (writes.length === 1) { current = { ...current, name: "someone-elses-name", description: "Latest description", updatedAt: "2026-10-09T13:00:00.000Z" }; return route.fulfill({ status: 409, json: { error: { code: "stale_trigger", message: "This trigger changed" } } }); }
    current = { ...current, ...body }; return route.fulfill({ json: current });
  });
  await page.goto(origin + `/triggers/${id}/settings/general`); await page.getByLabel("Name", { exact: true }).fill("my-name"); await page.getByRole("alert").filter({ hasText: "This trigger changed while you were editing" }).waitFor(); await page.getByRole("button", { name: "Reconcile my changes" }).click();
  await page.getByRole("button", { name: "Keep my name" }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "my-name");
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.equal(writes[0].expectedUpdatedAt, initial.updatedAt); assert.equal(writes[1].expectedUpdatedAt, "2026-10-09T13:00:00.000Z"); assert.equal(writes[1].events[0].id, eventId); assert.equal(writes[1].events[0].slug, "event-1"); assert.equal(writes[1].name, "my-name"); assert.equal("slug" in writes[1], false); await context.close();
});
test("All runs complete source triggers can be selected throughout the team", async () => {
  const { context, page } = await setup();
  const projectA = "00000000-0000-4000-8000-000000000020", projectB = "00000000-0000-4000-8000-000000000021";
  const sameProjectTrigger = "00000000-0000-4000-8000-000000000022", otherProjectTrigger = "00000000-0000-4000-8000-000000000023";
  let current = { ...structuredClone(initial), projectId: projectA, events: [{ ...initial.events[0], kind: "triggerIdle", config: { sourceTriggerIds: [] } }] }, saved;
  const selectorRequests = [];
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    saved = route.request().postDataJSON(); current = { ...current, ...saved }; return route.fulfill({ json: current });
  });
  await page.route("**/api/v1/trigger-selector?**", route => {
    const url = new URL(route.request().url()); selectorRequests.push(url);
    const projectId = url.searchParams.get("projectId"), q = url.searchParams.get("q") ?? "";
    const allTriggers = [
      { id: sameProjectTrigger, projectId: projectA, name: "Alpha source", slug: "alpha-source", enabled: true },
      { id: otherProjectTrigger, projectId: projectB, name: "Alpha other", slug: "alpha-other", enabled: true },
    ];
    return route.fulfill({ json: { items: allTriggers.filter(trigger => trigger.name.toLowerCase().includes(q.toLowerCase())).map(({ projectId: _projectId, ...trigger }) => trigger), nextCursor: null } });
  });
  await page.goto(origin + `/triggers/${id}/settings/events`);
  await page.getByLabel("Search source triggers").fill("Alpha");
  await page.getByLabel("Alpha source", { exact: true }).check();
  assert.equal(await page.getByLabel("Alpha other", { exact: true }).count(), 1);
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.ok(selectorRequests.length > 0);
  assert.ok(selectorRequests.every(url => !url.searchParams.has("projectId")));
  assert.ok(selectorRequests.some(url => url.searchParams.get("q") === "Alpha"));
  assert.deepEqual(saved.events[0].config.sourceTriggerIds, [sameProjectTrigger]);
  const manualSelector = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/v1/trigger-selector" && !url.searchParams.has("projectId"); });
  await page.goto(origin + `/triggers/${id}/settings/permissions`);
  await page.getByRole("heading", { name: "Manual invocation permissions" }).waitFor();
  await manualSelector;
  assert.ok(selectorRequests.every(url => !url.searchParams.has("projectId")), "manual permission selector covers the team");
  assert.equal(projectA, current.projectId); assert.notEqual(projectA, projectB);
  await context.close();
});
test("run permission scopes autosave and survive reload", async () => {
  const { context, page } = await setup();
  let current = { ...structuredClone(initial), runScopes: ["triggers:read", "runs:read"] }, saved;
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    saved = route.request().postDataJSON();
    current = { ...current, ...saved, updatedAt: "2026-11-06T00:00:00.000Z" };
    return route.fulfill({ json: current });
  });
  await page.goto(origin + `/triggers/${id}/settings/permissions`);
  await page.getByRole("checkbox", { name: "Run scope triggers:write", exact: true }).check();
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.deepEqual(saved.runScopes, ["triggers:read", "runs:read", "triggers:write"]);
  await page.reload();
  assert.equal(await page.getByRole("checkbox", { name: "Run scope triggers:write", exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Run scope integrations:write", exact: true }).isChecked(), false);
  await page.getByRole("checkbox", { name: "Run scope triggers:write", exact: true }).uncheck();
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.deepEqual(saved.runScopes, ["triggers:read", "runs:read"]);
  await context.close();
});
test("trigger editor selects a connected X account and preserves its safe scopes in the trigger write", async () => {
  const { context, page } = await setup();
  const xId = "00000000-0000-4000-8000-000000000099"; let current = structuredClone(initial), saved;
  await page.route(`**/api/v1/triggers/${id}`, route => { if (route.request().method() === "GET") return route.fulfill({ json: current }); saved = route.request().postDataJSON(); current = { ...current, ...saved }; return route.fulfill({ json: current }); });
  await page.route("**/api/v1/x/connections", route => route.fulfill({ json: { connections: [{ id: xId, name: "Release account", clientId: "public-client", scopes: ["tweet.read", "users.read", "offline.access"], accountId: "123", accountHandle: "release_bot", grantedScopes: ["tweet.read", "users.read", "offline.access"], status: "connected", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }] } }));
  await page.goto(origin + `/triggers/${id}/settings/permissions`);
  await page.getByLabel(/X · Release account \(@release_bot\)/).check();
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.deepEqual(saved.xConnectionIds, [xId]);
  await page.reload();
  assert.equal(await page.getByLabel(/X · Release account \(@release_bot\)/).isChecked(), true);
  await context.close();
});
test("manual invocation permissions include the current trigger and triggers in the same project", async () => {
  const { context, page } = await setup();
  const projectA = "00000000-0000-4000-8000-000000000020", destination = "00000000-0000-4000-8000-000000000024";
  let saved, selectorUrl;
  await page.route(`**/api/v1/triggers/${id}`, route => route.fulfill({ json: { ...initial, projectId: projectA } }));
  await page.route(`**/api/v1/triggers/${id}/invocation-permissions`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { sourceTriggerId: id, destinationTriggerIds: [] } });
    saved = route.request().postDataJSON(); return route.fulfill({ json: { sourceTriggerId: id, ...saved } });
  });
  await page.route("**/api/v1/trigger-selector?**", route => { selectorUrl = new URL(route.request().url()); return route.fulfill({ json: { items: [{ id: destination, name: "Same project destination", slug: "same-project", enabled: true }], nextCursor: null } }); });
  await page.goto(origin + `/triggers/${id}/settings/permissions`);
  await page.getByLabel("Current trigger (allow this trigger to invoke itself)", { exact: true }).check();
  await page.getByLabel("Same project destination", { exact: true }).check();
  await page.getByRole("button", { name: "Save permissions" }).click();
  await page.getByRole("status").filter({ hasText: "Manual invocation permissions saved." }).waitFor();
  assert.deepEqual(saved, { destinationTriggerIds: [id, destination] });
  assert.equal(selectorUrl.searchParams.has("projectId"), false);
  await context.close();
});
test("create uses bounded lifecycle selector, lazy provider reads, schedule preview and typed form submission on mobile", async () => {
  const { context, page } = await setup({ viewport: { width: 390, height: 844 } }); let body, providerReads = 0; const selectors = [];
  const projectId = "00000000-0000-4000-8000-000000000010";
  await page.route("**/api/v1/projects", route => route.fulfill({ json: [{ id: projectId, name: "Release project", description: "", triggerCount: 0 }] }));
  await page.route("**/api/v1/providers/**", route => { providerReads++; return route.fulfill({ json: [] }); });
  await page.route("**/api/v1/trigger-selector?**", route => { selectors.push(new URL(route.request().url())); return route.fulfill({ json: { items: [{ id, name: "Source", slug: "source", enabled: true }], nextCursor: null } }); });
  await page.route("**/api/v1/schedules/preview", route => route.fulfill({ json: { nextRunAt: "2026-10-09T14:00:00.000Z" } }));
  await page.route("**/api/v1/triggers", route => { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...initial, ...body } }); });
  await page.route(`**/api/v1/triggers/${id}`, route => route.fulfill({ json: initial }));
  await page.goto(origin + "/triggers/new"); await page.getByLabel("Name", { exact: true }).fill("created-trigger"); await page.getByLabel("Requires VM",{exact:true}).check(); await page.getByRole("combobox", { name: /^Integration/ }).selectOption("vm"); await page.getByLabel("Prompt", { exact: true }).fill("Do work");
  await page.getByRole("button", { name: "Add event" }).click(); await page.getByRole("button", { name: "Preview schedule" }).click(); await page.getByText("Next run: 2026-10-09T14:00:00.000Z").waitFor();
  await page.getByLabel("New event kind").selectOption("triggerLifecycle"); await page.getByRole("button", { name: "Add event" }).click(); await page.getByLabel("Search source triggers").fill("Source"); await page.getByLabel("Source", { exact: true }).check();
  assert.equal(providerReads, 0); assert.ok(selectors.every(url => url.searchParams.get("limit") === "30"));
  await page.getByRole("button", { name: "Create trigger", exact: true }).click(); await page.waitForURL(`**/triggers/${id}`);
  assert.equal(body.name, "created-trigger"); assert.equal(body.projectId, undefined); assert.deepEqual(body.events[2].config.sourceTriggerIds, [id]); assert.equal(body.expectedUpdatedAt, undefined); await context.close();
});
test("image verification is explicit, autosave never provisions, and stale verification results are ignored", async () => {
  const { context, page } = await setup(); let current = { ...initial, executionConfig: { ...initial.executionConfig, image: "ghcr.io/acme/base:old" } }, createCount = 0, releaseCreate;
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { exeConnections: [{ connectionId: "vm", agentKind: "codex", accountTags: ["github"], models: ["gpt-6"] }], ampConnections: [] } }));
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    const body = route.request().postDataJSON(); current = { ...current, ...body, executionConfig: { ...current.executionConfig, image: body.vmImage || undefined } }; return route.fulfill({ json: current });
  });
  await page.route("**/api/v1/vm-image-verifications", async route => {
    createCount++;
    if (createCount === 1) { await new Promise(resolve => { releaseCreate = resolve; }); return route.fulfill({ json: { id: "00000000-0000-4000-8000-000000000111", status: "queued", phase: "queued", errorKind: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }); }
    return route.fulfill({ json: { id: "00000000-0000-4000-8000-000000000112", status: "queued", phase: "queued", errorKind: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  });
  await page.route("**/api/v1/vm-image-verifications/*", route => route.fulfill({ json: { id: "00000000-0000-4000-8000-000000000112", status: "succeeded", phase: "Verification passed. Image pull, SSH, and agent prerequisites worked at this time.", errorKind: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  await page.goto(origin + `/triggers/${id}/settings/vm`); await page.getByLabel("VM image").fill("ghcr.io/acme/base:one");
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor(); assert.equal(createCount, 0);
  await page.getByRole("button", { name: "Verify image" }).click(); await page.getByText("Starting verification…").waitFor(); await page.getByLabel("VM image").fill("ghcr.io/acme/base:two"); releaseCreate();
  await page.getByRole("status").filter({ hasText: "Not verified" }).waitFor(); assert.equal(createCount, 1);
  await page.getByRole("button", { name: "Verify image" }).click();
  await page.getByRole("status").filter({ hasText: "Verification passed" }).waitFor(); assert.equal(createCount, 2);
  await page.getByLabel("VM image").fill("GHCR.IO/ACME/base:two");
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  await page.getByRole("status").filter({ hasText: "Verified: Verification passed" }).waitFor();
  await page.getByLabel("VM tags").selectOption(["github"]);
  await page.getByRole("status").filter({ hasText: "Not verified" }).waitFor(); await context.close();
});
test("template insertion escapes values and navigation protects unsaved work", async t => {
  const { context, page } = await setup(); t.after(() => context.close());
  // Keep a save in flight so navigation always exercises a genuinely dirty draft.
  await page.route(`**/api/v1/triggers/${id}`, route => route.request().method() === "GET" ? route.fulfill({ json: { ...initial, projectId: "project" } }) : undefined);
  await page.goto(origin + `/triggers/${id}/settings/events`); await page.getByText("Insert a event template variable", { exact: true }).click(); await page.getByLabel("Event template", { exact: true }).focus(); await page.getByRole("button", { name: "prompt", exact: true }).click();
  assert.equal(await page.getByLabel("Event template", { exact: true }).inputValue(), "{{prompt}}");
  let blocked = false; page.once("dialog", async dialog => { blocked = true; await dialog.dismiss(); }); await page.getByRole("navigation", { name: "Trigger navigation" }).getByRole("link", { name: "Runs", exact: true }).click(); assert.equal(blocked, true); assert.ok(page.url().includes("/settings")); await context.close();
});
test("provider editor fetches only the selected provider and submits project/matching/conditions configuration explicitly", async () => {
  const { context, page } = await setup(); const reads = [], writes = []; let current = structuredClone(initial);
  await page.route(`**/api/v1/triggers/${id}`, route => { if (route.request().method() === "GET") return route.fulfill({ json: current }); const body = route.request().postDataJSON(); writes.push(body); current = { ...current, ...body, events: body.events.map((event, index) => ({ ...event, id: event.id ?? `00000000-0000-4000-8000-00000000000${index + 4}`, triggerId: id, createdAt: initial.createdAt, updatedAt: initial.updatedAt })) }; return route.fulfill({ json: current }); });
  await page.route("**/api/v1/providers/**", route => { reads.push(new URL(route.request().url()).pathname); return route.fulfill({ json: route.request().url().endsWith("/projects") ? [{ id: "project", name: "Release" }] : { statuses: [{ id: "done", name: "Done" }], users: [], labels: [] } }); });
  let conditionTests = 0; await page.route("**/api/v1/trigger-conditions/test", route => { conditionTests++; return route.fulfill({ json: { decision: "match", details: [] } }); });
  await page.goto(origin + `/triggers/${id}/settings/events`); assert.equal(reads.length, 0);
  // Invalid input suspends autosave while this test assembles the complete configuration.
  await page.getByLabel("New event kind").selectOption("webhook"); await page.getByRole("button", { name: "Add event" }).click();
  await page.getByLabel("Linear project").selectOption("project"); await page.getByRole("button", { name: "Add matching rule" }).click(); await page.getByLabel("Match value").selectOption("done"); await page.getByLabel("Conditions JSON (optional)").fill('{"all":[{"fact":"webhook","path":"$.issue.id","operator":"equal","value":"i1"}]}');
  const savedRequest = page.waitForRequest(request => request.method() === "PUT" && request.url().endsWith(`/api/v1/triggers/${id}`) && request.postDataJSON().events[1]?.config.conditions);
  const submitted = (await savedRequest).postDataJSON();
  await page.getByRole("status").filter({ hasText: "Saving trigger settings…" }).waitFor(); await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  // Saving assigns event IDs and can remount the event editor. Open it afterwards.
  await page.getByText("Test webhook conditions", { exact: true }).click(); await page.getByRole("button", { name: "Test conditions", exact: true }).waitFor({ state: "visible" }); await page.getByRole("button", { name: "Test conditions", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Conditions match the example webhook." }).waitFor();
  assert.equal(conditionTests, 1);
  assert.equal(await page.getByText('"decision": "match"', { exact: false }).count(), 0);
  assert.ok(reads.every(path => path.startsWith("/api/v1/providers/linear/"))); assert.deepEqual(submitted.events[1].config, { provider: "linear", projectId: "project", matchRules: [{ type: "status", targetId: "done" }], conditions: { all: [{ fact: "webhook", path: "$.issue.id", operator: "equal", value: "i1" }] } }); assert.equal(submitted.events[0].id, eventId); await context.close();
});
test("search dialog keeps keyboard focus, escapes results and leaves a draft intact after chunk failure", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/triggers/" + id, route => route.request().method() === "PUT" ? route.fulfill({ json: { ...initial, ...route.request().postDataJSON() } }) : route.fulfill({ json: initial }));
  await page.route("**/api/v1/search?**", route => route.fulfill({ json: { items: [{ kind: "trigger", id, title: "<script>unsafe</script> Build", subtitle: "Matching trigger", url: "/triggers/" + id, source: { kind: "trigger", label: "<script>unsafe</script> Build", id }, match: { text: "<script>unsafe</script> Build", ranges: [{ start: 24, end: 29 }] } }] } }));
  await page.goto(origin + "/triggers/" + id + "/settings/general");
  await page.getByLabel("Name", { exact: true }).fill("unsaved-draft");
  await page.getByRole("button", { name: "Search triggers, runs, and messages", exact: true }).click();
  await page.getByRole("combobox", { name: "Search triggers and runs by name, title, or issue identifier", exact: true }).fill("build");
  await page.getByRole("listbox", { name: "Search results" }).getByRole("option").waitFor();
  assert.match(await page.getByRole("listbox", { name: "Search results" }).getByRole("option").innerText(), /<script>unsafe<\/script>/);
  assert.equal(await page.getByRole("listbox", { name: "Search results" }).getByRole("option").locator("strong").innerText(), "Build");
  assert.equal(await page.locator("dialog script").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "unsaved-draft");
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })));
  await page.getByText("A page could not load. Copy any unsaved changes before reloading.").waitFor();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "unsaved-draft");
  await context.close();
});
test("provider changes load ClickUp, GitHub and Tail resources lazily and submit the selected configuration", async () => {
  const { context, page } = await setup(); const reads = []; let written;
  const value = { ...initial, events: [...initial.events, { ...initial.events[0], id: "00000000-0000-4000-8000-000000000004", slug: "event-2", kind: "webhook", config: { provider: "clickup", listId: "list", matchRules: [{ type: "status", targetId: "open" }], conditions: { fact: "webhook", path: "$.event", operator: "notEqual", value: "ignored" } } }] };
  await page.route("**/api/v1/providers/**", route => {
    const path = new URL(route.request().url()).pathname; reads.push(path);
    const json = path.endsWith("/clickup/lists") ? [{ id: "list", name: "Build tasks" }] : path.endsWith("/installations") ? [{ installationId: "123", accountLogin: "owner", state: "active" }] : path.endsWith("/repositories") ? [{ id: 456, fullName: "owner/repo" }] : { statuses: [{ id: "open", name: "Open" }], users: [], labels: [] };
    return route.fulfill({ json });
  });
  await page.route("**/api/v1/integrations/cloudflare-tail", route => { reads.push("tail"); return route.fulfill({ json: [{ integrationId: "tail", name: "Worker logs" }] }); });
  await page.route("**/api/v1/triggers/" + id, route => { if (route.request().method() === "PUT") { written = route.request().postDataJSON(); return route.fulfill({ json: { ...value, ...written } }); } return route.fulfill({ json: value }); });
  await page.goto(origin + "/triggers/" + id + "/settings/events"); await page.getByLabel("ClickUp list", { exact: true }).selectOption("list");
  assert.ok(reads.some(path => path.endsWith("/clickup/lists"))); assert.ok(!reads.some(path => path.includes("github") || path === "tail" || path.includes("linear")));
  await page.getByLabel("Provider", { exact: true }).selectOption("github"); await page.getByLabel("GitHub installation", { exact: true }).selectOption("123"); await page.getByLabel("GitHub repository", { exact: true }).selectOption("456");
  await page.getByLabel("Provider", { exact: true }).selectOption("cloudflareTail"); await page.getByLabel("Tail integration", { exact: true }).selectOption("tail"); await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.deepEqual(written.events[1].config, { provider: "cloudflareTail", integrationId: "tail", conditions: value.events[1].config.conditions }); assert.equal(written.expectedUpdatedAt, initial.updatedAt);
  await context.close();
});
for (const config of [
  { provider: "linear", projectId: "p", matchRules: [{ type: "status", targetId: "done" }] },
  { provider: "clickup", listId: "l", matchRules: [{ type: "status", targetId: "done" }] },
  { provider: "github", installationId: 123, repositoryId: 456, event: "check_suite", action: "completed" },
  { provider: "cloudflareTail", integrationId: "tail" },
]) test(`${config.provider} edit/save round-trips conditions, routing and event identity`, async () => {
  const { context, page } = await setup(); let written, preview;
  const conditions = { not: { all: [{ fact: "webhook", path: "$.ignored", operator: "equal", value: true }] } };
  const changed = { all: [{ fact: "webhook", path: "$.provider", operator: "equal", value: config.provider }] };
  const hook = { ...initial.events[0], id: "00000000-0000-4000-8000-000000000004", slug: "event-2", kind: "webhook", config: { ...config, conditions, ...(config.provider === "cloudflareTail" ? { destination: "https://tail.example.test/webhook" } : {}) } };
  const value = { ...initial, events: [...initial.events, hook] };
  await page.route("**/api/v1/providers/**", route => { const path = new URL(route.request().url()).pathname; return route.fulfill({ json: path.endsWith("/projects") || path.endsWith("/lists") || path.endsWith("/installations") || path.endsWith("/repositories") ? [] : { statuses: [], labels: [], users: [] } }); });
  await page.route("**/api/v1/integrations/cloudflare-tail", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/triggers/" + id, route => { if (route.request().method() === "PUT") { written = route.request().postDataJSON(); return route.fulfill({ json: { ...value, ...written } }); } return route.fulfill({ json: value }); });
  await page.route("**/api/v1/trigger-conditions/test", route => { preview = route.request().postDataJSON(); return route.fulfill({ json: { decision: "match", details: [] } }); });
  await page.goto(origin + "/triggers/" + id + "/settings/events");
  if (config.provider === "cloudflareTail") await page.getByText("https://tail.example.test/webhook", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await page.getByLabel("Conditions JSON (optional)").inputValue()), conditions);
  if (config.provider === "github") { assert.equal(await page.getByLabel("GitHub event").inputValue(), "check_suite"); assert.equal(await page.getByLabel("GitHub action").inputValue(), "completed"); }
  await page.getByLabel("Conditions JSON (optional)").fill("{");
  assert.equal(written, undefined); await page.getByText("Conditions must be valid JSON before saving.").waitFor();
  await page.getByLabel("Conditions JSON (optional)").fill(JSON.stringify(changed));
  await page.getByText("Test webhook conditions", { exact: true }).click();
  await page.getByLabel("Example webhook JSON").fill(JSON.stringify({ provider: config.provider }));
  await page.getByRole("button", { name: "Test conditions", exact: true }).click({ force: true });
  await page.getByRole("status").filter({ hasText: "Conditions match the example webhook." }).waitFor();
  assert.deepEqual(preview, { conditions: changed, webhook: { provider: config.provider } });
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.deepEqual(written.events[1], { id: hook.id, slug: hook.slug, kind: hook.kind, enabled: hook.enabled, config: { ...config, conditions: changed } });
  assert.deepEqual(JSON.parse(await page.getByLabel("Conditions JSON (optional)").inputValue()), changed); await context.close();
});
test("conditions save surfaces strict server validation errors", async () => {
  const { context, page } = await setup();
  const value = { ...initial, events: [...initial.events, { ...initial.events[0], id: "00000000-0000-4000-8000-000000000004", slug: "event-2", kind: "webhook", config: { provider: "cloudflareTail", integrationId: "tail" } }] };
  await page.route("**/api/v1/integrations/cloudflare-tail", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/triggers/" + id, route => route.request().method() === "PUT" ? route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Request validation failed", details: [{ path: ["events", 1, "config", "conditions"], message: "Condition groups must not be empty." }] } } }) : route.fulfill({ json: value }));
  await page.goto(origin + "/triggers/" + id + "/settings/events"); await page.getByLabel("Conditions JSON (optional)").fill('{"all":[]}');
  await page.getByRole("alert").filter({ hasText: "Condition groups must not be empty." }).first().waitFor();
  await context.close();
});

test("Settings edits and saves repeatedly, preserves revision, protects dirty tab navigation and deletes from Settings on mobile", async () => {
  const { page, context } = await setup({ viewport: { width: 390, height: 844 } });
  let current = { ...structuredClone(initial), projectId: "project" }, deleting, finishSave;
  const writes = [];
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    if (route.request().method() === "DELETE") { deleting = true; return route.fulfill({ status: 204 }); }
    const body = route.request().postDataJSON(); writes.push(body);
    current = { ...current, ...body, updatedAt: `2026-10-09T1${writes.length}:00:00.000Z` };
    if (writes.length === 1) { finishSave = () => route.fulfill({ json: current }); return; }
    return route.fulfill({ json: current });
  });
  await page.route("**/api/v1/trigger-summaries?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto(origin + `/triggers/${id}/settings/general`);
  const tabs = page.getByRole("navigation", { name: "Trigger navigation" });
  await tabs.getByRole("link", { name: "Settings", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.waitForURL(`**/triggers/${id}/settings/general`);
  await page.getByLabel("Name", { exact: true }).fill("renamed-trigger");
  page.once("dialog", dialog => dialog.dismiss()); await tabs.getByRole("link", { name: "Runs", exact: true }).click();
  assert.ok(page.url().endsWith("/settings/general"));
  await page.getByRole("status").filter({ hasText: "Saving trigger settings" }).waitFor();
  await finishSave(); await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.equal(writes[0].name, "renamed-trigger");
  assert.ok(page.url().endsWith("/settings/general"));
  await page.goto(origin + `/triggers/${id}/settings/general`);
  await page.getByLabel("Name", { exact: true }).fill("second-update");
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.equal(writes[1].expectedUpdatedAt, "2026-10-09T11:00:00.000Z");
  await page.reload(); await page.getByLabel("Name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "second-update");
  await page.getByRole("heading", { name: "Delete this trigger", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel("Name", { exact: true }).fill("unsaved-name-before-deletion");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Delete trigger", exact: true }).click();
  await page.waitForURL("**/triggers?q=*"); assert.equal(deleting, true);
  await context.close();
});

test("delayed autosave preserves newer edits and saves them with the acknowledged revision", async t => {
  const { context, page } = await setup(); t.after(() => context.close());
  let current = structuredClone(initial), releaseFirst;
  const writes = [];
  await page.route(`**/api/v1/triggers/${id}`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: current });
    const body = route.request().postDataJSON(); writes.push(body);
    current = { ...current, ...body, updatedAt: `2026-11-11T00:00:0${writes.length}Z` };
    const response = structuredClone(current);
    if (writes.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
    return route.fulfill({ json: response });
  });
  await page.goto(origin + `/triggers/${id}/settings/general`);
  const first = page.waitForRequest(request => request.method() === "PUT");
  await page.getByLabel("Name", { exact: true }).fill("first-save");
  await first;
  await page.getByLabel("Name", { exact: true }).fill("newer-name");
  const second = page.waitForRequest(request => request.method() === "PUT" && request.postDataJSON().name === "newer-name");
  releaseFirst();
  const body = (await second).postDataJSON();
  assert.equal("description" in body, false);
  assert.equal(body.expectedUpdatedAt, "2026-11-11T00:00:01Z");
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  await page.reload();
  await page.getByLabel("Name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "newer-name");
  assert.equal(await page.getByLabel("Description", {exact:true}).count(), 0);
});

for (const executionType of ["agent", "code"]) test(`Fly.io ${executionType} trigger selects image, region and size, saves and reloads without provider calls`, async t => {
  const { context, page } = await setup({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const configId = "00000000-0000-4000-8000-000000000091", accountId = "00000000-0000-4000-8000-000000000092";
  let configurations = [], configurationBody, triggerBody, current, rejectConfiguration = true, exeVerifications = 0;
  const externalCalls = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => { externalCalls.push(route.request().url()); return route.abort(); });
  await page.route("**/api/v1/projects", route => route.fulfill({ json: [{ id: "00000000-0000-4000-8000-000000000010", name: "Project" }] }));
  await page.route("**/api/v1/skills**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/v1/model-accounts", route => route.fulfill({ json: { accounts: [{ id: accountId, name: "Work ChatGPT", revision: 1, credentialConfigured: true }] } }));
  await page.route("**/api/v1/fly/connection", route => route.fulfill({ json: { connection: { organizationSlug: "test-org", organizationName: "Test org" } } }));
  await page.route("**/api/v1/fly/execution-configurations", route => {
    if (route.request().method() === "POST") {
      configurationBody = route.request().postDataJSON();
      if (rejectConfiguration) return route.fulfill({ status: 400, json: { error: { code: "invalid_fly_configuration", message: "The selected Fly region or VM size is unavailable." } } });
      configurations = [{ ...configurationBody, id: configId }]; return route.fulfill({ json: { configuration: configurations[0] } });
    }
    return route.fulfill({ json: { configurations } });
  });
  await page.route("**/api/v1/vm-image-verifications", route => { exeVerifications++; return route.abort(); });
  await page.route("**/api/v1/triggers", route => {
    triggerBody = route.request().postDataJSON(); current = { ...initial, ...triggerBody, executionConfig: { connectionId: configId, agentKind: "codex", image: configurations[0].image, region: configurations[0].region, size: configurations[0].size } };
    return route.fulfill({ status: 201, json: current });
  });
  await page.route(`**/api/v1/triggers/${id}`, route => route.fulfill({ json: current }));
  await page.goto(origin + "/triggers/new");
  await page.getByLabel("Name", { exact: true }).fill("fly-trigger"); await page.getByRole("combobox", { name: /^Run type/ }).selectOption(executionType);
  await page.getByLabel("Requires VM",{exact:true}).check();
  await page.getByRole("combobox", { name: /^Integration/ }).selectOption("fly-new");
  assert.equal(await page.getByRole("button", { name: "Verify image", exact: true }).count(), 0);
  await page.getByLabel("Execution configuration name").fill("Fly large runner");
  await page.getByLabel("Fly VM image").fill("ghcr.io/acme/runner:v2");
  await page.getByLabel("Fly region").selectOption("ord"); await page.getByLabel("Fly VM size").selectOption("performance-2x");
  await page.getByRole("button", { name: "Save Fly VM settings", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "The selected Fly region or VM size is unavailable." }).waitFor();
  rejectConfiguration = false;
  await page.getByRole("button", { name: "Save Fly VM settings", exact: true }).click();
  await page.waitForFunction(configId => document.querySelector('select option:checked[value="' + configId + '"]'), configId);
  if (executionType === "agent") {
    await page.getByRole("combobox", {name:/^Model integration/}).selectOption(accountId);
    await page.getByLabel("Prompt", { exact: true }).fill("Run tests");
  } else await page.getByLabel("Script", { exact: true }).fill("echo test");
  await page.getByRole("button", { name: "Create trigger", exact: true }).click(); await page.waitForURL(`**/triggers/${id}`);
  assert.deepEqual(configurationBody, { name: "Fly large runner", image: "ghcr.io/acme/runner:v2", region: "ord", size: "performance-2x" });
  assert.equal(triggerBody.executionConfigId, configId); assert.equal(triggerBody.executionType, executionType); assert.equal(triggerBody.vmImage, "");
  if (executionType === "agent") { assert.equal(triggerBody.modelAccountId, accountId); assert.equal(triggerBody.modelAccess, undefined); }
  else { assert.equal(triggerBody.modelAccountId, undefined); assert.equal(triggerBody.script, "echo test"); }
  await page.goto(origin + `/triggers/${id}/settings/vm`);
  assert.equal(await page.getByLabel("Fly VM image").inputValue(), "ghcr.io/acme/runner:v2");
  assert.equal(await page.getByLabel("Fly VM size").inputValue(), "performance-2x"); assert.equal(await page.getByLabel("Fly region").inputValue(), "ord");
  if (executionType === "agent") { await page.getByRole("navigation",{name:"Trigger settings sections"}).getByRole("link",{name:"Permissions",exact:true}).click(); assert.equal(await page.getByRole("combobox", {name:/^Model integration/}).inputValue(), accountId); }
  assert.equal(exeVerifications, 0); assert.deepEqual(externalCalls, []);
  await context.close();
});

test("missing selected credentials stay visible until the owner explicitly removes them", async t => {
  const {context,page}=await setup(); t.after(()=>context.close());
  const missing="00000000-0000-4000-8000-000000000099";
  let current={...structuredClone(initial),portableIntegrationIds:[missing]},writes=[];
  await page.route("**/api/v1/integrations/bearer",route=>route.fulfill({json:{revision:1,integrations:[]}}));
  await page.route("**/api/v1/model-accounts",route=>route.fulfill({json:{revision:1,accounts:[]}}));
  await page.route("**/api/v1/providers/github/installations",route=>route.fulfill({json:[]}));
  await page.route(`**/api/v1/triggers/${id}`,route=>{
    if(route.request().method()==="GET")return route.fulfill({json:current});
    const body=route.request().postDataJSON();writes.push(body);current={...current,...body,updatedAt:new Date().toISOString()};return route.fulfill({json:current});
  });
  await page.goto(origin+`/triggers/${id}/settings/permissions`);
  const unavailable=page.getByRole("checkbox",{name:new RegExp("Unavailable bearer integration: "+missing)});
  await unavailable.waitFor();assert.equal(await unavailable.isChecked(),true);
  assert.equal(writes.length,0);
  await page.getByRole("navigation",{name:"Trigger settings sections"}).getByRole("link",{name:"General",exact:true}).click();
  await page.getByRole("spinbutton",{name:/Concurrency/}).fill("3");
  await page.getByRole("status").filter({hasText:"Trigger settings saved."}).waitFor();
  assert.deepEqual(writes.at(-1).portableIntegrationIds,[missing]);
  await page.getByRole("navigation",{name:"Trigger settings sections"}).getByRole("link",{name:"Permissions",exact:true}).click();
  await unavailable.click();
  await page.waitForFunction(()=>!document.body.textContent.includes("Unavailable bearer integration:"));
  const deadline=Date.now()+5000;while(writes.at(-1)?.portableIntegrationIds?.length!==0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(writes.at(-1).portableIntegrationIds,[]);
});

test("applying an exe.dev preset copies its image and tags into the trigger", async t => {
  const { context, page } = await setup();
  t.after(() => context.close());
  const preset = { id: "preset", name: "Build VM", executionConfigId: "vm", settings: { provider: "exe", connectionId: "vm", tags: ["work"], image: "ghcr.io/acme/build:v1" } };
  await page.route("**/api/v1/team", route => route.fulfill({json:{id:"tenant",name:"Team",runDefaults:{}}}));
  await page.route("**/api/v1/vm-presets", route => route.fulfill({ json: { presets: [preset] } }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { exeConnections: [{ connectionId: "vm", agentKind: "codex", accountTags: ["work"], models: ["gpt-6"] }], ampConnections: [] } }));
  let saved;
  await page.route(`**/api/v1/triggers/${id}`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: initial });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { ...initial, ...saved, executionConfig: { ...initial.executionConfig, image: saved.vmImage } } });
  });
  await page.goto(origin + `/triggers/${id}/settings/vm`);
  await page.getByLabel("VM preset").selectOption(preset.id);
  await page.getByRole("status").filter({ hasText: "Trigger settings saved." }).waitFor();
  assert.equal(saved.executionConfigId, "vm");
  assert.equal(saved.vmImage, preset.settings.image);
  assert.deepEqual(saved.tags, ["work"]);
  assert.equal(saved.model, initial.model);
});

test("new Triggers start with Team defaults, retain explicit permission overrides, and separate VM settings", async t => {
  const {context,page}=await setup(); t.after(()=>context.close());
  const defaults={modelAccountId:"model",requiresVm:true,executionConfigId:"vm",model:"gpt-6",effort:"high",concurrencyLimit:3,capacity:4,runScopes:["skills:read"],portableIntegrationIds:[],allowedTriggerIds:[]};
  let submitted;
  await page.route("**/api/v1/team",route=>route.fulfill({json:{id:"tenant",name:"Team",runDefaults:defaults}}));
  await page.route("**/api/v1/triggers",route=>{
    submitted=route.request().postDataJSON();
    return route.fulfill({status:201,json:{...initial,...defaults,...submitted,events:initial.events}});
  });
  await page.route(`**/api/v1/triggers/${id}`,route=>route.fulfill({json:{...initial,...defaults,...submitted}}));
  await page.goto(origin+"/triggers/new");
  await page.getByLabel("Name",{exact:true}).fill("team-seeded");
  await page.getByLabel("Prompt",{exact:true}).fill("Work with Team defaults");
  assert.equal(await page.getByLabel("Model",{exact:true}).inputValue(),"gpt-6");
  assert.equal(await page.getByRole("spinbutton",{name:"Concurrency limit",exact:true}).inputValue(),"3");
  await page.getByRole("checkbox",{name:"Run scope skills:read",exact:true}).uncheck();
  await page.getByRole("spinbutton",{name:"Concurrency limit",exact:true}).fill("5");
  await page.getByRole("button",{name:"Create trigger",exact:true}).click();
  await page.waitForURL(`**/triggers/${id}`);
  assert.deepEqual(submitted.runScopes,[]);
  assert.equal(submitted.concurrencyLimit,5);
  assert.equal(submitted.executionConfigId,undefined);
  assert.equal(submitted.model,undefined);
  assert.equal(submitted.capacity,undefined);
  await page.goto(origin+`/triggers/${id}/settings/vm`);
  await page.getByRole("heading",{name:"VM",exact:true}).waitFor();
  assert.equal(await page.getByLabel("Model",{exact:true}).count(),0);
  assert.equal(await page.getByRole("group",{name:"Provider credentials for runs",exact:true}).count(),0);
  await page.getByRole("navigation",{name:"Trigger settings sections"}).getByRole("link",{name:"Permissions",exact:true}).click();
  await page.getByRole("group",{name:"Provider credentials for runs",exact:true}).waitFor();
  await page.getByRole("checkbox",{name:"Run scope skills:read",exact:true}).waitFor();
  assert.equal(await page.getByRole("navigation",{name:"Trigger settings sections"}).getByRole("link",{name:"Execution",exact:true}).count(),0);
  await page.goto(origin+`/triggers/${id}/settings/execution`);
  await page.getByRole("heading",{name:"Page not found",exact:true}).waitFor();
});

test("Event template preview sends selected data and literal context while preserving optional prompt", async t => {
  const {context,page}=await setup();t.after(()=>context.close());
  let current={...structuredClone(initial),prompt:"",events:[{...initial.events[0],template:"Selected {{data.title}}"}]},previewBody;
  await page.route(`**/api/v1/triggers/${id}`,route=>route.request().method()==="GET"?route.fulfill({json:current}):route.fulfill({json:current={...current,...route.request().postDataJSON()}}));
  await page.route("**/api/v1/triggers/preview",route=>{previewBody=route.request().postDataJSON();return route.fulfill({json:{prompt:"Selected <script>unsafe</script>\n\nCaller {{literal}}",eventText:"Selected <script>unsafe</script>",skill:null,runName:"Preview"}});});
  await page.goto(origin+`/triggers/${id}/settings/context`);
  assert.equal(await page.getByLabel("Prompt",{exact:true}).getAttribute("required"),null);
  assert.equal(await page.getByRole("combobox",{name:"Add skill",exact:true}).count(),0);
  await page.getByText("Preview run context",{exact:true}).click();
  await page.getByLabel("Sample Event data JSON",{exact:true}).fill('{"data":{"title":"<script>unsafe</script>"}}');
  await page.getByLabel("Manual instructions for preview",{exact:true}).fill("Caller {{literal}}");
  await page.getByRole("button",{name:"Render preview",exact:true}).click();
  await page.getByRole("region",{name:"Run context preview"}).getByText(/Selected <script>unsafe/).waitFor();
  assert.equal(previewBody.prompt,"");assert.equal(previewBody.eventTemplate,"Selected {{data.title}}");assert.equal(previewBody.eventSlug,"event-1");assert.equal(previewBody.instructions,"Caller {{literal}}");
  assert.deepEqual(previewBody.eventData,{data:{title:"<script>unsafe</script>"}});
  assert.equal(await page.locator("main script").count(),0);
});

test("agent Triggers default to VM-free and script Triggers require the VM control",async t=>{
 const {context,page}=await setup();t.after(()=>context.close());
 await page.goto(origin+"/triggers/new");
 assert.equal(await page.getByLabel("Requires VM",{exact:true}).isChecked(),false);
 assert.equal(await page.getByRole("combobox",{name:/^Integration/}).isDisabled(),true);
 await page.getByRole("combobox",{name:/^Run type/}).selectOption("code");
 assert.equal(await page.getByLabel("Requires VM",{exact:true}).isChecked(),true);
 assert.equal(await page.getByLabel("Requires VM",{exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("combobox",{name:/^Integration/}).isDisabled(),false);
});

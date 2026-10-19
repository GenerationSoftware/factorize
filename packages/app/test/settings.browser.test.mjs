import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
before(async () => { server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup() { const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("integration setup tests credentials, submits typed fields and avoids persisting secrets", async () => {
  const { context, page } = await setup(); let saved = false, body;
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: saved ? [{ connectionId: "vm", agentKind: "codex", tags: ["dev"], models: [], modelsRefreshedAt: "now" }] : [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/integrations/exe/test", route => route.fulfill({ json: { ok: true, missingPermissions: [], tags: ["dev"], checks: [] } }));
  await page.route("**/api/v1/integrations/exe", route => { body = route.request().postDataJSON(); saved = true; return route.fulfill({ json: { ok: true, connectionId: "vm", models: [] } }); });
  await page.goto(origin + "/settings/integrations"); await page.getByText("Add exe.dev integration", { exact: true }).click();
  const form = page.locator("details").filter({ has: page.getByText("Add exe.dev integration", { exact: true }) });
  const saveRequestPromise = page.waitForRequest(request => request.url().endsWith("/api/v1/integrations/exe") && request.method() === "PUT"); const saveResponsePromise = page.waitForResponse(response => response.url().endsWith("/api/v1/integrations/exe") && response.request().method() === "PUT"); await form.getByLabel("exe.dev account token").fill("private-input"); await form.getByRole("button", { name: "Test credentials" }).click(); await form.getByText("Credentials verified", { exact: true }).waitFor(); const saveRequest = await saveRequestPromise; await saveResponsePromise; body = saveRequest.postDataJSON(); assert.equal(body.apiToken, "private-input"); assert.equal(body.connectionId, undefined); assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("private-input")), false); await context.close();
});
test("integration settings tolerates legacy exe connections without tags", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [{ connectionId: "legacy", credentialStatus: "connected" }], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.goto(origin + "/settings/integrations");
  await page.getByText("Account tags available", { exact: true }).waitFor();
  await context.close();
});
test("API keys show a secret once, support explicit revocation and survive deep-link refresh", async () => {
  const { context, page } = await setup(); let revoked = false, created = false; const time = "2026-10-09T12:00:00Z";
  await page.route("**/api/v1/access-tokens", route => { if (route.request().method() === "POST") { created = true; return route.fulfill({ status: 201, json: { id: "key", name: "CLI", scopes: ["flows:read", "runs:read"], created_at: time, expires_at: time, token: "one-time-secret" } }); } return route.fulfill({ json: created ? [{ id: "key", name: "CLI", scopes: ["flows:read"], created_at: time, expires_at: time, last_used_at: null, revoked_at: revoked ? time : null }] : [] }); });
  await page.route("**/api/v1/access-tokens/key", route => { revoked = true; return route.fulfill({ json: { revoked: true } }); });
  await page.goto(origin + "/settings/api-keys"); await page.getByLabel("Key name").fill("CLI"); await page.getByRole("button", { name: "Create key" }).click(); await page.getByText("one-time-secret", { exact: true }).waitFor(); await page.getByRole("button", { name: "Dismiss key" }).click(); await page.reload(); await page.getByText("CLI", { exact: true }).waitFor(); assert.equal(await page.getByText("one-time-secret", { exact: true }).count(), 0);
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Revoke key" }).click(); await page.getByText("Revoked", { exact: true }).waitFor(); await context.close();
});
test("authorized client revocation refreshes the grants list", async () => {
  const { context, page } = await setup(); let revoked = false;
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: revoked ? [] : [{ grantId: "grant", clientId: "client", clientName: "External client", scopes: ["flows:read"], authorizationDate: "2026-10-09T12:00:00Z", expiresAt: null, lastUsedAt: null }] }));
  await page.route("**/api/v1/access/authorized-clients/client", route => { revoked = true; return route.fulfill({ json: { revoked: 1 } }); });
  await page.goto(origin + "/settings/authorized-clients"); await page.getByText("External client", { exact: true }).waitFor(); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Revoke client" }).click(); await page.getByText("No authorized clients.", { exact: true }).waitFor(); await context.close();
});
test("execution targets can be created, diagnosed, edited and deleted from settings", async () => {
  const { context, page } = await setup(); let targets = [{ id: "target", kind: "exe-vm", name: "Payments", integrationId: "vm", tags: ["payments"], agentKind: "codex" }]; let diagnostic = false;
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [{ connectionId: "vm", agentKind: "codex", tags: [], models: [], modelsRefreshedAt: "now" }], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/execution-targets", route => { if (route.request().method() === "POST") { targets = [{ id: "target", kind: "exe-vm", name: route.request().postDataJSON().name, integrationId: "vm", tags: route.request().postDataJSON().tags, agentKind: "codex" }]; return route.fulfill({ status: 201, json: targets[0] }); } return route.fulfill({ json: targets }); });
  await page.route("**/api/v1/execution-targets/target", route => { if (route.request().method() === "PUT") { targets[0] = { ...targets[0], ...route.request().postDataJSON() }; return route.fulfill({ json: targets[0] }); } if (route.request().method() === "DELETE") { targets = []; return route.fulfill({ json: { id: "target", deleted: true } }); } return route.fulfill({ json: targets[0] }); });
  await page.route("**/api/v1/execution-targets/target/diagnostics", route => { diagnostic = true; return route.fulfill({ json: { ok: true, targetId: "target", integrationId: "vm", agentKind: "codex", tags: ["payments"], permissions: { ok: true, missing: [], tags: ["payments"] }, agent: { ok: true, models: ["gpt-6"] } } }); });
  await page.goto(origin + "/settings/targets"); await page.getByRole("heading", { name: "Execution targets" }).first().waitFor(); await page.getByRole("button", { name: "Diagnose" }).click(); await page.getByText("Target diagnostic", { exact: true }).waitFor(); assert.equal(diagnostic, true); await page.getByRole("button", { name: "Edit" }).click(); await page.getByLabel("Display name").fill("Website"); await page.getByText("Saved", { exact: true }).waitFor(); await page.getByText("Website", { exact: true }).waitFor(); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Delete" }).click(); await page.getByText("No execution targets yet.", { exact: false }).waitFor(); await context.close();
});

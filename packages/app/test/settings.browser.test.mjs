import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
before(async () => { server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup() { const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("integration setup tests credentials, submits typed fields, clears secrets and refreshes installed status", async () => {
  const { context, page } = await setup(); let saved = false, body;
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: saved ? [{ connectionId: "vm", accountTags: ["dev"] }] : [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/integrations/exe/test", route => route.fulfill({ json: { ok: true, missingPermissions: [], tags: ["dev"], checks: [] } }));
  await page.route("**/api/v1/integrations/exe", route => { body = route.request().postDataJSON(); saved = true; return route.fulfill({ json: { ok: true, connectionId: "vm", models: [] } }); });
  await page.goto(origin + "/settings/integrations"); await page.getByText("Add exe.dev integration", { exact: true }).click();
  const form = page.locator("details").filter({ has: page.getByText("Add exe.dev integration", { exact: true }) });
  await form.getByLabel("exe.dev account token").fill("private-input"); await form.getByRole("button", { name: "Test credentials" }).click(); await form.getByText("✓ Credentials verified.", { exact: true }).waitFor(); await form.getByLabel("VM tags").selectOption(["dev"]); await form.getByRole("button", { name: "Save integration", exact: true }).click();
  await form.getByText("Integration saved", { exact: true }).waitFor(); assert.deepEqual(body.tags, ["dev"]); assert.equal(body.agentKind, "codex"); assert.equal(await form.getByLabel("exe.dev account token").inputValue(), ""); assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("private-input")), false); await page.getByText("dev", { exact: true }).waitFor(); await context.close();
});
test("model account settings issue short-lived capabilities and display the bounded device challenge", async () => {
  const { context, page } = await setup();
  const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", proxyOrigin = "https://proxy.example";
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/model-accounts", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { accounts: [{ id: accountId, name: "Work account", description: null, revision: 0 }] } });
    const action = route.request().postDataJSON().action;
    return route.fulfill({ json: { endpoint: `${proxyOrigin}/model-accounts/${accountId}/${action}`, capability: `one-use-${action}` } });
  });
  const proxyCalls = [];
  await page.route(`${proxyOrigin}/model-accounts/**`, async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
    proxyCalls.push({ path: new URL(request.url()).pathname, authorization: request.headers().authorization, body: request.postData() });
    const response = request.url().endsWith("/authorize") ? { state: "pending", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" } : { state: "canceled" };
    return route.fulfill({ json: response, headers: { "Access-Control-Allow-Origin": origin, "Cache-Control": "no-store" } });
  });
  await page.goto(origin + "/settings/integrations");
  const models = page.getByRole("region", { name: "ChatGPT model accounts" });
  await models.getByRole("button", { name: "Connect ChatGPT" }).click();
  await models.getByText("ABCD-1234", { exact: false }).waitFor();
  await models.getByRole("link", { name: "OpenAI device authorization" }).waitFor();
  await models.getByRole("button", { name: "Cancel authorization" }).click();
  await models.getByText("Device authorization canceled.", { exact: true }).waitFor();
  assert.deepEqual(proxyCalls.map(call => call.authorization), ["Bearer one-use-authorize", "Bearer one-use-cancel"]);
  assert.deepEqual(proxyCalls.map(call => call.body), ["{}", "{}"]);
  await context.close();
});
test("unlock-key setup requires acknowledgement, stores ciphertext only, verifies entered keys and survives refresh without a saved key", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  let saved = null, writes = 0;
  await page.route("**/api/v1/unlock-key/verification", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ownerId: "owner", verification: saved } });
    writes++;
    const body = route.request().postDataJSON();
    assert.deepEqual(Object.keys(body).sort(), ["encryptedVerification", "generationId"]);
    assert.equal(typeof body.encryptedVerification, "string");
    assert.equal(body.encryptedVerification.includes("fzk1."), false);
    saved = { generationId: body.generationId, encryptedVerification: body.encryptedVerification };
    return route.fulfill({ json: { generationId: body.generationId } });
  });
  await page.goto(origin + "/settings/integrations");
  await page.getByRole("button", { name: "Generate unlock key" }).click();
  const key = await page.getByLabel("New unlock key").inputValue();
  assert.match(key, /^fzk1\.[A-Za-z0-9_-]{43}$/u);
  await page.getByRole("button", { name: "Cancel setup" }).click();
  assert.equal(writes, 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.getByRole("button", { name: "Generate unlock key" }).click();
  const savedKey = await page.getByLabel("New unlock key").inputValue();
  await page.getByRole("button", { name: "I saved my key" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "I saved my key" }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "I saved this key somewhere safe." }).check();
  await page.getByRole("button", { name: "I saved my key" }).click();
  await page.getByText("Unlock key verification is set up.", { exact: false }).waitFor();
  assert.equal(writes, 1);
  assert.equal(saved.encryptedVerification.includes(savedKey), false);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  const keySetup = page.getByRole("region", { name: "Unlock key" });
  await keySetup.getByRole("textbox", { name: "Unlock key" }).fill("malformed");
  await page.getByRole("button", { name: "Verify unlock key" }).click();
  await page.getByRole("alert").filter({ hasText: "Unlock key could not be verified" }).waitFor();
  await keySetup.getByRole("textbox", { name: "Unlock key" }).fill(savedKey);
  await page.getByRole("button", { name: "Verify unlock key" }).click();
  await page.getByRole("status").filter({ hasText: "Unlock key verified for this account and generation." }).waitFor();
  await page.reload();
  await keySetup.getByRole("textbox", { name: "Unlock key" }).waitFor();
  assert.equal(await keySetup.getByRole("textbox", { name: "Unlock key" }).inputValue(), "");
  assert.equal(await page.getByText(savedKey, { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await context.close();
});
test("bearer integrations encrypt in the browser, clear secrets, handle conflicts and delete conditionally", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  let verification = null, revision = 0, writeBody = null, updateBody = null, deleteBody = null, conflict = true, deleted = false;
  await page.route("**/api/v1/unlock-key/verification", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ownerId: "owner", verification } });
    const body = route.request().postDataJSON(); verification = { generationId: body.generationId, encryptedVerification: body.encryptedVerification };
    return route.fulfill({ json: { generationId: body.generationId } });
  });
  await page.route("**/api/v1/integrations/bearer", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { revision, integrations: deleted ? [] : writeBody ? [{ id: writeBody.id, name: writeBody.name, origin: writeBody.origin, description: writeBody.description, revision, encryptedPayload: writeBody.encryptedPayload }] : [] } });
    writeBody = route.request().postDataJSON();
    assert.deepEqual(Object.keys(writeBody).sort(), ["description", "encryptedPayload", "expectedRevision", "id", "idempotencyKey", "name", "origin"]);
    assert.equal(writeBody.encryptedPayload.includes("plain-bearer-value"), false);
    assert.match(writeBody.encryptedPayload, /^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/u);
    if (conflict) { conflict = false; revision = 1; return route.fulfill({ status: 409, json: { error: { code: "stale_revision", message: "The integration collection changed. Current revision is 1." } } }); }
    revision++;
    return route.fulfill({ status: 201, json: { revision, duplicate: false } });
  });
  await page.route("**/api/v1/integrations/bearer/*", async route => {
    if (route.request().method() === "PUT") {
      updateBody = route.request().postDataJSON();
      assert.deepEqual(Object.keys(updateBody).sort(), ["description", "encryptedPayload", "expectedRevision", "idempotencyKey", "name", "origin"]);
      assert.equal(updateBody.encryptedPayload.includes("replacement-bearer-value"), false);
      revision++; writeBody = { ...writeBody, ...updateBody };
      return route.fulfill({ json: { revision, duplicate: false } });
    }
    assert.equal(route.request().method(), "DELETE"); deleteBody = route.request().postDataJSON();
    assert.deepEqual(Object.keys(deleteBody).sort(), ["expectedRevision", "idempotencyKey"]);
    deleted = true; revision++;
    return route.fulfill({ json: { id: writeBody.id, deleted: true, revision, duplicate: false } });
  });
  await page.goto(origin + "/settings/integrations");
  await page.getByRole("button", { name: "Generate unlock key" }).click();
  const key = await page.getByLabel("New unlock key").inputValue();
  await page.getByRole("checkbox", { name: "I saved this key somewhere safe." }).check();
  await page.getByRole("button", { name: "I saved my key" }).click();
  await page.getByText("Unlock key verification is set up.", { exact: false }).waitFor();

  const bearer = page.getByRole("region", { name: "Bearer integrations" });
  await bearer.getByLabel("Name").fill("Test bearer");
  await bearer.getByLabel("HTTPS origin").fill("https://api.example.test");
  await bearer.getByLabel("Description or help (optional)").fill("fixture help");
  await bearer.getByLabel("Bearer token").fill("plain-bearer-value");
  await bearer.getByLabel("Unlock key").fill("malformed-key");
  await bearer.getByRole("button", { name: "Add integration" }).click();
  await bearer.getByRole("alert").filter({ hasText: "Malformed unlock key" }).waitFor();
  assert.equal(writeBody, null);
  assert.equal(await bearer.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await bearer.getByLabel("Unlock key").inputValue(), "");

  const wrongKey = `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`;
  await bearer.getByLabel("HTTPS origin").fill("https://api.example.test");
  await bearer.getByLabel("Bearer token").fill("plain-bearer-value");
  await bearer.getByLabel("Unlock key").fill(wrongKey);
  await bearer.getByRole("button", { name: "Add integration" }).click();
  await bearer.getByRole("alert").waitFor();
  assert.equal((await bearer.getByRole("alert").innerText()).includes("plain-bearer-value"), false);
  assert.equal(writeBody, null);
  assert.equal(await bearer.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await bearer.getByLabel("Unlock key").inputValue(), "");

  await bearer.getByLabel("HTTPS origin").fill("https://127.0.0.1");
  await bearer.getByLabel("Bearer token").fill("plain-bearer-value");
  await bearer.getByLabel("Unlock key").fill(key);
  await bearer.getByRole("button", { name: "Add integration" }).click();
  await bearer.getByRole("alert").filter({ hasText: "public HTTPS origin" }).waitFor();
  assert.equal(writeBody, null, "private origins are rejected before any request");

  await bearer.getByLabel("HTTPS origin").fill("https://api.example.test");
  await bearer.getByLabel("Bearer token").fill("plain-bearer-value");
  await bearer.getByLabel("Unlock key").fill(key);
  await bearer.getByRole("button", { name: "Add integration" }).click();
  await bearer.getByRole("alert").filter({ hasText: "collection changed" }).waitFor();
  assert.equal(await bearer.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await bearer.getByLabel("Unlock key").inputValue(), "");
  await bearer.getByLabel("Bearer token").fill("plain-bearer-value");
  await bearer.getByLabel("Unlock key").fill(key);
  await bearer.getByRole("button", { name: "Add integration" }).click();
  await bearer.getByRole("status").filter({ hasText: "pending until the proxy is unlocked" }).waitFor();
  assert.equal(writeBody.encryptedPayload.includes("plain-bearer-value"), false);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)), "{}{}");
  assert.equal(page.url().includes("plain-bearer-value"), false);
  assert.equal(await bearer.getByText("plain-bearer-value", { exact: true }).count(), 0);
  assert.equal(await bearer.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await bearer.getByLabel("Unlock key").inputValue(), "");

  await bearer.getByRole("button", { name: "Replace or edit" }).click();
  await bearer.getByLabel("Replacement bearer token").fill("replacement-bearer-value");
  await bearer.getByLabel("Unlock key").fill(key);
  await bearer.getByRole("button", { name: "Save replacement" }).click();
  await bearer.getByRole("status").filter({ hasText: "pending until the proxy is unlocked" }).waitFor();
  assert.equal(updateBody.expectedRevision, 2);
  assert.equal(await bearer.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await bearer.getByLabel("Unlock key").inputValue(), "");

  page.once("dialog", dialog => dialog.accept());
  await bearer.getByRole("button", { name: "Delete" }).click();
  await bearer.getByText("Integration deleted.", { exact: true }).waitFor();
  assert.equal(deleteBody.expectedRevision, revision - 1);
  await context.close();
});
test("integration settings tolerates legacy exe connections without tags", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [{ connectionId: "legacy", credentialStatus: "connected" }], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.goto(origin + "/settings/integrations");
  await page.getByText("Account tags available", { exact: true }).waitFor();
  await context.close();
});
test("connection tests require a successful result and show missing permissions without exposing transport results", async () => {
  const { context, page } = await setup(); let response;
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [{ connectionId: "vm", accountTags: [] }], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/integrations/exe/test", route => response ? route.fulfill({ json: response }) : route.fulfill({ status: 502, json: { error: { code: "provider_unavailable", message: "Provider unavailable" } } }));
  await page.goto(origin + "/settings/integrations"); const card = page.getByText("exe.dev · vm", { exact: true }).locator("../../..");
  await card.getByRole("button", { name: "Test connection" }).click(); await page.getByRole("alert").filter({ hasText: "Provider unavailable" }).waitFor(); assert.equal(await card.getByText("Provider unavailable", { exact: true }).count(), 1);
  response = { ok: false, missingPermissions: ["integrations add", "integrations attach", "integrations remove"], checks: [{ output: "should-not-render" }] };
  await card.getByRole("button", { name: "Test connection" }).click();
  await card.getByRole("alert").filter({ hasText: "Missing exe.dev permissions: integrations add, integrations attach, integrations remove." }).waitFor();
  assert.equal(await card.getByRole("status").count(), 0);
  response = { ok: false };
  await card.getByRole("button", { name: "Test connection" }).click(); await card.getByRole("alert").filter({ hasText: "Connection verification failed." }).waitFor();
  assert.equal(await card.getByRole("status").count(), 0);
  response = { ok: true, secret: "should-not-render" }; await card.getByRole("button", { name: "Test connection" }).click(); await card.getByRole("status").filter({ hasText: "Connection verified." }).waitFor(); assert.equal(await page.getByText("should-not-render", { exact: true }).count(), 0); await context.close();
});
test("API keys create on a dedicated page, show a secret once, support explicit revocation and survive deep-link refresh", async () => {
  const { context, page } = await setup(); let revoked = false, created = false, submittedScopes = []; const time = "2026-10-09T12:00:00Z";
  await page.route("**/api/v1/access-tokens", route => { if (route.request().method() === "POST") { created = true; submittedScopes = route.request().postDataJSON().scopes; return route.fulfill({ status: 201, json: { id: "key", name: "CLI", scopes: submittedScopes, created_at: time, expires_at: time, token: "one-time-secret" } }); } return route.fulfill({ json: created ? [{ id: "key", name: "CLI", scopes: submittedScopes, created_at: time, expires_at: time, last_used_at: null, revoked_at: revoked ? time : null }] : [] }); });
  await page.route("**/api/v1/access-tokens/key", route => { revoked = true; return route.fulfill({ json: { revoked: true } }); });
  await page.goto(origin + "/settings/api-keys"); await page.getByRole("button", { name: "Create API Key" }).click(); await page.waitForURL("**/settings/api-keys/new"); await page.getByLabel("Key name").fill("CLI");
  await page.getByRole("checkbox", { name: "skills:read", exact: true }).check();
  await page.getByRole("checkbox", { name: "skills:write", exact: true }).check(); await page.getByRole("button", { name: "Create key" }).click(); await page.getByText("one-time-secret", { exact: true }).waitFor(); assert.deepEqual(submittedScopes, ["jobs:read", "runs:read", "skills:read", "skills:write"]); await page.getByRole("button", { name: "Dismiss key" }).click(); await page.goto(origin + "/settings/api-keys"); await page.reload(); await page.getByText("CLI", { exact: true }).waitFor(); assert.equal(await page.getByText("one-time-secret", { exact: true }).count(), 0);
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Revoke key" }).click(); await page.getByText("Revoked", { exact: true }).waitFor(); await context.close();
});
test("authorized client revocation refreshes the grants list", async () => {
  const { context, page } = await setup(); let revoked = false;
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: revoked ? [] : [{ grantId: "grant", clientId: "client", clientName: "External client", scopes: ["flows:read"], authorizationDate: "2026-10-09T12:00:00Z", expiresAt: null, lastUsedAt: null }] }));
  await page.route("**/api/v1/access/authorized-clients/client", route => { revoked = true; return route.fulfill({ json: { revoked: 1 } }); });
  await page.goto(origin + "/settings/authorized-clients"); await page.getByText("External client", { exact: true }).waitFor(); page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Revoke client" }).click(); await page.getByText("No authorized clients.", { exact: true }).waitFor(); await context.close();
});

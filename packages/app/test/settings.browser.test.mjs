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
test("model authorization stays on the backend and displays only the public device code", async () => {
  const {context,page}=await setup(),id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",calls=[];
  await page.route("**/api/v1/providers/github/installations",route=>route.fulfill({json:[]}));
  await page.route("**/api/v1/integrations",route=>route.fulfill({json:{linear:null,exeConnections:[],ampConnections:[],cloudflareTail:{count:0,installations:[]}}}));
  await page.route("**/api/v1/model-accounts",route=>route.fulfill({json:{revision:1,accounts:[{id,name:"Work account",description:null,revision:1,credentialConfigured:false}]}}));
  await page.route("**/api/v1/model-accounts/*/authorization/*",route=>{
    calls.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});
    return route.fulfill({json:route.request().url().endsWith("/cancel")?{state:"canceled"}:{state:"pending",verificationUrl:"https://auth.openai.com/codex/device",userCode:"ABCD-1234",pollAfterSeconds:5}});
  });
  await page.goto(origin+"/settings/integrations");
  const models=page.getByRole("region",{name:"Model accounts"});
  await models.getByRole("button",{name:"Connect ChatGPT",exact:true}).click();
  await models.getByText("ABCD-1234",{exact:true}).waitFor();
  assert.equal(await models.getByRole("link",{name:"Open ChatGPT device authorization"}).getAttribute("href"),"https://auth.openai.com/codex/device");
  await models.getByRole("button",{name:"Cancel authorization"}).click();
  await models.getByText("Authorization attempt canceled.",{exact:true}).waitFor();
  assert.deepEqual(calls.filter(c=>!c.path.endsWith("/status")).map(c=>c.path.split("/").at(-1)),["authorize","cancel"]);
  assert.ok(calls.every(c=>JSON.stringify(c.body)==="{}"));
  assert.equal(await page.getByRole("button",{name:"Generate unlock key"}).count(),0);
  await context.close();
});
test("owner browser stores bearer integration in Factorize managed storage without an unlock key", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  let saved = [], createBody;
  await page.route("**/api/v1/integrations/bearer", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { revision: saved.length, integrations: saved } });
    createBody = route.request().postDataJSON();
    saved = [{ id: createBody.id, name: createBody.name, origin: createBody.origin, description: createBody.description, revision: 1 }];
    return route.fulfill({ status: 201, json: { revision: 1, duplicate: false } });
  });

  await page.goto(origin + "/settings/integrations");
  const integrations = page.getByRole("region", { name: "Bearer integrations" });
  await integrations.getByLabel("Name").fill("Example service");
  await integrations.getByLabel("HTTPS origin").fill("https://api.example.test");
  await integrations.getByLabel("Description or help (optional)").fill("Fixture API");
  await integrations.getByLabel("Bearer token").fill("synthetic-upstream-secret");
  await integrations.getByRole("button", { name: "Add integration" }).click();
  await integrations.getByText("Saved integration in Factorize managed encrypted storage.", { exact: true }).waitFor();

  assert.equal(createBody.name, "Example service");
  assert.equal(createBody.origin, "https://api.example.test");
  assert.equal(createBody.description, "Fixture API");
  assert.equal(createBody.token, "synthetic-upstream-secret");
  assert.equal(createBody.unlockKey, undefined);
  assert.equal(await integrations.getByLabel("Bearer token").inputValue(), "");
  assert.equal(await integrations.getByText("synthetic-upstream-secret", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("synthetic-upstream-secret")), false);
  await context.close();
});
test("model account create/delete uses server-managed state without an unlock key", async () => {
  const { context, page } = await setup();
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  let revision = 0, account = null, createBody = null, deleteBodies = [], staleOnce = true;
  await page.route("**/api/v1/model-accounts", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { revision, accounts: account ? [account] : [] } });
    createBody = route.request().postDataJSON();
    assert.deepEqual(Object.keys(createBody).sort(), ["description", "expectedRevision", "id", "idempotencyKey", "initialState", "name"]);
    assert.equal(createBody.expectedRevision, revision);
    assert.equal(createBody.name, "Work account");
    assert.deepEqual(JSON.parse(createBody.initialState), {OPENAI_API_KEY:"synthetic-model-key"});
    revision++; account = { id: createBody.id, name: createBody.name, description: createBody.description, revision, credentialConfigured: true };
    return route.fulfill({ status: 201, json: { revision, duplicate: false } });
  });
  await page.route("**/api/v1/model-accounts/*", async route => {
    assert.equal(route.request().method(), "DELETE");
    const body = route.request().postDataJSON(); deleteBodies.push(body);
    assert.deepEqual(Object.keys(body).sort(), ["expectedRevision", "idempotencyKey"]);
    if (staleOnce) {
      staleOnce = false; revision++;
      return route.fulfill({ status: 409, json: { error: { code: "stale_revision", message: "The model account collection changed." } } });
    }
    assert.equal(body.expectedRevision, revision);
    revision++; account = null;
    return route.fulfill({ json: { id: createBody.id, deleted: true, revision, duplicate: false } });
  });

  await page.goto(origin + "/settings/integrations");
  const models = page.getByRole("region", { name: "Model accounts" });
  await models.getByLabel("Name").fill("Work account");
  await models.getByLabel("Description (optional)").fill("Personal account");
  await models.getByLabel("Connection", {exact:true}).selectOption("api-key");
  await models.getByLabel("API key", {exact:true}).fill("synthetic-model-key");
  await models.getByRole("button", { name: "Save model account" }).click();
  await models.getByText("Work account", { exact: true }).waitFor();
  assert.equal(createBody.expectedRevision, 0);
  assert.equal(createBody.description, "Personal account");

  page.once("dialog", dialog => dialog.accept());
  const refreshAfterConflict = page.waitForResponse(response => response.url().includes("/api/v1/model-accounts") && response.request().method() === "GET" && response.status() === 200);
  await models.getByRole("button", { name: "Delete account" }).click();
  await models.getByRole("alert").filter({ hasText: "collection changed" }).waitFor();
  await refreshAfterConflict;
  page.once("dialog", dialog => dialog.accept());
  await models.getByRole("button", { name: "Delete account" }).click();
  await models.getByText("No model accounts are configured yet.", { exact: true }).waitFor();
  assert.equal(deleteBodies.length, 2);
  assert.equal(deleteBodies[0].expectedRevision, 1);
  assert.equal(deleteBodies[1].expectedRevision, 2);
  await context.close();
});

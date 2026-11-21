import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
before(async () => { server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup() { const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.route("**/api/v1/x/connections", route => route.fulfill({json:{connections:[]}}));
  await page.route("**/api/v1/fly/connection", route => route.fulfill({json:{connection:null}}));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({json:{revision:0,integrations:[]}}));
  await page.route("**/api/v1/model-accounts", route => route.fulfill({json:{revision:0,accounts:[]}}));
  await page.route("**/api/v1/integration-api-policies", route => route.fulfill({json:{integrations:[]}}));
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("integration setup tests credentials, submits typed fields, clears secrets and refreshes installed status", async () => {
  const { context, page } = await setup(); let saved = false, body;
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: saved ? [{ connectionId: "vm", accountTags: ["dev"] }] : [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/integrations/exe/test", route => route.fulfill({ json: { ok: true, missingPermissions: [], tags: ["dev"], checks: [] } }));
  await page.route("**/api/v1/integrations/exe", route => { body = route.request().postDataJSON(); saved = true; return route.fulfill({ json: { ok: true, connectionId: "vm", models: [] } }); });
  await page.goto(origin + "/settings/integrations"); await page.getByRole("button", {name:"Add exe.dev integration",exact:true}).click();
  const form = page.getByRole("dialog", {name:"Add exe.dev integration"});
  await form.getByLabel("exe.dev account token").fill("private-input"); await form.getByRole("button", { name: "Test credentials" }).click(); await form.getByText("✓ Credentials verified.", { exact: true }).waitFor(); await form.getByLabel("VM tags").selectOption(["dev"]); await form.getByRole("button", { name: "Save integration", exact: true }).click();
  await form.getByText("Integration saved", { exact: true }).waitFor(); assert.deepEqual(body.tags, ["dev"]); assert.equal(body.agentKind, undefined); assert.equal(await form.getByLabel("exe.dev account token").inputValue(), ""); assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("private-input")), false); await page.getByText("dev", { exact: true }).waitFor(); await context.close();
});
test("model integration edits accept a provider URL and optional key without device authorization",async()=>{
 const {context,page}=await setup(),id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";let written;
 await page.route("**/api/v1/providers/github/installations",route=>route.fulfill({json:[]}));
 await page.route("**/api/v1/integrations",route=>route.fulfill({json:{linear:null,exeConnections:[],ampConnections:[],cloudflareTail:{count:0,installations:[]}}}));
 await page.route("**/api/v1/model-accounts",route=>route.fulfill({json:{revision:1,accounts:[{id,name:"Work account",description:null,providerUrl:null,revision:1,credentialConfigured:false}]}}));
 await page.route("**/api/v1/model-accounts/*",route=>{written=route.request().postDataJSON();return route.fulfill({json:{revision:2,duplicate:false}});});
 await page.goto(origin+"/settings/integrations");
 await page.getByLabel("Actions for Work account",{exact:true}).click();await page.getByRole("menuitem",{name:"Edit model integration",exact:true}).click();
 const form=page.getByRole("dialog",{name:"Edit model integration"});await form.getByLabel("Provider URL",{exact:true}).fill("https://models.example/v1");await form.getByRole("button",{name:"Save model integration",exact:true}).click();
 await form.waitFor({state:"hidden"});assert.equal(written.providerUrl,"https://models.example/v1");assert.equal(written.apiKey,undefined);assert.equal(written.initialState,undefined);
 assert.equal(await page.getByRole("button",{name:"Connect ChatGPT",exact:true}).count(),0);await context.close();
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
  await page.getByRole("button",{name:"Add Bearer API integration",exact:true}).click();
  const integrations = page.getByRole("dialog", { name: "Add bearer integration" });
  await integrations.getByLabel("Name").fill("Example service");
  await integrations.getByLabel("HTTPS origin").fill("https://api.example.test");
  await integrations.getByLabel("Description or help (optional)").fill("Fixture API");
  await integrations.getByLabel("Bearer token").fill("synthetic-upstream-secret");
  await integrations.getByRole("button", { name: "Add integration" }).click();
  await page.getByText("Bearer integration saved.", { exact: true }).waitFor();

  assert.equal(createBody.name, "Example service");
  assert.equal(createBody.origin, "https://api.example.test");
  assert.equal(createBody.description, "Fixture API");
  assert.equal(createBody.token, "synthetic-upstream-secret");
  assert.equal(createBody.unlockKey, undefined);
  assert.equal(await integrations.count(), 0);
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
    assert.deepEqual(Object.keys(createBody).sort(), ["apiKey", "contextWindow", "description", "expectedRevision", "id", "idempotencyKey", "maxTokens", "name", "providerUrl"]);
    assert.equal(createBody.expectedRevision, revision);
    assert.equal(createBody.name, "Work account");
    assert.equal(createBody.apiKey,"synthetic-model-key");assert.equal(createBody.providerUrl,"https://models.example/v1");
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
  await page.getByRole("button",{name:"Add Model integration integration",exact:true}).click();
  const form = page.getByRole("dialog",{name:"Add a model integration"});
  const models = page.getByRole("list", { name: "Installed Integrations" });
  await form.getByLabel("Name").fill("Work account");
  await form.getByLabel("Description (optional)").fill("Personal account");
  await form.getByLabel("Provider URL",{exact:true}).fill("https://models.example/v1");
  await form.getByLabel("API key (optional)", {exact:true}).fill("synthetic-model-key");
  await form.getByRole("button", { name: "Save model integration" }).click();
  await models.getByText("Work account", { exact: true }).waitFor();
  assert.equal(createBody.expectedRevision, 0);
  assert.equal(createBody.description, "Personal account");

  page.once("dialog", dialog => dialog.accept());
  const refreshAfterConflict = page.waitForResponse(response => response.url().includes("/api/v1/model-accounts") && response.request().method() === "GET" && response.status() === 200);
  await models.getByLabel("Actions for Work account",{exact:true}).click();
  await models.getByRole("menuitem", { name: "Delete account" }).click();
  await page.getByRole("alert").filter({ hasText: "collection changed" }).waitFor();
  await refreshAfterConflict;
  page.once("dialog", dialog => dialog.accept());
  await models.getByLabel("Actions for Work account",{exact:true}).click();
  await models.getByRole("menuitem", { name: "Delete account" }).click();
  await page.getByText(/No integrations added yet/).waitFor();
  assert.equal(deleteBodies.length, 2);
  assert.equal(deleteBodies[0].expectedRevision, 1);
  assert.equal(deleteBodies[1].expectedRevision, 2);
  await context.close();
});

for (const malformed of ["bearer integrations", "model accounts"]) test(`settings stays usable when ${malformed} returns an incomplete collection`, async () => {
  const { context, page } = await setup();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } } }));
  await page.route("**/api/v1/fly/connection", route => route.fulfill({ json: { connection: null } }));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({ json: malformed === "bearer integrations" ? { revision: 0 } : { revision: 0, integrations: [] } }));
  await page.route("**/api/v1/model-accounts", route => route.fulfill({ json: malformed === "model accounts" ? { revision: 0 } : { revision: 0, accounts: [] } }));
  try {
    await page.goto(origin + "/integrations");
    await page.getByRole("heading", { name: "Installed Integrations", exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: /could not be loaded\. Reload the page to try again\./ }).waitFor();
    await page.getByRole("navigation", { name: "Dashboard navigation", exact: true }).getByRole("link", { name: "Settings", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Could not load this page", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("all connections share one list, row policies save by identity and disabled access is preserved", async () => {
  const {context,page}=await setup();
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await page.route('**/api/v1/providers/github/installations',route=>route.fulfill({json:[{installationId:17,accountLogin:'fixture',accountType:'Organization',state:'active'}]}));
  await page.route('**/api/v1/integrations',route=>route.fulfill({json:{linear:{organizationName:'Workspace'},clickup:{teamName:'Tasks'},exeConnections:[{connectionId:'vm',accountTags:['dev'],tags:['dev'],agentKind:'codex'}],ampConnections:[{connectionId:'amp',project:'Project'}],cloudflareTail:{installations:[{integrationId:'tail',name:'Logs',referencedTriggerCount:1}]}}}));
  await page.route('**/api/v1/fly/connection',route=>route.fulfill({json:{connection:{organizationName:'Machines',organizationSlug:'machines'}}}));
  await page.route('**/api/v1/integrations/bearer',route=>route.fulfill({json:{revision:1,integrations:[{id,name:'Example API',origin:'https://api.example.test',description:null,revision:1}]}}));
  await page.route('**/api/v1/model-accounts',route=>route.fulfill({json:{revision:1,accounts:[{id,name:'Model fixture',description:null,credentialConfigured:true,revision:1}]}}));
  await page.route('**/api/v1/x/connections',route=>route.fulfill({json:{connections:[{id,name:'Social account',accountId:'123',accountHandle:'social',status:'connected',scopes:['users.read'],grantedScopes:['users.read']}]}}));
  const policies=[['linear','linear'],['clickup','clickup'],['github','17'],['exe','vm'],['amp','amp'],['fly','fly'],['bearer',id],['model',id],['x',id]].map(([kind,credentialId],index)=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,kind,credentialId,name:kind,available:true,policy:kind==='model'?'disabled':'requestable',revision:1}));
  await page.route('**/api/v1/integration-api-policies',route=>route.fulfill({json:{integrations:policies}}));
  const updates=[];let conflict=true;
  await page.route('**/api/v1/integration-api-policies/*',route=>{
    const row=policies.find(row=>route.request().url().endsWith(row.id)), body=route.request().postDataJSON();updates.push({id:row.id,...body});
    if(conflict){conflict=false;row.revision++;return route.fulfill({status:409,json:{error:{code:'stale_revision',message:'Integration policy changed. Try again.'}}});}
    assert.equal(body.expectedRevision,row.revision);row.policy=body.policy;row.revision++;
    return route.fulfill({json:{integrations:policies}});
  });
  await page.goto(origin+'/settings/integrations');
  const list=page.getByRole('list',{name:'Installed Integrations'});
  await list.getByText('Example API',{exact:true}).waitFor();
  assert.equal(await list.getByRole('listitem').count(),10);
  assert.equal(await page.getByRole('heading',{name:'MCP API access',exact:true}).count(),0);
  assert.equal(await page.locator('form').count(),0);
  await list.getByRole('checkbox',{name:'Example API available by default',exact:true}).waitFor();
  assert.equal(await list.getByRole('checkbox').count(),9);
  const checkbox=list.getByRole('checkbox',{name:'Example API available by default',exact:true});
  await checkbox.click();await list.getByRole('alert').filter({hasText:'Integration policy changed'}).waitFor();
  await checkbox.check();await page.waitForFunction(()=>document.querySelector('input[aria-label="Example API available by default"]')?.checked);
  assert.equal(updates.at(-1).id,policies.find(row=>row.kind==='bearer').id);
  assert.equal(updates.at(-1).expectedRevision,2);
  assert.equal(updates.at(-1).policy,'baseline');
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="Example API available by default"]')?.disabled);
  await Promise.all([page.waitForResponse(response=>response.url().endsWith(policies.find(row=>row.kind==='bearer').id)&&response.request().method()==='PUT'),checkbox.uncheck()]);
  assert.equal(updates.at(-1).policy,'requestable');
  const disabled=list.getByRole('checkbox',{name:'Model fixture available by default',exact:true});
  assert.equal(await disabled.isDisabled(),true);assert.equal(await disabled.isChecked(),false);
  await list.getByLabel('Actions for Model fixture',{exact:true}).click();await list.getByRole('menuitem',{name:'MCP access…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'model MCP access'});
  assert.equal(await dialog.getByRole('combobox').inputValue(),'disabled');
  assert.equal(updates.filter(row=>row.id===policies.find(row=>row.kind==='model').id).length,0,'opening settings does not enable access');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),0);
  await context.close();
});

test("Fly setup opens from its tile, verifies and saves, then appears in the unified list", async () => {
  const {context,page}=await setup();let connection=null, savedBody;
  await page.route('**/api/v1/providers/github/installations',route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/integrations',route=>route.fulfill({json:{linear:null,clickup:null,exeConnections:[],ampConnections:[],cloudflareTail:{installations:[]}}}));
  await page.route('**/api/v1/fly/connection/test',route=>route.fulfill({json:{ok:true}}));
  await page.route('**/api/v1/fly/connection',route=>{
    if(route.request().method()==='PUT') {savedBody=route.request().postDataJSON();connection={organizationSlug:savedBody.organizationSlug,organizationName:'Fixture org'};}
    return route.fulfill({json:{connection}});
  });
  await page.goto(origin+'/settings/integrations');
  await page.getByRole('button',{name:'Add Fly.io integration',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add Fly.io integration',exact:true});
  await dialog.getByLabel('Fly organization slug',{exact:true}).fill('fixture');await dialog.getByLabel('Fly organization token',{exact:true}).fill('synthetic-fly-token');
  await dialog.getByRole('button',{name:'Verify connection',exact:true}).click();await dialog.getByText('Fly.io connection verified.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Save Fly.io integration',exact:true}).click();
  const list=page.getByRole('list',{name:'Installed Integrations'});await list.getByText('Fixture org (fixture)',{exact:true}).waitFor();
  assert.equal(await dialog.count(),0);assert.deepEqual(savedBody,{token:'synthetic-fly-token',organizationSlug:'fixture'});
  await list.getByLabel('Actions for Fly.io',{exact:true}).click();await list.getByRole('menuitem',{name:'Edit / verify connection',exact:true}).click();
  assert.equal(await page.getByRole('dialog').getByLabel('Fly organization token',{exact:true}).inputValue(),'');
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-fly-token')),false);
  await context.close();
});

test("dashboard VM presets use dedicated editors and confirmed deletion", async () => {
  const { context, page } = await setup();
  let presets = [];
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { exeConnections: [{ connectionId: "dev", accountTags: ["work"] }], ampConnections: [] } }));
  await page.route("**/api/v1/fly/execution-configurations", route => route.fulfill({ json: { configurations: [] } }));
  await page.route("**/api/v1/presets", route => {
    if (route.request().method() === "GET") return route.fulfill({json:{presets}});
    const body=route.request().postDataJSON();assert.deepEqual(body,{kind:"vm",name:"Build",slug:"build",settings:{provider:"exe",connectionId:"dev",image:"",tags:["work"]}});
    presets=[{...body,id,executionConfigId:"dev",revision:1,isDefault:false}];return route.fulfill({json:{preset:presets[0]}});
  });
  await page.route("**/api/v1/presets/"+id,route=>{
    if(route.request().method()==="DELETE"){presets=[];return route.fulfill({json:{deleted:true}});}
    presets=[{...presets[0],...route.request().postDataJSON(),revision:2}];return route.fulfill({json:{preset:presets[0]}});
  });
  try{
    await page.goto(origin+"/settings/vm-presets");await page.getByText("No presets yet.",{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/settings/vm");
    await page.getByRole("link",{name:"Add preset",exact:true}).click();await page.getByLabel("Preset name",{exact:true}).fill("Build");await page.getByRole("combobox",{name:"Execution provider",exact:true}).click();await page.getByRole("option",{name:"exe.dev",exact:true}).click();await page.getByRole("combobox",{name:"Connection",exact:true}).click();await page.getByRole("option",{name:"dev",exact:true}).click();await page.getByLabel("work",{exact:true}).check();await page.getByRole("button",{name:"Save preset",exact:true}).click();
    await page.getByLabel("Actions for Build",{exact:true}).click();await page.getByRole("menuitem",{name:"Edit",exact:true}).click();assert.equal(await page.getByLabel("work",{exact:true}).isChecked(),true);await page.getByLabel("Preset name",{exact:true}).fill("Release");await page.getByRole("button",{name:"Save preset",exact:true}).click();
    await page.getByLabel("Actions for Release",{exact:true}).click();await page.getByRole("menuitem",{name:"Delete",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Delete preset",exact:true}).click();await page.getByText("No presets yet.",{exact:true}).waitFor();
  }finally{await context.close();}
});

test("Apps separates connected accounts and team registrations", async () => {
  const {context, page} = await setup();
  const app = {id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",name:"Reports",enabled:true,public:false,redirectUris:["https://reports.example/callback"],secretConfigured:false};
  await page.route("**/api/v1/apps", route => route.fulfill({json:[app]}));
  await page.route("**/api/v1/app-connections", route => route.fulfill({json:[]}));
  await page.route(`**/api/v1/apps/${app.id}/secret`, route => route.fulfill({json:{clientId:app.id,clientSecret:"fixture-value"}}));
  try {
    await page.goto(origin + "/apps");
    await page.getByText("No connected apps.").waitFor();
    await page.getByRole("link", {name:"Registered apps"}).click();
    await page.getByText("Team only").waitFor();
    await page.getByRole("button", {name:"Create client secret"}).click();
    const dialog = page.getByRole("dialog", {name:"Client secret"});
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("Client secret", {exact:true}).inputValue(),"fixture-value");
    await dialog.getByRole("button",{name:"Done"}).click();
    await dialog.waitFor({state:"hidden"});
  } finally { await context.close(); }
});

test("owner edits an MCP connection with the team permission preset", async () => {
  const {context, page} = await setup();
  const client = {grantId:"first", clientId:"shared", clientName:"Release assistant", appName:"Shared MCP app", availableScopes:["triggers:read", "triggers:write"], scopes:["triggers:read", "triggers:write"], integrationOverrides:{}, revision:0, authorizationDate:"2026-11-19", expiresAt:null, lastUsedAt:null};
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({json:[client, {...client, grantId:"second", clientName:"Another connection"}]}));
  await page.route("**/api/v1/presets", route => route.fulfill({json:{presets:[{kind:"permission",isDefault:true}]}}));
  await page.route("**/api/v1/access/authorizations/second/vms", route => route.fulfill({json:[]}));
  let saved;
  await page.route("**/api/v1/access/authorizations/first/permissions", route => {
    saved = route.request().postDataJSON();
    return route.fulfill({json:{ok:true}});
  });
  try {
    await page.goto(origin + "/settings/authorized-clients");
    await page.waitForURL("**/clients");
    await page.getByRole("row", {name:/Release assistant/}).getByRole("button", {name:"Edit permissions"}).click();
    const dialog = page.getByRole("dialog", {name:"Permissions for Release assistant"});
    await dialog.getByLabel("Permission preset").selectOption("team-default");
    await dialog.getByRole("button", {name:"Save permissions"}).click();
    await dialog.waitFor({state:"hidden"});
    assert.deepEqual(saved, {preset:"team-default", expectedRevision:0});
    assert.equal(await page.getByText("Shared MCP app",{exact:true}).count(),2);
    await page.getByRole("link",{name:"Another connection"}).click();
    await page.getByText("No VM attachments recorded.").waitFor();
  } finally { await context.close(); }
});

test("team settings can be saved before connecting a VM provider", async () => {
  const { context, page } = await setup();
  let runDefaults = {}, submitted;
  await page.route("**/api/v1/team", route => route.fulfill({ json: { id: "team", name: null, runDefaults } }));
  await page.route("**/api/v1/team/run-defaults", route => {
    submitted = route.request().postDataJSON();
    runDefaults = submitted;
    return route.fulfill({ json: submitted });
  });
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: { exeConnections: [], ampConnections: [] } }));
  await page.route("**/api/v1/fly/execution-configurations", route => route.fulfill({ json: { configurations: [] } }));
  await page.route("**/api/v1/presets",route=>route.fulfill({json:{presets:[]}}));
  await page.goto(origin + "/settings");
  await page.getByRole("heading", { name: "VM presets", exact: true }).waitFor();
  await page.getByLabel("Team concurrency limit").fill("7");
  await page.getByRole("button", { name: "Save team capacity" }).click();
  await page.getByRole("status").filter({ hasText: "Team capacity saved." }).waitFor();
  assert.equal(submitted.capacity, 7);
  assert.equal(submitted.executionConfigId, undefined);
  await context.close();
});

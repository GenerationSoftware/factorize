import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let server, origin, browser;
const skill = { id: "f5fda9d7-aef9-401c-ac95-e2d2f4fc559d", key: "review", body: "Review carefully", revision: 1, usageCount: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
before(async () => { server = createServer(async (request, response) => { const path = new URL(request.url, "http://local.test").pathname; const file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const data = await readFile(new URL("../dist" + file, import.meta.url)); response.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); response.end(data); } catch { response.statusCode = 404; response.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test("skills link to detail pages and edit from the detail page", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["skills:read", "skills:write"] } }));
  await page.route("**/api/v1/skills**", route => route.fulfill({ json: { items: [{ ...skill, body: undefined }], nextCursor: null } }));
  await page.route("**/api/v1/presets",route=>route.fulfill({json:{presets:[]}}));
  let current = skill;
  await page.route(`**/api/v1/skills/${skill.id}`, async route => {
    if (route.request().method() === "PUT") {
      assert.deepEqual(route.request().postDataJSON(), { key: "review-updated", definition:{name:"review-updated",description:"",factorize:{concurrency:0,disabled:false},markdown:"Updated instructions"}, expectedRevision: 1 });
      current = { ...skill, key: "review-updated", body: "Updated instructions", definition:route.request().postDataJSON().definition, revision: 2 };
    }
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/v1/skills/${skill.id}/files`,route=>route.fulfill({json:{revision:current.revision,commit:null,files:[]}}));
  await page.goto(origin + "/skills");
  await page.getByRole("link", { name: "review", exact: true }).click();
  await page.getByRole("heading", { name: "review", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/skills/${skill.id}`);
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  await editButton.waitFor({ state: "visible" });
  assert.equal(await editButton.count(), 1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("review-updated");
  await page.getByLabel("Markdown body",{exact:true}).fill("Updated instructions");
  await page.getByRole("button", { name: "Save skill", exact: true }).click();
  await page.getByText("Updated instructions", { exact: true }).waitFor();
  await context.close();
});

test("replacing native skills with a GitHub folder requires confirmation", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    let source = {kind:"managed"};
    const writes = [];
    await page.route("**/api/v1/session", route => route.fulfill({json:{authenticated:true,user:{id:"owner",email:"owner@example.test"},team:{id:"workspace",name:"Workspace",role:"owner"},capabilities:["skills:read","skills:write","integrations:write"]}}));
    await page.route("**/api/v1/skills?**", route => route.fulfill({json:{items:[],nextCursor:null}}));
    await page.route("**/api/v1/providers/github/installations", route => route.fulfill({json:[{installationId:7,state:"active",accountLogin:"org"}]}));
    await page.route("**/api/v1/providers/github/installations/7/repositories", route => route.fulfill({json:[{id:42,fullName:"org/agents",defaultBranch:"main"}]}));
    await page.route("**/api/v1/skill-library", route => {
      if (route.request().method() === "PUT") {
        const {confirmOverwrite,...selected} = route.request().postDataJSON();
        writes.push({confirmOverwrite,...selected});
        source = selected;
      }
      return route.fulfill({json:{source,remote:"https://fixture.test/library.git",commit:"aaaa",upstreamCommit:"bbbb",error:null}});
    });
    await page.goto(origin + "/settings/skills");
    await page.getByRole("button", {name:"Change repository"}).click();
    await page.getByLabel("Source of truth").selectOption("github");
    await page.getByRole("combobox", {name:/^Installation/}).selectOption("7");
    await page.getByRole("combobox", {name:/^Repository/}).selectOption("42");
    const save = page.getByRole("button", {name:"Save repository"});
    page.once("dialog", dialog => dialog.dismiss());
    await save.click();
    assert.deepEqual(writes, []);
    page.once("dialog", dialog => {assert.match(dialog.message(), /org\/agents.*main.*skills/); return dialog.accept();});
    await save.click();
    await page.getByRole("button", {name:"Change repository"}).waitFor();
    assert.deepEqual(writes,[{kind:"github",installationId:7,repositoryId:42,branch:"main",folder:"skills",confirmOverwrite:true}]);
  } finally { await context.close(); }
});

test("team settings separates preset types and repository settings while capacity preserves legacy fields", async () => {
  for(const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    let defaults={capacity:4,concurrencyLimit:2,requiresVm:false,model:"initial-model",runScopes:["runs:read"],portableIntegrationIds:[],githubInstallationIds:[],xConnectionIds:[],allowedTriggerIds:[]};
    let syncs=0;
    await page.route("**/api/v1/**",route=>{
      const path=new URL(route.request().url()).pathname;
      let json={items:[],nextCursor:null};
      if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:"owner",role:"owner"},capabilities:[]};
      if(path==="/api/v1/presets")json={presets:[]};
      if(path==="/api/v1/team")json={id:"t",name:"owner",runDefaults:defaults};
      if(path==="/api/v1/team/run-defaults"){defaults=route.request().postDataJSON();json=defaults;}
      if(path==="/api/v1/integrations")json={linear:null,exeConnections:[]};
      if(path==="/api/v1/github-installations"||path==="/api/v1/fly/execution-configurations")json=[];
      if(path==="/api/v1/x/connections")json={connections:[]};
      if(path==="/api/v1/integrations/bearer")json={revision:0,integrations:[]};
      if(path==="/api/v1/model-accounts")json={accounts:[]};
      if(path==="/api/v1/skill-library/sync")syncs++;
      if(path.startsWith("/api/v1/skill-library"))json={source:{kind:"managed"},remote:"https://local.test/library.git",commit:"abcd",error:null};
      if(path.endsWith("/files") && !("files" in json))json={revision:1,commit:null,files:[]};
  return route.fulfill({json});
    });
    await page.goto(origin+"/settings");
    await page.getByRole("heading",{name:"VM presets",exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,"/settings/vm");
    const sidebar=page.getByRole("navigation",{name:"Team settings",exact:true});
    assert.equal(await sidebar.getByRole("link",{name:"VM",exact:true}).getAttribute("aria-current"),"page");
    await page.getByLabel("Team concurrency limit",{exact:true}).fill("6");
    await page.getByRole("button",{name:"Save team capacity",exact:true}).click();await page.getByText("Team capacity saved.",{exact:true}).waitFor();
    assert.equal(defaults.capacity,6);assert.equal(defaults.model,"initial-model");assert.deepEqual(defaults.runScopes,["runs:read"]);
    await sidebar.getByRole("link",{name:"Permissions",exact:true}).click();await page.getByRole("heading",{name:"Permission presets",exact:true}).waitFor();
    await sidebar.getByRole("link",{name:"Models",exact:true}).click();await page.getByRole("heading",{name:"Model presets",exact:true}).waitFor();
    await sidebar.getByRole("link",{name:"Skills",exact:true}).click();
    await page.getByRole("heading",{name:"Git repository",exact:true}).waitFor();
    await page.getByRole("button",{name:"Sync now",exact:true}).click();
    await page.waitForTimeout(100);assert.equal(syncs,1);
    await page.reload();await page.getByRole("heading",{name:"Skills settings",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.goto(origin+"/skills");await page.getByRole("table",{name:"Skills",exact:true}).waitFor();
    assert.equal(await page.getByRole("heading",{name:"Git repository",exact:true}).count(),0);
    await context.close();
  }
});

test("skill trigger settings has no name or skill picker and retains multiple event sources",async()=>{
 const context=await browser.newContext(),page=await context.newPage();let saved;
 await page.route("**/api/v1/**",route=>{
  const path=new URL(route.request().url()).pathname;let json={};
  if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:"owner",role:"owner"},capabilities:[]};
  if(path==="/api/v1/trigger-event-availability")json={manual:true,schedule:true,triggerLifecycle:true,github:false,linear:false,clickup:false,cloudflareTail:false};
  if(path===`/api/v1/skills/${skill.id}`)json=skill;
  if(path==="/api/v1/presets")json={presets:[]};
  if(path.endsWith("/trigger")){if(route.request().method()==="PUT")saved=route.request().postDataJSON();json={trigger:{id:"a93b4759-2a69-4dd3-86c8-4941529bb011",name:"review",enabled:true,updatedAt:"2026-01-01T00:00:00.000Z",events:[{id:"d93b4759-2a69-4dd3-86c8-4941529bb011",triggerId:"a93b4759-2a69-4dd3-86c8-4941529bb011",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",slug:"manual",kind:"manual",enabled:true,config:{}}]}};}
  if(path.endsWith("/files") && !("files" in json))json={revision:1,commit:null,files:[]};
  return route.fulfill({json});
 });
 await page.goto(origin+`/skills/${skill.id}/settings/trigger`);
 await page.getByRole("button",{name:"Save trigger",exact:true}).waitFor();
 assert.equal(await page.getByLabel("Name",{exact:true}).count(),0);assert.equal(await page.getByLabel("Skill",{exact:true}).count(),0);
 await page.getByRole("button",{name:"Add trigger",exact:true}).click();
 await page.getByRole("button",{name:"Save trigger",exact:true}).click();
 await page.getByRole("status").filter({hasText:"Trigger saved"}).waitFor();
 assert.equal(saved.events.length,1);assert.deepEqual(saved.events.map(e=>e.kind),["schedule"]);assert.equal("name" in saved,false);assert.equal("skillId" in saved,false);assert.ok(saved.events.every(event=>!("triggerId" in event)&&!("createdAt" in event)&&!("updatedAt" in event)));
 await context.close();
});

test("skill pages share navigation, scope runs and redirect legacy trigger links",async()=>{
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
 let defaults={executionType:"agent",requiresVm:false,prompt:"Initial",model:"model-a",concurrencyLimit:1,runScopes:[]},revision=1,launched,runsQuery;
 const triggerId="a93b4759-2a69-4dd3-86c8-4941529bb011";
 const trigger={id:triggerId,name:skill.key,skillId:skill.id,enabled:true,events:[],updatedAt:"2026-01-01T00:00:00.000Z"};
 await page.route("**/api/v1/**",route=>{
  const url=new URL(route.request().url()),path=url.pathname;let json={items:[],nextCursor:null};
  if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:"owner",role:"owner"},capabilities:[]};
  if(path===`/api/v1/skills/${skill.id}`)json=skill;
  if(path==="/api/v1/presets")json={presets:[]};
  if(path==="/api/v1/skills")json={items:[{...skill,body:undefined,hasTriggers:true,trigger:{id:triggerId,enabled:true},lastRunState:"succeeded"}],nextCursor:null};
  if(path===`/api/v1/skills/${skill.id}/settings`){if(route.request().method()==="PUT"){const body=route.request().postDataJSON();assert.equal(body.expectedRevision,revision);defaults=body.defaults;revision++;}json={defaults,revision};}
  if(path===`/api/v1/skills/${skill.id}/trigger`)json={trigger};
  if(path===`/api/v1/triggers/${triggerId}`)json=trigger;
  if(path==="/api/v1/runs"&&route.request().method()==="GET"){runsQuery=url.searchParams.get("skillId");json={items:[{id:"manual-run",run_name:"Manual skill run",state:"succeeded",trigger_id:null,created_at:"2026-01-01T00:00:00.000Z"},{id:"triggered-run",run_name:"Triggered skill run",state:"succeeded",trigger_id:triggerId,trigger_name:skill.key,created_at:"2026-01-01T00:00:00.000Z"}],nextCursor:null};}
  if(path==="/api/v1/integrations")json={linear:null,exeConnections:[]};
  if(path==="/api/v1/fly/execution-configurations")json=[];
  if(path==="/api/v1/model-accounts")json={accounts:[]};
  if(path==="/api/v1/vm-presets")json=[];
  if(path.endsWith("/files") && !("files" in json))json={revision:1,commit:null,files:[]};
  return route.fulfill({json});
 });
 await page.goto(origin+"/skills");
 const teamNav=page.getByRole("navigation",{name:"Dashboard navigation",exact:true});
 await teamNav.getByRole("link",{name:"Skills",exact:true}).waitFor();
 assert.deepEqual(await teamNav.getByRole("link").allTextContents(),["Skills","Runs","VMs","Clients","Apps","Integrations","Settings"]);
 await page.getByRole("table",{name:"Skills",exact:true}).getByRole("button",{name:`Run ${skill.key}`,exact:true}).waitFor();
 await page.getByRole("link",{name:skill.key,exact:true}).click();
 const nav=page.getByRole("navigation",{name:"Skill navigation",exact:true});
 assert.equal(await nav.getByRole("link",{name:"Overview",exact:true}).getAttribute("aria-current"),"page");
 const mainNav=page.getByRole("navigation",{name:"Main navigation",exact:true});
 await mainNav.getByRole("link",{name:"owner",exact:true}).waitFor();await mainNav.getByRole("link",{name:skill.key,exact:true}).waitFor();
 assert.equal(await page.getByRole("navigation",{name:/breadcrumb/i}).count(),0);
 await nav.getByRole("link",{name:"Runs",exact:true}).click();
 await page.getByRole("link",{name:"Manual skill run",exact:true}).waitFor();await page.getByRole("link",{name:"Triggered skill run",exact:true}).waitFor();assert.equal(runsQuery,skill.id);
 await nav.getByRole("link",{name:"Triggers",exact:true}).click();await page.getByRole("button",{name:"Save trigger",exact:true}).waitFor();
 assert.equal(await page.getByLabel("Prompt",{exact:true}).count(),0);
 await page.goto(origin+`/triggers/${triggerId}/settings/events`);await page.getByRole("button",{name:"Save trigger",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,`/skills/${skill.id}/triggers`);
 await page.goto(origin+`/triggers/${triggerId}`);await nav.getByRole("link",{name:"Overview",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,`/skills/${skill.id}`);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await context.close();
});

test("legacy Skills graph parameter shows the table and links to the owning skill",async()=>{
 const context=await browser.newContext(),page=await context.newPage(),triggerId="a93b4759-2a69-4dd3-86c8-4941529bb011";
 await page.route("**/api/v1/**",route=>{
  const path=new URL(route.request().url()).pathname;let json={items:[],nextCursor:null};
  if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:"owner",role:"owner"},capabilities:[]};
  if(path===`/api/v1/skills/${skill.id}`)json=skill;
  if(path==="/api/v1/presets")json={presets:[]};
  if(path===`/api/v1/triggers/${triggerId}`)json={id:triggerId,name:skill.key,skillId:skill.id,events:[]};
  if(path==="/api/v1/skills")json={items:[skill],nextCursor:null};
 if(path==="/api/v1/triggers/graph")json={nodes:[{id:triggerId,type:"trigger",label:skill.key,enabled:true,runningCount:0,concurrencyLimit:1},{id:"webhook",type:"webhook",label:"GitHub",provider:"github"}],edges:[{id:"edge",source:"webhook",target:triggerId,label:"Push",details:"Repository push",kind:"webhook",enabled:true}]};
  if(path.endsWith("/files") && !("files" in json))json={revision:1,commit:null,files:[]};
  return route.fulfill({json});
 });
 await page.goto(origin+"/skills?view=graph");
 await page.getByRole("table",{name:"Skills",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Fit graph to view"}).count(),0);
 await page.getByRole("link",{name:skill.key,exact:true}).press("Enter");
 await page.getByRole("navigation",{name:"Skill navigation",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,`/skills/${skill.id}`);
 await context.close();
});

test("directory browser reads nested text, identifies binary files and retains cached content on refresh failure",async()=>{
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();let reads=0,offline=false;
 await page.route("**/api/v1/**",route=>{
  const path=new URL(route.request().url()).pathname;let json={items:[],nextCursor:null};
  if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:"owner",role:"owner"},capabilities:[]};
  if(path===`/api/v1/skills/${skill.id}`)json=skill;
  if(path==="/api/v1/presets")json={presets:[]};
  if(path===`/api/v1/skills/${skill.id}/files`){reads++;if(offline)return route.fulfill({status:503,json:{error:{message:"Upstream offline"}}});json={revision:1,commit:"a".repeat(40),files:[{path:"SKILL.md",content:btoa(skill.body),executable:false},{path:"nested/context.txt",content:btoa("Supporting text"),executable:false},{path:"assets/logo.bin",content:btoa("\x00\xff"),executable:false}]};}
  if(path===`/api/v1/skills/${skill.id}/trigger`)json={trigger:null};
  if(path.endsWith("/files") && !("files" in json))json={revision:1,commit:null,files:[]};
  return route.fulfill({json});
 });
 await page.goto(origin+`/skills/${skill.id}`);await page.getByRole("button",{name:"Open file nested/context.txt",exact:true}).click();await page.getByText("Supporting text",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Open file assets/logo.bin",exact:true}).click();await page.getByText("Binary file · 2 bytes. Text preview unavailable.",{exact:true}).waitFor();
 await page.getByRole("navigation",{name:"Skill navigation",exact:true}).getByRole("link",{name:"Triggers",exact:true}).click();await page.getByRole("button",{name:"Save trigger",exact:true}).waitFor();
 await page.getByRole("navigation",{name:"Skill navigation",exact:true}).getByRole("link",{name:"Overview",exact:true}).click();await page.getByRole("button",{name:"Open file SKILL.md",exact:true}).waitFor();assert.equal(reads,1);
 offline=true;await page.getByRole("button",{name:"Refresh files",exact:true}).click();await page.getByRole("alert").filter({hasText:"showing cached revision 1"}).waitFor();
 await page.getByRole("button",{name:"Open file nested/context.txt",exact:true}).click();await page.getByText("Supporting text",{exact:true}).waitFor();assert.equal(reads,2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await context.close();
});

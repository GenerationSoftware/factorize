import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,"http://fixture").pathname;const file=path.startsWith("/assets/")||path==="/theme-init.js"?path:"/index.html";try{res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(await readFile(new URL("../dist"+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});

for(const width of [390,1280])test(`structured skill editor, Markdown and preset autosave at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
 try{
  const id="skill";let current={id,key:"review",body:"fixture",revision:1,definition:{name:"review",description:"Review code",factorize:{concurrency:0,disabled:false},markdown:"# Review guide\n\n- First step\n\n[Unsafe](javascript:alert(1))\n<script>alert(1)</script>"}};
  const presets=[{id:"vm-default",kind:"vm",slug:"standard",name:"Standard",isDefault:true,settings:{provider:"none"},revision:1},{id:"vm-fast",kind:"vm",slug:"fast",name:"Fast",isDefault:false,settings:{provider:"none"},revision:1},{id:"permission",kind:"permission",slug:"limited",name:"Limited",isDefault:true,settings:{runScopes:[]},revision:1},{id:"model",kind:"model",slug:"careful",name:"Careful",isDefault:true,settings:{model:"fixture"},revision:1}];
  let conflict=false;const writes=[];
  await page.route("**/api/v1/**",async route=>{
   const path=new URL(route.request().url()).pathname;let json={};
   if(path==="/api/v1/session")json={authenticated:true,user:{id:"owner",email:"owner@test"},team:{id:"team",role:"owner"},capabilities:["skills:read","skills:write","integrations:read"]};
   else if(path==="/api/v1/presets")json={presets};
   else if(path===`/api/v1/skills/${id}`){if(route.request().method()==="PUT"){const body=route.request().postDataJSON();writes.push(body);if(conflict)return route.fulfill({status:409,json:{error:{message:"Skill changed; reload before saving."}}});assert.equal(body.expectedRevision,current.revision);current={...current,key:body.definition.name,definition:body.definition,revision:current.revision+1};}json=current;}
   else if(path.endsWith("/files"))json={revision:current.revision,commit:"fixture-commit",files:[{path:"helper.txt",content:btoa("Supporting content"),executable:false}]};
   else if(path==="/api/v1/skills"){if(route.request().method()==="POST"){const body=route.request().postDataJSON();writes.push(body);json={...current,key:body.key,definition:body.definition};}else json={items:[current],nextCursor:null};}
   return route.fulfill({json});
  });
  await page.goto(origin+"/skills/skill");await page.getByRole("heading",{name:"Review guide",exact:true}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Instructions",exact:true}).count(),0);assert.equal(await page.getByRole("button",{name:"Start run",exact:true}).count(),0);
  assert.equal(await page.locator(".skill-markdown script").count(),0);assert.equal(await page.locator('.skill-markdown a[href^="javascript:"]').count(),0);
  await page.getByRole("button",{name:"Open file helper.txt"}).click();await page.getByLabel("Contents of helper.txt").getByText("Supporting content").waitFor();
  const vm=page.getByRole("combobox",{name:"VM preset",exact:true});await vm.fill("Fast");await vm.press("Enter");await page.getByText("Skill saved.",{exact:true}).waitFor();assert.equal(current.definition.factorize["vm-preset"],"fast");assert.equal(writes[0].definition.markdown,current.definition.markdown);
  conflict=true;await vm.fill("Team default");await vm.press("Enter");await page.getByRole("alert").filter({hasText:"Skill changed"}).waitFor();assert.equal(current.definition.factorize["vm-preset"],"fast");
  conflict=false;await page.getByRole("button",{name:"Reload skill"}).click();await vm.fill("Team default");await vm.press("Enter");await page.getByText("Skill saved.",{exact:true}).waitFor();assert.equal(current.definition.factorize["vm-preset"],undefined);
  await page.getByRole("button",{name:"Edit",exact:true}).click();await page.getByLabel("Name",{exact:true}).fill("review-updated");await page.getByLabel("Description",{exact:true}).fill("Updated description");await page.getByLabel("Concurrency limit").fill("0");await page.getByLabel("Disabled",{exact:true}).check();await page.getByLabel("Markdown body").fill("# Updated guide\n\nBody text");
  await page.getByRole("button",{name:"Save skill",exact:true}).click();await page.getByRole("heading",{name:"Updated guide",exact:true}).waitFor();assert.equal(current.definition.factorize.disabled,true);assert.equal(current.definition.description,"Updated description");
  current={...current,revision:current.revision+1,definition:{...current.definition,factorize:{...current.definition.factorize,"permission-preset":"unavailable"}}};
  await page.reload();await page.getByRole("alert").filter({hasText:"This preset is unavailable"}).waitFor();
  await page.goto(origin+"/skills");await page.getByRole("button",{name:"New skill",exact:true}).click();await page.getByLabel("Markdown body").waitFor();await page.getByLabel("Concurrency limit").fill("0");assert.equal(await page.getByLabel("Disabled",{exact:true}).isChecked(),false);await page.getByLabel("Name",{exact:true}).fill("new-skill");await page.getByLabel("Markdown body").fill("New body");await page.getByRole("button",{name:"Save skill",exact:true}).click();await page.getByLabel("Markdown body").waitFor({state:"detached"});assert.equal(writes.at(-1).definition.name,"new-skill");
 }finally{await context.close();}
});

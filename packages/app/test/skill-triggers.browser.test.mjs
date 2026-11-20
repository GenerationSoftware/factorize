import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,"http://fixture").pathname;const file=path.startsWith("/assets/")||path==="/theme-init.js"?path:"/index.html";try{res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(await readFile(new URL("../dist"+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});


test("Triggers replaces Settings, hides manual events and preserves configuration across edits",async()=>{
 const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(7000);
 try{
  let trigger={id:"automation",name:"review",enabled:true,updatedAt:"2026-01-01T00:00:00.000Z",events:[{id:"manual",slug:"manual",kind:"manual",enabled:true,config:{}}]};const writes=[];
  await page.route("**/api/v1/**",async route=>{const path=new URL(route.request().url()).pathname;let json={};
   if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@test"},team:{id:"team",role:"owner"},capabilities:["skills:read","skills:write"]};
   else if(path==="/api/v1/skills/skill")json={id:"skill",key:"review",body:"Review",revision:1};
   else if(path==="/api/v1/presets")json={presets:[]};
   else if(path==="/api/v1/skills/skill/trigger"){if(route.request().method()==="PUT"){const body=route.request().postDataJSON();writes.push(body);trigger={...trigger,...body};}json={trigger};}
   else if(path==="/api/v1/trigger-event-availability")json={schedule:true,triggerLifecycle:true,manual:true};
   else if(path.endsWith("/files"))json={revision:1,commit:null,files:[]};
   return route.fulfill({json});});
  await page.goto(origin+"/skills/skill/settings/trigger");await page.getByRole("button",{name:"Add trigger",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/skills/skill/triggers");
  const nav=page.getByRole("navigation",{name:"Skill navigation"});assert.equal(await nav.getByRole("link",{name:"Settings",exact:true}).count(),0);await nav.getByRole("link",{name:"Triggers",exact:true}).waitFor();
  await page.getByText("No triggers configured. Add a trigger to automate this skill.",{exact:true}).waitFor();assert.equal(await page.getByText("manual",{exact:true}).count(),0);
  await page.getByRole("button",{name:"Add trigger",exact:true}).click();await page.getByLabel("Cron",{exact:true}).fill("*/5 * * * *");await page.getByRole("button",{name:"Save trigger",exact:true}).click();await page.getByRole("status").filter({hasText:"Trigger saved"}).waitFor();assert.deepEqual(writes.at(-1).events.map(e=>e.kind),["schedule"]);
  await page.getByLabel("Automation enabled",{exact:true}).uncheck();await page.getByRole("button",{name:"Save trigger",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('input[type="checkbox"]')?.checked);assert.equal(writes.at(-1).enabled,false);
  await page.getByRole("button",{name:"Remove event",exact:true}).click();await page.getByRole("button",{name:"Save trigger",exact:true}).click();await page.getByText("No triggers configured. Add a trigger to automate this skill.",{exact:true}).waitFor();assert.equal(writes.at(-1).events.length,0);
  for(const section of ["general","vm","permissions"]){await page.goto(origin+`/skills/skill/settings/${section}`);await page.getByRole("button",{name:"Edit",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/skills/skill");}
  await page.goto(origin+"/skills/skill/settings");await page.getByRole("button",{name:"Add trigger",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/skills/skill/triggers");
 }finally{await context.close();}
});

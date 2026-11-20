import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,"http://fixture").pathname;const file=path.startsWith("/assets/")||path==="/theme-init.js"?path:"/index.html";try{res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(await readFile(new URL("../dist"+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
for(const width of [390,1280])for(const [kind,section] of [["vm","vm"],["permission","permissions"],["model","models"]])test(`${section} preset pages, menus, confirmation and errors at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 page.setDefaultTimeout(7000);
 try{
  const settings=kind==="vm"?{provider:"none"}:kind==="model"?{modelAccountId:"account",model:"fixture-model",effort:"high"}:{runScopes:[]};
  let presets=[{id:"default",kind,name:"Existing",slug:"existing",settings,revision:1,isDefault:true,executionConfigId:null}];let denied=false,deleted=0;
  await page.route("**/api/v1/**",async route=>{
   const path=new URL(route.request().url()).pathname,method=route.request().method();let json={};
   if(path==="/api/v1/session")json={authenticated:true,user:{id:"owner",email:"owner@test"},team:{id:"team",role:"owner"},capabilities:["team:read","team:write","skills:read","skills:write","integrations:read","integrations:write"]};
   else if(path==="/api/v1/team")json={id:"team",name:"Team",runDefaults:{capacity:4}};
   else if(path==="/api/v1/presets"){
    if(method==="POST"){const body=route.request().postDataJSON();presets.push({...body,id:"new",revision:1,isDefault:false,executionConfigId:null});json={preset:presets.at(-1)};}else json={presets};
   }else if(path.endsWith("/default")&&path.includes("/presets/")){const id=path.split("/").at(-2);presets=presets.map(p=>({...p,isDefault:p.id===id}));json={preset:presets.find(p=>p.id===id)};}
   else if(path.startsWith("/api/v1/presets/")){const id=path.split("/").at(-1);if(method==="PUT"){presets=presets.map(p=>p.id===id?{...p,...route.request().postDataJSON(),revision:p.revision+1}:p);json={preset:presets.find(p=>p.id===id)};}else if(method==="DELETE"){if(denied)return route.fulfill({status:409,json:{error:{message:"Used by skills: review. Change their preset selections before deleting."}}});presets=presets.filter(p=>p.id!==id);deleted++;json={deleted:true};}}
   else if(path==="/api/v1/integrations")json={exeConnections:[],linear:null};
   else if(path==="/api/v1/fly/connection")json={connection:null};
   else if(path==="/api/v1/model-accounts")json={revision:1,accounts:[{id:"account",name:"Fixture account",credentialConfigured:true}]};
   else if(path==="/api/v1/integrations/bearer")json={revision:1,integrations:[]};
   else if(path==="/api/v1/github-installations")json=[];
   else if(path==="/api/v1/x/connections")json={connections:[]};
   else if(path==="/api/v1/trigger-selector")json={items:[],nextCursor:null};
   return route.fulfill({json});
  });
  await page.goto(origin+`/settings/${section}`);
  await page.getByLabel("Actions for Existing").click();
  assert.equal(await page.getByRole("menuitem",{name:"Delete",exact:true}).isDisabled(),true);
  await page.keyboard.press("Escape");
  await page.getByRole("link",{name:"Add preset",exact:true}).click();
  assert.equal(new URL(page.url()).pathname,`/settings/${section}/new`);
  await page.reload();await page.getByLabel("Preset name",{exact:true}).fill("New preset");
  if(kind==="model"){await page.getByLabel("Model account",{exact:true}).selectOption("account");await page.getByLabel("Model",{exact:true}).fill("new-model");}
  await page.getByRole("button",{name:"Save preset",exact:true}).click();
  await page.getByText("New preset",{exact:true}).waitFor();
  await page.getByLabel("Actions for New preset").click();await page.getByRole("menuitem",{name:"Edit",exact:true}).click();
  assert.equal(new URL(page.url()).pathname,`/settings/${section}/new/edit`);
  await page.getByLabel("Preset name",{exact:true}).fill("Updated preset");
  assert.equal(await page.getByLabel("Slug",{exact:true}).isDisabled(),true);
  await page.getByRole("button",{name:"Save preset",exact:true}).click();await page.getByText("Updated preset",{exact:true}).waitFor();
  await page.getByLabel("Actions for Updated preset").click();await page.getByRole("menuitem",{name:"Make team default",exact:true}).click();
  await page.locator("li").filter({has:page.getByText("Updated preset",{exact:true})}).getByText("Default",{exact:true}).waitFor();
  await page.getByLabel("Actions for Existing").click();await page.getByRole("menuitem",{name:"Make team default",exact:true}).click();
  await page.locator("li").filter({has:page.getByText("Existing",{exact:true})}).getByText("Default",{exact:true}).waitFor();
  await page.getByLabel("Actions for Updated preset").click();await page.getByRole("menuitem",{name:"Delete",exact:true}).click();
  await page.getByRole("dialog").waitFor();await page.getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(deleted,0);
  denied=true;await page.getByLabel("Actions for Updated preset").click();await page.getByRole("menuitem",{name:"Delete",exact:true}).click();await page.getByRole("button",{name:"Delete preset",exact:true}).click();await page.getByRole("alert").filter({hasText:"Used by skills: review"}).waitFor();
  denied=false;await page.getByRole("button",{name:"Delete preset",exact:true}).click();await page.getByText("Updated preset",{exact:true}).waitFor({state:"detached"});assert.equal(deleted,1);
  await page.getByLabel("Actions for Existing").click();await page.getByRole("menuitem",{name:"Edit",exact:true}).click();await page.getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(new URL(page.url()).pathname,`/settings/${section}`);
  if(kind==="vm")await page.getByLabel("Team concurrency limit",{exact:true}).waitFor();
 }finally{await context.close();}
});

import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,"http://fixture").pathname;const file=path.startsWith("/assets/")||path==="/theme-init.js"?path:"/index.html";try{res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(await readFile(new URL("../dist"+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});


for(const width of [390,1280])test(`skills table, descriptions, Run actions and pagination at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
 try{
  let mode="rows",releaseInitial;const initialGate=new Promise(resolve=>releaseInitial=resolve);let initial=true;
  const presets=[{id:"vm",kind:"vm",slug:"standard",name:"Standard",isDefault:true,settings:{provider:"none"},revision:1},{id:"permission",kind:"permission",slug:"limited",name:"Limited",isDefault:true,settings:{},revision:1},{id:"model",kind:"model",slug:"careful",name:"Careful",isDefault:true,settings:{},revision:1}];
  await page.route("**/api/v1/**",async route=>{const url=new URL(route.request().url()),path=url.pathname;let json={};
   if(path==="/api/v1/session")json={authenticated:true,user:{id:"u",email:"owner@test"},team:{id:"t",role:"owner"},capabilities:["skills:read"]};
   else if(path==="/api/v1/presets")json={presets};
   else if(path==="/api/v1/skills"){
    if(initial){initial=false;await initialGate;}
    if(mode==="error")return route.fulfill({status:503,json:{error:{message:"Fixture list unavailable"}}});
    const second=url.searchParams.has("cursor");
    json=mode==="empty"?{items:[],nextCursor:null}:{items:second?[{id:"second",key:"manual-only",description:"Manual only",factorize:{concurrency:0,disabled:false},hasTriggers:false}]:[{id:"first",key:"scheduled-review",description:"Review every day",factorize:{"vm-preset":"standard",concurrency:0,disabled:false},hasTriggers:true}],nextCursor:second?null:"next"};
   }
   return route.fulfill({json});
  });
  await page.goto(origin+"/skills");await page.getByText("Loading skills…",{exact:true}).waitFor();releaseInitial();const table=page.getByRole("table",{name:"Skills",exact:true});await table.waitFor();
  assert.deepEqual(await table.getByRole("columnheader").allTextContents(),["Skill name","Description","Actions"]);
  await table.getByText("Review every day",{exact:true}).waitFor();await table.getByRole("button",{name:"Run scheduled-review",exact:true}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Skills",exact:true}).count(),0);assert.equal(await page.getByPlaceholder("Search keys").count(),0);assert.equal(await page.getByRole("navigation",{name:"Skill views"}).count(),0);
  await page.getByRole("button",{name:"More skills",exact:true}).click();await table.getByRole("link",{name:"manual-only",exact:true}).waitFor();await table.getByRole("button",{name:"Run manual-only",exact:true}).waitFor();
  await page.getByRole("button",{name:"Previous skills",exact:true}).click();await table.getByRole("link",{name:"scheduled-review",exact:true}).waitFor();
  mode="empty";await page.reload();await page.getByRole("heading",{name:"No skills yet",exact:true}).waitFor();
  mode="error";await page.reload();await page.getByRole("alert").filter({hasText:"Fixture list unavailable"}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await context.close();}
});

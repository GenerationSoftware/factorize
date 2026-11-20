import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,"http://fixture").pathname;const file=path.startsWith("/assets/")||path==="/theme-init.js"?path:"/index.html";try{res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(await readFile(new URL("../dist"+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});


test("global search opens skills and runs, blocks stale selections and handles empty/error states",async()=>{
 const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(7000);
 try{
  await page.route("**/api/v1/**",async route=>{const url=new URL(route.request().url()),path=url.pathname;let json={};
   if(path==="/api/v1/session")json={authenticated:true,user:{id:"owner",email:"owner@test"},team:{id:"team",role:"owner"},capabilities:["skills:read","runs:read"]};
   else if(path==="/api/v1/presets")json={presets:[]};
   else if(path==="/api/v1/skills")json={items:[],nextCursor:null};
   else if(path==="/api/v1/skills/skill")json={id:"skill",key:"review",body:"Review",revision:1};
   else if(path.endsWith("/files"))json={revision:1,commit:null,files:[]};
   else if(path==="/api/v1/runs")json={items:[],nextCursor:null};
   else if(path==="/api/v1/search"){
    const q=url.searchParams.get("q");if(q==="error")return route.fulfill({status:503,json:{error:{message:"Fixture search unavailable"}}});
    if(q==="wait")await new Promise(resolve=>setTimeout(resolve,300));
    const kind=q==="run"?"run":"skill",id=kind==="run"?"run":"skill";
    json={items:q==="empty"?[]:[{kind,id,title:"Review",subtitle:"",url:`/${kind==="run"?"runs":"skills"}/${id}`,source:{kind,id,label:"Review"},match:{text:"Review",ranges:[{start:0,end:3}]}}]};
   }
   return route.fulfill({json});
  });
  await page.goto(origin+"/skills");const launch=page.getByRole("button",{name:"Search skills and runs",exact:true});await launch.click();
  let input=page.getByRole("combobox",{name:"Search skill names and run names",exact:true});await input.fill("review");await page.getByRole("option").waitFor();await input.press("Enter");await page.getByRole("button",{name:"Edit",exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/skills/skill");
  await launch.click();input=page.getByRole("combobox",{name:"Search skill names and run names",exact:true});await input.fill("review");await page.getByRole("option").waitFor();await input.fill("wait");await input.press("Enter");assert.equal(await page.getByRole("dialog").count(),1);await page.getByRole("status").filter({hasText:/Searching|Updating/}).waitFor();
  await input.fill("empty");await page.getByText("No results found.",{exact:true}).waitFor();
  await input.fill("error");await page.getByRole("alert").filter({hasText:"Fixture search unavailable"}).waitFor();
  await input.fill("run");await page.getByRole("option").filter({hasText:"Run · Review"}).waitFor();await page.getByRole("option").click();await page.waitForURL(/\/runs\/run/);assert.equal(await page.getByRole("dialog").count(),0);
 }finally{await context.close();}
});

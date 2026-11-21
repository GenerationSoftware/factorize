import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname,file=/^\/assets\//.test(path)?path:'/index.html';try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../dist'+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
for(const width of [390,1280])test(`Phoenix configure/test/update/disable/disconnect at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const empty={configured:false,endpoint:'',projectName:'factorize',projectId:null,credentialConfigured:false,enabled:false,revision:0,lastTestAt:null,lastError:null};let current={...empty};const writes=[];
 await page.route('**/api/v1/**',r=>{const path=new URL(r.request().url()).pathname;let json={};if(path.endsWith('/session'))json={authenticated:true,user:{id:'owner',email:'owner@fixture.test'},team:{id:'team',name:'Team',role:'owner'},capabilities:['integrations:read','integrations:write']};else if(path==='/api/v1/integrations')json={linear:null,clickup:null,exeConnections:[],ampConnections:[],cloudflareTail:{installations:[]}};else if(path.endsWith('/github/installations'))json=[];else if(path.endsWith('/fly/connection'))json={connection:null};else if(path.endsWith('/x/connections'))json={connections:[]};else if(path.endsWith('/model-accounts'))json={revision:0,accounts:[]};else json={integrations:[],revision:0};return r.fulfill({json});});
 await page.route('**/api/v1/integrations/phoenix',r=>{if(r.request().method()==='PUT'){const body=r.request().postDataJSON();writes.push(body);assert.equal(body.expectedRevision,current.revision);current={...current,configured:true,credentialConfigured:true,endpoint:body.endpoint,projectName:body.projectName,enabled:body.enabled,revision:current.revision+1};}else if(r.request().method()==='DELETE'){assert.equal(r.request().postDataJSON().expectedRevision,current.revision);current={...empty};}return r.fulfill({json:current});});
 await page.route('**/api/v1/integrations/phoenix/test',r=>r.fulfill({json:{connected:true,projectFound:true,error:null}}));
 try {
  await page.goto(origin+'/integrations');
  await page.getByRole('button',{name:'Add Phoenix Cloud telemetry integration',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Phoenix base URL').fill('https://phoenix.example.com/s/fixture');
  await dialog.getByLabel('Phoenix project').fill('fixture');
  await dialog.getByLabel('Phoenix API key').fill('fixture-secret');
  await dialog.getByRole('button',{name:'Save Phoenix settings'}).click();
  await page.getByRole('status').filter({hasText:'Phoenix settings saved.'}).waitFor();
  assert.equal(writes[0].apiKey,'fixture-secret');assert.equal(await page.locator('input[type="password"]').count(),0);
  const actions=page.getByRole('button',{name:'Actions for Phoenix Cloud telemetry',exact:true});
  await actions.click();await page.getByRole('menuitem',{name:'Test connection',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Phoenix connection verified.'}).waitFor();
  await actions.click();await page.getByRole('menuitem',{name:'Edit integration',exact:true}).click();
  dialog=page.getByRole('dialog');assert.equal(await dialog.getByLabel('Phoenix API key',{exact:false}).inputValue(),'');
  await dialog.getByLabel('Phoenix project').fill('changed');await dialog.getByRole('button',{name:'Save Phoenix settings'}).click();
  await page.getByRole('status').filter({hasText:'Phoenix settings saved.'}).waitFor();assert.equal(writes[1].apiKey,undefined);
  await actions.click();await page.getByRole('menuitem',{name:'Edit integration',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Export telemetry for new runs').uncheck();
  await page.getByRole('dialog').getByRole('button',{name:'Save Phoenix settings'}).click();
  await page.getByRole('status').filter({hasText:'Phoenix settings saved.'}).waitFor();assert.equal(writes[2].enabled,false);
  page.once('dialog',dialog=>dialog.accept());await actions.click();await page.getByRole('menuitem',{name:'Disconnect',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Phoenix disconnected.'}).waitFor();assert.equal(current.credentialConfigured,false);
  assert.equal(await actions.count(),0);assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth>window.innerWidth),false);
 }finally{await context.close();}
});

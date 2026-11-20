import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
let server,origin,browser;
before(async()=>{server=createServer(async(req,res)=>{const path=new URL(req.url,'http://fixture').pathname,file=/^\/assets\//.test(path)?path:'/index.html';try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../dist'+file,import.meta.url)));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
const handle='11111111-1111-4111-8111-111111111111';
for(const width of [390,1280])test(`authenticated generic upload fallback without a run at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage();let state='pending',received;
 await page.route('**/api/v1/session',r=>r.fulfill({json:{authenticated:true,user:{id:'owner',email:'owner@fixture.test'},team:{id:'team',name:'Team',role:'owner'},capabilities:[]}}));
 await page.route(`**/api/v1/proxy-payloads/${handle}`,r=>r.fulfill({json:{handle,name:'attachment.bin',state,size:state==='ready'?5:0,sha256:state==='ready'?'fixture-checksum':null,mediaType:'application/octet-stream',expiresAt:new Date(Date.now()+1800000).toISOString(),uploadUrl:origin+`/api/v1/proxy-payloads/${handle}/bytes`,browserUploadUrl:origin+`/uploads/proxy/${handle}`}}));
 await page.route(`**/api/v1/proxy-payloads/${handle}/bytes`,async r=>{assert.equal(r.request().method(),'PUT');received=r.request().postDataBuffer();state='ready';await r.fulfill({json:{handle,state,size:5}});});
 try{await page.goto(origin+`/uploads/proxy/${handle}`);await page.getByLabel('File',{exact:true}).setInputFiles({name:'input.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,1,2,3])});await page.getByRole('button',{name:'Upload file',exact:true}).click();await page.getByText('Upload complete.',{exact:false}).waitFor();assert.deepEqual(received,Buffer.from([0,255,1,2,3]));assert.equal(await page.locator('code').textContent(),handle);assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth>window.innerWidth),false);}finally{await context.close();}
});
test('anonymous upload page requires sign-in',async()=>{const context=await browser.newContext(),page=await context.newPage();await page.route('**/api/v1/session',r=>r.fulfill({json:{authenticated:false}}));try{await page.goto(origin+`/uploads/proxy/${handle}`);await page.waitForURL('**/auth/login**');assert.equal(await page.getByRole('button',{name:'Upload file',exact:true}).count(),0);}finally{await context.close();}});

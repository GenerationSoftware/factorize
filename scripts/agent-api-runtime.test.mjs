import { apiWranglerCli } from "./api-wrangler.mjs";
import {backgroundRunAcceptance} from './background-run-acceptance.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomUUID, randomBytes, createHmac, createHash, createCipheriv, generateKeyPairSync, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const { Miniflare, convertV4MiniflareOptions } = createRequire(new URL('../packages/api/package.json', import.meta.url))('miniflare');
import { chromium } from 'playwright';
import pg from 'pg';
const exec = promisify(execFile);

// Real workerd/OAuth issuance, compiled browser consent, PostgreSQL and R2.
// The harness replaces only the network destination: every upstream HTTP
// request goes to a local deterministic fixture, never live service credentials.
test('agent API OAuth, policy, connection isolation, run identity and response lifecycle', {skip:!process.env.AUTH_TEST_DATABASE_URL,timeout:180000}, async t => {
  const address = new URL(process.env.AUTH_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(address.hostname));
  const admin=new pg.Client({connectionString:address.href});await admin.connect();
  const name='agent_api_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(tmpdir()+'/agent-api-');
  let db,mf,browser,upstream,site,worker;
  const tenant=randomUUID(),user=randomUUID(),key=randomBytes(32),secret=randomBytes(32).toString('hex');
  let origin;
  const encrypt=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return iv.toString('base64')+'.'+Buffer.concat([cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');};
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'};
  const jwt=claims=>{const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify(claims)).toString('base64url');return head+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+body),privateKey).toString('base64url');};
  // Simulate the documented exe.dev HTTPS command/identity API. Sign a real
  // vendor JWT and keep the guest-local proof independent of the VM name.
  const guestProof=randomBytes(32).toString('hex');
  const issuer='https://exe.dev/issuer/fixture';
  let wif,failEnrollment=true,guestJwt;
  const observed=[];let releaseStream;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);address.pathname='/'+name;db=new pg.Client({connectionString:address.href});await db.connect();
    const backfillTenant=randomUUID();
    for(const file of (await readdir('packages/api/migrations')).filter(file=>/^\d+.*\.sql$/.test(file)).sort()) {
      await db.query(await readFile('packages/api/migrations/'+file,'utf8'));
      if(file==='0058_x_credential_versions.sql') {
        await db.query("INSERT INTO app.tenants(id,name) VALUES($1,'Migration fixture')",[backfillTenant]);
        for(const kind of ['exe:existing','amp:existing','clickup','cloudflare-tail:existing']) await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,'cipher')",[backfillTenant,kind]);
        await db.query("INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token) VALUES($1,'existing','Existing','cipher')",[backfillTenant]);
        for (const status of ['connected','pending']) await db.query("INSERT INTO app.x_connections(tenant_id,id,name,client_id,scopes,encrypted_secret,status) VALUES($1,$2,$3,'fixture',ARRAY['users.read'],'cipher',$3)",[backfillTenant,randomUUID(),status]);
      }
    }
    const backfilled=(await db.query('SELECT kind,policy,available FROM app.agent_integrations WHERE tenant_id=$1 ORDER BY kind,available',[backfillTenant])).rows;
    assert.deepEqual(backfilled.map(row=>row.kind),['amp','clickup','exe','fly','x','x']);
    assert.deepEqual(backfilled.filter(row=>row.kind==='x').map(row=>row.available),[false,true]);
    assert.ok(backfilled.every(row=>row.policy==='requestable'),'migration preserves explicit consent by default');
    await db.query('INSERT INTO app.tenants(id,name) VALUES($1,$2)',[tenant,'Agent fixture']);
    await db.query('INSERT INTO app.auth_users(id,email,email_verified) VALUES($1,$2,true)',[user,'agent@example.test']);
    await db.query("INSERT INTO app.members(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[tenant,user,'agent@example.test']);
    await db.query('INSERT INTO app.integration_collections(tenant_id) VALUES($1)',[tenant]);
    const createIntegration=async (name,kind='bearer',payload='upstream-private')=>{
      const id=randomUUID();await db.query("INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload) VALUES($1,$2,$3,$4,$5,'Fixture usage',1,$6)",[tenant,id,kind,name,kind==='bearer'?'https://fixture.upstream.com':null,encrypt((kind==='bearer'?'factorize-managed-bearer-v1:':'factorize-managed-model-cache-v1:')+payload)]);
      return (await db.query('SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id=$2',[tenant,id])).rows[0];
    };
    const baseline=await createIntegration('Baseline API'),requestable=await createIntegration('Requestable API');
    await db.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND id=$2",[tenant,baseline.id]);
    upstream=createServer(async(req,res)=>{
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const target=new URL(req.headers['x-fixture-target']);
      const body=Buffer.concat(chunks).toString();observed.push({target:target.href,method:req.method,headers:req.headers,body});
      if(target.hostname==='exe.dev') {
        if(target.pathname.startsWith('/issuer/')) {
          res.end(JSON.stringify(target.pathname.endsWith('openid-configuration')?{issuer,jwks_uri:issuer+'/jwks'}:{keys:[jwk]}));return;
        }
        if(body==='integrations list --json') {res.end(JSON.stringify(wif?[wif]:[]));return;}
        if(body.startsWith('integrations add wif ')) {
          const name=body.match(/--name='([^']+)'/)[1], audience=body.match(/--audience='([^']+)'/)[1];
          assert.equal(wif,undefined,'retry must reuse the original integration');
          assert.ok(body.includes("--attach='vm:external-guest'"));
          wif={name,type:'wif',config:{issuer_id:'fixture',subject:name,audience},attachments:['vm:external-guest']};
          res.end('{}');return;
        }
        if(body.startsWith("ssh 'external-guest' ")) {
          if(failEnrollment) {failEnrollment=false;res.statusCode=503;res.end();return;}
          if(body.includes('sha256sum')) {res.end(createHash('sha256').update(guestProof+'\n').digest('hex'));return;}
          const now=Math.floor(Date.now()/1000);
          guestJwt=jwt({iss:issuer,sub:wif.name,aud:wif.config.audience,iat:now,exp:now+300});
          res.end(guestJwt);return;
        }
        if(body.startsWith('integrations remove ')) {wif=undefined;res.end('{}');return;}
      }
      if(target.hostname==='oidc.fly.io') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(target.pathname.endsWith('openid-configuration')?{issuer:'https://oidc.fly.io/fixture',jwks_uri:'https://oidc.fly.io/fixture/jwks'}:{keys:[jwk]}));return;}
      if(target.pathname==='/app/installations/17/access_tokens') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:'github-private',expires_at:new Date(Date.now()+3600000).toISOString()}));return;}
      if(target.pathname==='/oauth/token') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:target.hostname==='api.linear.app'?'linear-refreshed':'model-oauth-private',refresh_token:'refreshed-private',expires_in:3600}));return;}
      if(target.pathname==='/v1/chat/completions') {
        const input=JSON.parse(body);
        if(JSON.stringify(input.messages).includes('Simulate a launch failure')) {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture model unavailable',type:'invalid_request_error'}}));return;}
        res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'background',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content:JSON.stringify({status:'succeeded',summary:'Review complete'})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
      }
      if(target.pathname==='/large') {res.setHeader('Content-Type','application/octet-stream');res.end(Buffer.alloc(1140000,0xff));return;}
      if(target.pathname==='/bom') {res.end(Buffer.from([0xef,0xbb,0xbf,0x61]));return;}
      if(target.pathname==='/binary') {res.end(Buffer.from([0,255,254,1]));return;}
      if(target.pathname==='/redirect') {res.writeHead(302,{Location:'https://evil.invalid/'});res.end();return;}
      if(target.pathname==='/stream') {res.setHeader('Content-Type','text/event-stream');res.write('first\n');releaseStream=()=>res.end('last\n');return;}
      if(target.pathname==='/failure') res.statusCode=422;
      res.setHeader('Set-Cookie','private=hidden');res.setHeader('Authorization','Bearer should-not-escape');res.end('fixture response');
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const config=JSON.parse(await readFile('packages/api/wrangler.jsonc','utf8'));
    config.main=resolve('packages/api/test/fixtures/agent-api-runtime-worker.ts');config.assets.directory=resolve('packages/app/dist');
    await writeFile(directory+'/wrangler.json',JSON.stringify(config));
    await exec(process.execPath,[apiWranglerCli,'deploy','--dry-run','--config',directory+'/wrangler.json','--outdir',directory],{maxBuffer:2*1024*1024});
    await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',directory+'/key.pem','-out',directory+'/cert.pem','-days','1','-subj','/CN=localhost']);
    site=createHttpsServer({key:await readFile(directory+'/key.pem'),cert:await readFile(directory+'/cert.pem')},async(req,res)=>{
      try {
        const parts=[];for await(const part of req) parts.push(part);
        const response=await worker.fetch(origin+req.url,{redirect:'manual',method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{})});
        res.statusCode=response.status;response.headers.forEach((value,name)=>{if(name!=='set-cookie') res.setHeader(name,value);});
        res.setHeader('Set-Cookie',response.headers.getSetCookie());
        if(response.body) for await(const part of response.body) res.write(part);res.end();
      }catch(error){res.statusCode=500;res.end(String(error));}
    });
    await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));origin='https://localhost:'+site.address().port;
    mf=new Miniflare(convertV4MiniflareOptions({name:"factorize",modules:true,modulesRoot:directory,scriptPath:directory+'/agent-api-runtime-worker.js',compatibilityDate:'2026-09-10',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],
      bindings:{LINEAR_CLIENT_ID:'fixture-client',LINEAR_CLIENT_SECRET:'fixture-secret',APP_ORIGIN:origin,SESSION_SIGNING_SECRET:secret,CREDENTIAL_ENCRYPTION_KEY:key.toString('base64'),GITHUB_APP_ID:'1',GITHUB_APP_PRIVATE_KEY:privateKey.export({format:'pem',type:'pkcs8'}).toString()},
      artifacts:{SKILL_ARTIFACTS:{namespace:'factorize-skills'}},
      kvNamespaces:['OAUTH_KV'],r2Buckets:['RUN_ARTIFACTS'],hyperdrives:{HYPERDRIVE:address.href},
      serviceBindings:{MAINTENANCE:{name:"factorize",entrypoint:"AgentApiMaintenance"},ASSETS:async request=>{
        const path=new URL(request.url).pathname;
        try {const data=await readFile(resolve('packages/app/dist','.'+path));return new Response(data,{headers:{'Content-Type':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'}});}catch{return new Response('Not found',{status:404});}
      }},
      outboundService:async request=>{
        const target=new URL(request.url);
        if (target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.pathname.startsWith('/git/factorize-skills/')) {
          return fetch(target, {method:request.method, headers:request.headers, body:request.method === 'POST' ? await request.arrayBuffer() : undefined, redirect:'manual'});
        }
        assert.ok(['fixture.upstream.com','api.github.com','github.com','raw.githubusercontent.com','codeload.github.com','api.linear.app','api.openai.com','oidc.fly.io','auth.openai.com','chatgpt.com','exe.dev','ampcode.com','api.clickup.com','api.machines.dev','custom.amp.upstream.com','api.x.com'].includes(target.hostname),'Unexpected upstream '+target.hostname);
        const headers=new Headers(request.headers);headers.set('x-fixture-target',target.href);
        const response=await fetch('http://127.0.0.1:'+upstream.address().port+target.pathname+target.search,{method:request.method,headers,body:request.method==='GET'||request.method==='HEAD'?undefined:await request.arrayBuffer(),redirect:'manual'});
        return new Response(response.body,{status:response.status,headers:response.headers});
      }}));
    await mf.ready;
    worker = await mf.getWorker("factorize");
    const session=Buffer.from(JSON.stringify({tenantId:tenant,userId:user,email:'agent@example.test',exp:Math.floor(Date.now()/1000)+3600,sessionVersion:1})).toString('base64url');
    const cookieValue=encodeURIComponent(session+'.'+createHmac('sha256',secret).update(session).digest('base64'));
    const owner={Cookie:'factorize_session='+cookieValue,Origin:origin};
    const send=(path,method='GET',body,headers={})=>worker.fetch(origin+path,{redirect:"manual",method,headers:{Host:new URL(origin).host,...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    const json=async(path,method,body,headers)=>{const response=await send(path,method,body,{'Content-Type':'application/json',...headers});return {status:response.status,headers:response.headers,body:await response.json()};};
    const form=async(body)=>{const response=await send('/oauth/token','POST',new URLSearchParams(body).toString(),{'Content-Type':'application/x-www-form-urlencoded'});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
    const registration=await json('/oauth/register','POST',{client_name:'Agent fixture',redirect_uris:['http://127.0.0.1/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});assert.equal(registration.status,201);
    const clientId=registration.body.client_id;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({ignoreHTTPSErrors:true});await context.addCookies([{name:'factorize_session',value:cookieValue,domain:'localhost',path:'/',httpOnly:true,secure:true}]);
    await context.route('http://127.0.0.1/callback**',route=>route.fulfill({body:'Done'}));
    const authorize=async(scopes=[],decision='allow',narrow)=>{
      scopes=[...scopes,'proxy:use'];
      const verifier=randomBytes(32).toString('base64url'),query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:'http://127.0.0.1/callback',scope:scopes.join(' '),state:randomUUID(),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:origin+'/mcp'});
      const page=await context.newPage();page.setDefaultTimeout(15000);
      await page.goto(origin+'/authorize?'+query);await page.getByRole('heading',{name:'Authorize Agent fixture',exact:true}).waitFor();
      for (const scope of scopes.filter(scope=>scope.startsWith('integration:'))) assert.ok(await page.getByLabel(scope,{exact:true}).count());
      if(narrow) await page.getByLabel(narrow,{exact:true}).uncheck();
      await page.getByRole('button',{name:decision==='allow'?'Allow':'Deny',exact:true}).click();await page.waitForURL('http://127.0.0.1/callback?**');
      const destination=new URL(page.url());await page.close();
      if(decision==='deny') {assert.equal(destination.searchParams.get('error'),'access_denied');return null;}
      return form({grant_type:'authorization_code',client_id:clientId,code:destination.searchParams.get('code'),redirect_uri:'http://127.0.0.1/callback',code_verifier:verifier,resource:origin+'/mcp'});
    };
    let id=1;
    const rpc=async(token,name,args={},meta)=>{
      const response=await send('/mcp','POST',{jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args,...(meta?{_meta:meta}:{})}},{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',Authorization:'Bearer '+token.access_token});
      const text=await response.text();let messages;
      try {messages=[JSON.parse(text)];}catch{messages=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));}
      return {status:response.status,headers:response.headers,messages,text,result:messages.find(message=>message.id)?.result?.structuredContent};
    };
    const proxy=async(token,path,args)=>{
      const response=await json(path,'POST',args,{Authorization:'Bearer '+token.access_token});
      return {...response,result:response.status===200 ? response.body : undefined,text:JSON.stringify(response.body)};
    };
    const read=(token,args)=>proxy(token,'/api/v1/agent/responses/read',args);
    const request=(token,integration,path='/',extra={})=>proxy(token,'/api/v1/agent/requests',{integration:integration.id,method:'GET',path,...extra});
    const scopes=row=>'integration:'+row.id+':'+row.epoch;
    const first=await authorize(['triggers:read']),second=await authorize(['triggers:read']);
    await rpc(first, 'rename_mcp_client', {name:'Release assistant'});
    const clients = await json('/api/v1/access/authorized-clients','GET',undefined,owner);
    const siblingConnections = clients.body.filter(client => client.clientId === clientId);
    assert.deepEqual(siblingConnections.map(client => client.clientName).sort(), ['Agent fixture','Release assistant']);
    const renamed = siblingConnections.find(client => client.clientName === 'Release assistant');
    const permissionPath = '/api/v1/access/authorizations/' + renamed.grantId + '/permissions';
    assert.equal((await json(permissionPath, 'PUT', {disabledScopes:[], integrationOverrides:{[baseline.id]:false}}, owner)).status, 200);
    assert.equal((await request(first, baseline)).status, 403);
    assert.equal((await request(second, baseline)).status, 200);
    assert.equal((await json(permissionPath, 'PUT', {disabledScopes:[], integrationOverrides:{}}, owner)).status, 200);
    const reflect=await rpc(first,'get_api_reflection');assert.equal(reflect.status,200,reflect.text);assert.equal(reflect.result.integrations.find(row=>row.id===baseline.id).access,'granted');assert.equal(reflect.result.integrations.find(row=>row.id===requestable.id).access,'requestable');
    // A new local agent obtains a single device authorization. Its HTTP client
    // reads the private header file; MCP and shell credentials are never copied.
    const childProgram = `
      import {readFile} from 'node:fs/promises';
      const origin=process.env.FACTORIZE_ORIGIN;
      const response=await fetch(origin+'/mcp',{method:'POST',headers:{
        Authorization:'Bearer '+process.env.FACTORIZE_AGENT_TOKEN,Accept:'application/json, text/event-stream',
        'Content-Type':'application/json','MCP-Protocol-Version':'2025-11-25'
      },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_api_reflection',arguments:{}}})});
      const text=await response.text();
      const payload=text.startsWith('{')?JSON.parse(text):JSON.parse(text.split('\\n').find(line=>line.startsWith('data: ')).slice(6));
      const info=payload.result.structuredContent;
      const authorization=(await readFile(process.env.FACTORIZE_AGENT_AUTH_FILE,'utf8')).trim().slice('Authorization: '.length);
      const proxy=await fetch(info.proxy.requestUrl,{method:'POST',headers:{authorization,'Content-Type':'application/json'},
        body:JSON.stringify({integration:info.integrations.find(row=>row.access==='granted').id,method:'GET',path:'/device-agent'})});
      if (!proxy.ok || (await proxy.json()).body!=='fixture response') process.exit(1);
    `;
    const login=exec(process.execPath,['scripts/agent-login.mjs',process.execPath,'--input-type=module','-e',childProgram],{
      env:{...process.env,FACTORIZE_ORIGIN:origin,NODE_EXTRA_CA_CERTS:directory+'/cert.pem'},timeout:30000
    });
    const code=await Promise.race([new Promise(resolve=>login.child.stderr.on('data',data=>{
      const match=String(data).match(/approve code ([A-Z2-9]{4}-[A-Z2-9]{4})/);if(match) resolve(match[1]);
    })),login.then(()=>{throw new Error('Device login exited before consent');})]);
    const preview=await json('/api/v1/oauth/device/preview','POST',{userCode:code},owner);
    assert.equal(preview.status,200);
    assert.equal((await json('/api/v1/oauth/device/decision','POST',{userCode:code,signature:preview.body.signature,decision:'allow'},owner)).status,200);
    await login;
    const before=observed.length;
    const denied=await request(first,requestable,'/must-not-run',{method:'POST',body:'denied'});assert.equal(denied.status,403,denied.text);assert.match(denied.headers.get('WWW-Authenticate'),/error="insufficient_scope"/);assert.ok(denied.headers.get('WWW-Authenticate').includes(scopes(requestable)));assert.ok(denied.headers.get('WWW-Authenticate').includes('resource_metadata='));assert.equal(observed.length,before);
    const baselineCall=await request(first,baseline,'/items?q=1',{method:'POST',body:'payload',headers:{Authorization:'caller-secret',Cookie:'caller-cookie','X-Forwarded-Host':'hidden','Content-Type':'text/plain'}});assert.equal(baselineCall.result.body,'fixture response');assert.equal(baselineCall.result.status,200);assert.equal(baselineCall.result.headers['set-cookie'],undefined);assert.equal(baselineCall.result.headers.authorization,undefined);assert.equal(observed.at(-1).headers.authorization,'Bearer upstream-private');assert.equal(observed.at(-1).body,'payload');assert.ok(observed.at(-1).target.endsWith('/items?q=1'));assert.equal(observed.at(-1).headers.cookie,undefined);assert.ok(!baselineCall.text.includes('upstream-private'));
    await authorize(['triggers:read',scopes(requestable)],'deny');assert.equal((await request(first,requestable)).status,403);
    const unapproved=await authorize(['triggers:read',scopes(requestable)],'allow',scopes(requestable));assert.equal((await request(unapproved,requestable)).status,403);
    const stepped=await authorize(['triggers:read',scopes(requestable)]);assert.equal((await request(stepped,requestable)).result.status,200);assert.equal((await rpc(stepped,'list_triggers')).status,200);assert.equal((await request(second,requestable)).status,403);
    assert.equal((await request(first,baseline)).result.status,200,'ordinary authorization preserves old connection');
    const refreshed=await form({grant_type:'refresh_token',client_id:clientId,refresh_token:stepped.refresh_token,resource:origin+'/mcp'});assert.equal((await request(refreshed,requestable)).result.status,200);
    assert.equal((await rpc(refreshed,'get_api_reflection')).result.identity.id,(await rpc(stepped,'get_api_reflection')).result.identity.id);
    const narrowed=await form({grant_type:'refresh_token',client_id:clientId,refresh_token:refreshed.refresh_token,scope:'triggers:read proxy:use',resource:origin+'/mcp'});assert.equal((await request(narrowed,requestable)).status,403,'presented token narrowing wins over consent props');
    const policy=async(row,value)=>{const current=(await db.query('SELECT revision FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2',[tenant,row.id])).rows[0];const result=await json('/api/v1/integration-api-policies/'+row.id,'PUT',{policy:value,expectedRevision:current.revision},owner);assert.equal(result.status,200,JSON.stringify(result.body));return result;};
    await policy(requestable,'baseline');assert.equal((await request(first,requestable)).result.status,200);assert.equal((await rpc(first,'get_api_reflection')).result.integrations.find(row=>row.id===requestable.id).access,'granted');
    await policy(requestable,'requestable');assert.equal((await request(first,requestable)).status,403);assert.equal((await request(stepped,requestable)).result.status,200);
    await policy(requestable,'disabled');assert.equal((await request(stepped,requestable)).status,403);await policy(requestable,'requestable');assert.equal((await request(stepped,requestable)).status,403,'disable revokes approvals permanently');
    requestable.epoch=(await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[requestable.id])).rows[0].epoch;
    const fresh=await authorize(['triggers:read',scopes(requestable)]);assert.equal((await request(fresh,requestable)).result.status,200);
    const bom=await request(first,baseline,'/bom');assert.equal(bom.result.body,'\ufeffa');assert.equal(bom.result.size,4);
    const binary=await request(first,baseline,'/binary');assert.equal(binary.result.encoding,'base64');assert.deepEqual(Buffer.from(binary.result.body,'base64'),Buffer.from([0,255,254,1]));
    const failure=await request(first,baseline,'/failure');assert.equal(failure.result.status,422);
    const redirectBefore=observed.length;assert.ok((await request(first,baseline,'/redirect')).text.includes('proxy_failed'));assert.equal(observed.length,redirectBefore+1);
    const large=await request(first,baseline,'/large');assert.equal(large.result.size,1140000,large.text);assert.ok(large.result.handle);assert.equal(large.result.body,undefined);
    const chunk=await read(first,{handle:large.result.handle,offset:1040000});assert.equal(Buffer.from(chunk.result.body,'base64').length,65536);assert.ok(Buffer.from(chunk.result.body,'base64').every(value=>value===255));
    assert.ok((await read(second,{handle:large.result.handle,offset:0})).text.includes('not_found'));
    const mcpRequest=await rpc(first,'request_api',{integration:baseline.id,method:'GET',path:'/'},{progressToken:'fixture-progress'});assert.equal(mcpRequest.result?.status,200,mcpRequest.text);assert.equal(mcpRequest.result.body,'fixture response');assert.ok(!mcpRequest.text.includes('upstream-private'));
    const policies=await json('/api/v1/integration-api-policies','GET',undefined,owner);assert.equal(policies.status,200);
    const otherTenant=randomUUID();await db.query('INSERT INTO app.tenants(id) VALUES($1)',[otherTenant]);
    const foreign=randomUUID();await db.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy) VALUES($1,$2,'bearer','foreign','Foreign',true,'baseline')",[otherTenant,foreign]);assert.equal((await request(first,{id:foreign})).status,403);
    for(const path of ['https://evil.invalid/','//evil.invalid/','/\\evil','/x#fragment']) assert.equal((await request(first,baseline,path)).status,400);
    await db.query("INSERT INTO app.members(tenant_id,user_id,email,role) VALUES($1,$2,'agent@example.test','owner')",[otherTenant,user]);
    const foreignSession=Buffer.from(JSON.stringify({tenantId:otherTenant,userId:user,email:'agent@example.test',exp:Math.floor(Date.now()/1000)+3600,sessionVersion:1})).toString('base64url');
    const foreignCookie=encodeURIComponent(foreignSession+'.'+createHmac('sha256',secret).update(foreignSession).digest('base64'));
    await context.addCookies([{name:'factorize_session',value:foreignCookie,domain:'localhost',path:'/',httpOnly:true,secure:true}]);
    const foreignToken=await authorize(['triggers:read','runs:read','runs:start']);
    assert.ok((await read(foreignToken,{handle:large.result.handle,offset:0})).text.includes('not_found'));
    assert.equal((await json('/api/v1/access/authorizations/'+foreignToken.access_token.split(':')[1],'DELETE',undefined,owner)).status,404);
    await context.addCookies([{name:'factorize_session',value:cookieValue,domain:'localhost',path:'/',httpOnly:true,secure:true}]);
    // Cleanup executes inside workerd with actual R2 storage and PostgreSQL receipts.
    const expired=await request(second,baseline,'/large'),interrupted=await request(second,baseline,'/large');
    const prefixes=(await db.query('SELECT object_key FROM app.agent_proxy_responses WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,[expired.result.handle,interrupted.result.handle]])).rows.map(row=>row.object_key);
    await db.query("UPDATE app.agent_proxy_responses SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenant,[expired.result.handle,interrupted.result.handle]]);
    await db.query('UPDATE app.agent_proxy_responses SET size=NULL WHERE tenant_id=$1 AND id=$2',[tenant,interrupted.result.handle]);
    assert.ok((await read(second,{handle:expired.result.handle,offset:0})).text.includes('not_found'));
    const maintenance=(await mf.getBindings()).MAINTENANCE;assert.equal((await maintenance.fetch('https://maintenance/')).status,200);
    assert.equal((await db.query('SELECT 1 FROM app.agent_proxy_responses WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,[expired.result.handle,interrupted.result.handle]])).rowCount,0);
    const bucket=await mf.getR2Bucket('RUN_ARTIFACTS');for(const prefix of prefixes) assert.equal((await bucket.list({prefix})).objects.length,0);
    // All provider adapters use the same grants and forwarding boundary.
    await db.query("INSERT INTO app.github_installations(installation_id,tenant_id,account_login,account_type,state) VALUES(17,$1,'fixture','Organization','active')",[tenant]);
    await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,'linear',$2)",[tenant,encrypt(JSON.stringify({accessToken:'linear-private',refreshToken:'linear-refresh',accessTokenExpiresAt:new Date(Date.now()-3600000).toISOString()}))]);
    const model=await createIntegration('Model API','model',JSON.stringify({providerUrl:'https://api.openai.com/v1',apiKey:'model-private'}));
    for(const [kind,path,expected,auth] of [['github','/repos/fixture/repo','https://api.github.com/repos/fixture/repo','github-private'],['linear','/graphql','https://api.linear.app/graphql','linear-refreshed'],['model','/responses','https://api.openai.com/v1/responses','model-private']]) {
      const row=(await db.query('SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2',[tenant,kind])).rows[0];await policy(row,'baseline');
      const result=await request(first,row,path);assert.equal(result.result.status,200,result.text);assert.equal(observed.at(-1).target,expected);assert.equal(observed.at(-1).headers.authorization,'Bearer '+auth);
    }
    // Execution and task providers use the same default, consent and revocation rules.
    const extraProviders = [
      {kind:'exe', key:'exe:vm-api', credentialId:'vm-api', value:{apiToken:'exe-private'}, path:'/exec', target:'https://exe.dev/exec', authorization:'Bearer exe-private'},
      {kind:'amp', key:'amp:amp-api', credentialId:'amp-api', value:{accessToken:'amp-private',project:'fixture'}, path:'/projects?q=1', target:'https://ampcode.com/api/cloud/v1/projects?q=1', authorization:'Bearer amp-private'},
      {kind:'amp', key:'amp:custom-api', credentialId:'custom-api', value:{accessToken:'custom-private',project:'fixture',apiBaseUrl:'https://custom.amp.upstream.com/custom/v2'}, path:'/runs', target:'https://custom.amp.upstream.com/custom/v2/runs', authorization:'Bearer custom-private'},
      {kind:'clickup', key:'clickup', credentialId:'clickup', value:{accessToken:'clickup-private'}, path:'/team', target:'https://api.clickup.com/api/v2/team', authorization:'clickup-private'},
      {kind:'fly', credentialId:'fly', path:'/v1/apps?org_slug=fixture', target:'https://api.machines.dev/v1/apps?org_slug=fixture', authorization:'Bearer fly-private'},
    ];
    for (const provider of extraProviders) {
      if (provider.key) await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)",[tenant,provider.key,encrypt(JSON.stringify(provider.value))]);
      else await db.query("INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token) VALUES($1,'fixture','Fixture',$2)",[tenant,encrypt('fly-private')]);
      const row=(await db.query('SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2 AND credential_id=$3',[tenant,provider.kind,provider.credentialId])).rows[0];
      assert.ok(row,provider.kind+' is registered'); assert.equal(row.policy,'requestable');
      const count=observed.length;
      assert.equal((await request(first,row,provider.path)).status,403); assert.equal(observed.length,count,'unapproved calls never reach upstream');
      const approved=await authorize(['triggers:read',scopes(row)]);
      const forwarded=await request(approved,row,provider.path,{method:'POST',body:'fixture command',headers:{Authorization:'caller-secret',Cookie:'private-cookie','Content-Type':'text/plain'}});
      assert.equal(forwarded.result.status,200,forwarded.text); assert.equal(observed.at(-1).target,provider.target); assert.equal(observed.at(-1).headers.authorization,provider.authorization); assert.equal(observed.at(-1).headers.cookie,undefined); assert.equal(observed.at(-1).body,'fixture command');
      assert.ok(!forwarded.text.includes(provider.authorization));
      await policy(row,'baseline'); assert.equal((await request(first,row,provider.path)).result.status,200);
      await policy(row,'disabled'); assert.equal((await request(approved,row,provider.path)).status,403);
      await policy(row,'requestable'); assert.equal((await request(approved,row,provider.path)).status,403,'disable revokes old consent for '+provider.kind);
      await policy(row,'baseline');
      if (provider.kind==='exe') {
        const delegator=await authorize(['vm:grant']);
        const info=(await rpc(delegator,'get_api_reflection')).result;
        assert.equal(info.proxy.requestUrl,origin+'/api/v1/agent/requests');
        assert.equal(info.integrations.find(item=>item.id===row.id).vmGrantProvider,'exe.dev');
        const input={providerIntegrationId:row.id,vm:'external-guest',integrationIds:[baseline.id],idempotencyKey:'create-external-guest'};
        assert.ok(!(await rpc(first,'grant_vm',input)).result,'delegation requires its own scope');
        assert.ok(!(await rpc(delegator,'grant_vm',input)).result,'provider failure leaves enrollment retryable');
        const enrolled=await rpc(delegator,'grant_vm',input);
        assert.ok(enrolled.result?.grantId,enrolled.text);
        const grantId=enrolled.result.grantId;
        assert.equal((await rpc(delegator,'grant_vm',input)).result.grantId,grantId);
        assert.ok(!(await rpc(delegator,'grant_vm',{...input,vm:'another-guest'})).result);
        const guest=(integration,proof=guestProof)=>json('/api/v1/agent/requests','POST',{integration,method:'GET',path:'/guest'},{
          Authorization:'Bearer '+guestJwt,'X-Factorize-VM-Grant':grantId,'X-Factorize-VM-Proof':proof});
        assert.equal((await guest(baseline.id)).body.body,'fixture response');
        assert.equal((await guest(row.id)).status,403,'a baseline provider outside the subset stays unavailable');
        assert.equal((await guest(baseline.id,'0'.repeat(64))).status,401,'a replacement VM lacks the enrollment proof');
        wif.attachments.push('vm:other');
        assert.equal((await guest(baseline.id)).status,401);
        wif.attachments.pop();
        assert.ok(!(await rpc(second,'revoke_vm_grant',{grantId})).result);
        assert.equal((await rpc(delegator,'revoke_vm_grant',{grantId})).result.revoked,true);
        assert.equal((await guest(baseline.id)).status,401,'an unexpired signed token cannot revive a revoked grant');
        assert.equal((await maintenance.fetch('https://maintenance/')).status,200);
        assert.equal(wif,undefined);
        const expiring=(await rpc(delegator,'grant_vm',{...input,idempotencyKey:'expire'})).result;
        await db.query("UPDATE app.vm_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.grantId]);
        const delegatedRequest=id=>json('/api/v1/agent/requests','POST',{integration:baseline.id,method:'GET',path:'/expired'},{
          Authorization:'Bearer '+guestJwt,'X-Factorize-VM-Grant':id,'X-Factorize-VM-Proof':guestProof});
        assert.equal((await delegatedRequest(expiring.grantId)).status,401);
        await maintenance.fetch('https://maintenance/');
        const child=(await rpc(delegator,'grant_vm',{...input,idempotencyKey:'parent-revoked'})).result;
        assert.equal((await delegatedRequest(child.grantId)).status,200);
        assert.equal((await json('/api/v1/access/authorizations/'+delegator.access_token.split(':')[1],'DELETE',undefined,owner)).status,200);
        assert.equal((await delegatedRequest(child.grantId)).status,401);
        await maintenance.fetch('https://maintenance/');
        assert.equal(wif,undefined);
      }
      if (provider.kind==='amp' || provider.kind==='clickup') {
        const beforeEscape=observed.length;
        assert.ok((await request(first,row,'/../outside')).text.includes('credential_unavailable'));
        assert.equal(observed.length,beforeEscape,'configured API prefix cannot be escaped');
      }
      // Token rotation preserves identity; disconnect/reconnect invalidates approvals.
      if(provider.kind==='fly') {
        const before=(await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[row.id])).rows[0].epoch;
        await db.query("UPDATE app.fly_connections SET organization_slug='other',organization_name='Other' WHERE tenant_id=$1",[tenant]);
        assert.equal((await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[row.id])).rows[0].epoch,before+1,'switching Fly organizations revokes prior approvals');
      }
      const epoch=(await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[row.id])).rows[0].epoch;
      if (provider.key) {
        await db.query('UPDATE app.connections SET encrypted_value=$3 WHERE tenant_id=$1 AND kind=$2',[tenant,provider.key,encrypt(JSON.stringify(provider.value))]);
        assert.equal((await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[row.id])).rows[0].epoch,epoch);
        await db.query('DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2',[tenant,provider.key]);
      } else await db.query('DELETE FROM app.fly_connections WHERE tenant_id=$1',[tenant]);
      assert.equal((await request(first,row,provider.path)).status,403);
      const disconnected=(await db.query('SELECT * FROM app.agent_integrations WHERE id=$1',[row.id])).rows[0];
      assert.equal(disconnected.available,false); assert.equal(disconnected.epoch,epoch+1);
    }
    const listed=await json('/api/v1/integration-api-policies','GET',undefined,owner);
    for(const provider of extraProviders) assert.ok(listed.body.integrations.some(row=>row.kind===provider.kind && row.credentialId===provider.credentialId));
    // Inbound webhook signing secrets are never registered as outbound APIs.
    await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,'cloudflare-tail:fixture',$2)",[tenant,encrypt(JSON.stringify({signingSecret:'tail-private'}))]);
    assert.equal((await db.query("SELECT 1 FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id='fixture'",[tenant])).rowCount,0);
    // X uses the same client policies while retaining upstream OAuth scope restrictions.
    const xId=randomUUID();
    const xCredential={clientSecret:'x-client-private',accessToken:'x-private',refreshToken:'x-refresh',expiresAt:new Date(Date.now()+3600000).toISOString()};
    await db.query("INSERT INTO app.x_connections(tenant_id,id,name,client_id,scopes,encrypted_secret,status,account_id,account_handle,granted_scopes) VALUES($1,$2,'Social account','fixture',ARRAY['users.read','tweet.read','offline.access'],$3,'connected','123','fixture',ARRAY['users.read','tweet.read','offline.access'])",[tenant,xId,encrypt(JSON.stringify(xCredential))]);
    const xRow=(await db.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='x' AND credential_id=$2",[tenant,xId])).rows[0];
    assert.equal(xRow.available,true);assert.equal((await request(first,xRow,'/2/users/me')).status,403);
    const xApproved=await authorize(['triggers:read',scopes(xRow)]);
    assert.equal((await request(xApproved,xRow,'/2/users/me')).result.status,200);assert.equal(observed.at(-1).target,'https://api.x.com/2/users/me');assert.equal(observed.at(-1).headers.authorization,'Bearer x-private');
    const xCount=observed.length;
    const xWrite=await request(xApproved,xRow,'/2/tweets',{method:'POST',body:'{}'});
    assert.equal(xWrite.result,undefined,'MCP consent cannot expand X OAuth scopes');assert.match(xWrite.text,/This X connection does not grant tweet.write/);
    const xManagement=await request(xApproved,xRow,'/2/oauth2/token',{method:'POST',body:'{}'});
    assert.equal(xManagement.result,undefined,'credential management is not proxyable');assert.match(xManagement.text,/not authorized/);assert.equal(observed.length,xCount);
    await policy(xRow,'baseline');assert.equal((await request(first,xRow,'/2/users/me')).result.status,200);
    await policy(xRow,'disabled');assert.equal((await request(xApproved,xRow,'/2/users/me')).status,403);
    await policy(xRow,'requestable');assert.equal((await request(xApproved,xRow,'/2/users/me')).status,403);
    const oldEpoch=(await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[xRow.id])).rows[0].epoch;
    await db.query("UPDATE app.x_connections SET status='reconnect_required',credential_version=credential_version+1 WHERE tenant_id=$1 AND id=$2",[tenant,xId]);
    assert.equal((await db.query('SELECT epoch FROM app.agent_integrations WHERE id=$1',[xRow.id])).rows[0].epoch,oldEpoch+1);
    await db.query("UPDATE app.x_connections SET status='connected' WHERE tenant_id=$1 AND id=$2",[tenant,xId]);
    assert.equal((await request(xApproved,xRow,'/2/users/me')).status,403,'replacing X credentials invalidates old MCP approval');
    // Restore a baseline entry for run-selection isolation checks below.
    await policy(xRow,'baseline');
    const github=(await db.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='github'",[tenant])).rows[0];
    for(const [path,target] of [['/owner/repo.git/info/refs','https://github.com/owner/repo.git/info/refs'],['/raw/owner/repo/main/file','https://raw.githubusercontent.com/owner/repo/main/file'],['/archive/owner/repo/zip/main','https://codeload.github.com/owner/repo/zip/main']]) {
      assert.equal((await request(first,github,path)).result.status,200);assert.equal(observed.at(-1).target,target);
      if(path.includes('info/refs')) assert.equal(observed.at(-1).headers.authorization,'Basic '+Buffer.from('x-access-token:github-private').toString('base64'));
    }
    assert.ok(observed.some(row=>row.target==='https://api.linear.app/oauth/token'));
    // Verified Fly OIDC reaches the same service using an immutable run snapshot.
    const runId=randomUUID(),triggerId=randomUUID(),invocationId=randomUUID(),now=Math.floor(Date.now()/1000);
    await db.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES($1,$2,'fixture','fixture','cipher','{}',1)",[tenant,triggerId]);
    await db.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug) VALUES($1,gen_random_uuid(),$2,'manual','manual')",[tenant,triggerId]);
    await db.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,context,event_id) VALUES($1,$2,$3,'manual','fixture','{}',(SELECT id FROM app.events WHERE tenant_id=$1 AND trigger_id=$3))",[tenant,invocationId,triggerId]);
    await db.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt) VALUES($1,$2,$3,$4,'running','cipher')",[tenant,runId,triggerId,invocationId]);
    await db.query("INSERT INTO app.runs(tenant_id,id,trigger_id,invocation_id,provider,issue_id,agent_name,state,execution_config,execution_handle) VALUES($1,$2,$3,$4,'manual','fixture','codex','running',$5,$6)",[tenant,runId,triggerId,invocationId,{portableIntegrationIds:[baseline.credential_id]},{id:'fixture-app/machine'}]);
    await db.query("INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token) VALUES($1,'fixture','Fixture','cipher')",[tenant]);
    await db.query("INSERT INTO app.run_authorizations(tenant_id,run_id,user_id,session_version,scopes) VALUES($1,$2,$3,1,'[]')",[tenant,runId,user]);
    const subject='fixture:fixture-app:machine';
    await db.query("INSERT INTO app.vendor_run_identity_bindings(tenant_id,run_id,provider,vm_id,issuer,subject,audience,issued_at,expires_at) VALUES($1,$2,'fly.io','machine','https://oidc.fly.io/fixture',$3,$4,now(),now()+interval '1 hour')",[tenant,runId,subject,origin]);
    const runHeaders={'X-Factorize-Run-Id':runId,Authorization:'Bearer '+jwt({machine_id:'machine',iss:'https://oidc.fly.io/fixture',sub:subject,aud:origin,iat:now,exp:now+300})};
    const runResponse=await send('/api/v1/agent/reflection','GET',undefined,runHeaders);assert.equal(runResponse.status,200,await runResponse.clone().text());assert.equal((await runResponse.json()).integrations.length,1);
    const nestedRequest={script:'echo Background review'};
    assert.equal((await json('/api/v1/runs','POST',nestedRequest,runHeaders)).status,403);
    await db.query("UPDATE app.run_authorizations SET scopes=$3 WHERE tenant_id=$1 AND run_id=$2",[tenant,runId,JSON.stringify(['runs:start'])]);
    const nestedTarget=randomUUID();
    await db.query('INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)',[tenant,'exe:'+nestedTarget,encrypt(JSON.stringify({agentKind:'codex',connectionId:nestedTarget}))]);
    assert.equal((await json('/api/v1/team/run-defaults','PUT',{executionConfigId:nestedTarget,requiresVm:true},owner)).status,200);
    assert.equal((await json('/api/v1/runs','POST',{...nestedRequest,projectId:randomUUID()},runHeaders)).status,400);
    const child=await json('/api/v1/runs','POST',nestedRequest,runHeaders);
    assert.ok(child.body.runId,JSON.stringify(child.body));
    const childRow=(await db.query('SELECT r.project_id,i.source_run_id,a.scopes FROM app.runs r JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id JOIN app.run_authorizations a ON a.tenant_id=r.tenant_id AND a.run_id=r.id WHERE r.tenant_id=$1 AND r.id=$2',[tenant,child.body.runId])).rows[0];
    assert.deepEqual(childRow,{project_id:null,source_run_id:runId,scopes:[]});
    assert.equal((await json('/api/v1/runs/'+child.body.runId+'/stop','POST',{},owner)).status,200);
    const stream=await send('/internal/run-proxy/'+runId+'/integrations/'+baseline.credential_id+'/stream','GET',undefined,runHeaders);assert.equal(stream.status,200);
    const streamReader=stream.body.getReader();assert.match(new TextDecoder().decode((await streamReader.read()).value),/first/);releaseStream();assert.match(new TextDecoder().decode((await streamReader.read()).value),/last/);
    assert.equal((await send('/internal/run-proxy/'+runId+'/integrations/'+requestable.credential_id+'/','GET',undefined,runHeaders)).status,403);
    assert.equal((await send('/api/v1/agent/reflection','GET',undefined,{...runHeaders,Authorization:'Bearer '+first.access_token})).status,401,'invalid vendor identity cannot fall back to OAuth');
    await db.query("UPDATE app.triggers SET execution_config=$3 WHERE tenant_id=$1 AND id=$2",[tenant,triggerId,{portableIntegrationIds:[baseline.credential_id,requestable.credential_id]}]);
    assert.equal((await send('/internal/run-proxy/'+runId+'/integrations/'+requestable.credential_id+'/','GET',undefined,runHeaders)).status,403,'trigger edits cannot expand the run snapshot');
    await db.query("UPDATE app.integration_records SET deleted_at=now(),encrypted_payload=NULL WHERE tenant_id=$1 AND id=$2",[tenant,baseline.credential_id]);
    await db.query("UPDATE app.integration_records SET deleted_at=NULL,encrypted_payload=$3 WHERE tenant_id=$1 AND id=$2",[tenant,baseline.credential_id,encrypt('factorize-managed-bearer-v1:upstream-private')]);
    assert.equal((await send('/internal/run-proxy/'+runId+'/integrations/'+baseline.credential_id+'/','GET',undefined,runHeaders)).status,403,'run disconnect revocation survives reconnect');
    assert.equal((await read(first,{handle:large.result.handle,offset:0})).status,403,'retained responses cannot cross a disconnect epoch');
    await db.query("UPDATE app.trigger_runs SET state='stopped' WHERE tenant_id=$1 AND id=$2",[tenant,runId]);assert.equal((await send('/internal/run-proxy/'+runId+'/integrations/'+baseline.credential_id+'/','GET',undefined,runHeaders)).status,403);
    await policy(baseline,'requestable');assert.equal((await request(first,baseline)).status,403);assert.equal((await read(first,{handle:large.result.handle,offset:0})).status,403,'reads require current grants');await policy(baseline,'baseline');
    const grantId=first.access_token.split(':')[1];assert.equal((await json('/api/v1/access/authorizations/'+grantId,'DELETE',undefined,owner)).status,200);assert.equal((await request(first,baseline)).status,401);assert.equal((await read(first,{handle:large.result.handle,offset:0})).status,401);assert.equal((await request(second,baseline)).result.status,200);
    await t.test("background a skill and deliver its outcome to the originating idle session",()=>backgroundRunAcceptance({db,tenant,encrypt,json,owner,rpc,authorize,worker,origin,maintenance,foreignToken,readOnly:second}));
    await context.close();
  } finally {
    releaseStream?.();await browser?.close();if(site) await new Promise(resolve=>site.close(resolve));await mf?.dispose();if(upstream) await new Promise(resolve=>upstream.close(resolve));await db?.end();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true});
  }
});

import { DEFAULT_RUN_SCOPES } from "../src/run-scopes";
import { submitRun } from "../src/postgres/run-submission";
import { encrypt } from "../src/crypto";
import {expect,it,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,randomUUID} from "node:crypto";
import {readFile,readdir,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import worker from "../src/worker";
import {Database} from "../src/postgres/database";
import {IdentityRepository} from "../src/postgres/identity-repository";
import {FlyConnectionRepository} from "../src/postgres/fly-connection-repository";
import {signSession} from "../src/session";
import {FlyTriggerExecutionBackend} from "../src/fly-job-execution-backend";
import {createLocalExecutionRunner} from "../src/local-execution-runner";
import {createLocalArtifactStorage} from "../src/local-execution-storage";
import {startLocalApiServer} from "../src/local-api-server";
import {createDockerTriggerInfrastructure} from "./helpers/docker-job-infrastructure";
import type {Env} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class{},getOAuthApi:()=>({})}));
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",timeout:30_000,maxBuffer:1024*1024}).trim();
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// Signed provider fixtures exercise the production verifier, helper, backend and
// scheduler. They are test-local, and do not constitute live Fly verification.
it("continues historical script runs through vendor identity, selected backend egress, artifacts and cleanup",async()=>{
  const url=process.env.AUTH_TEST_DATABASE_URL!,tls=process.env.FACTORIZE_E2E_TLS_DIR!,namespace=process.env.FACTORIZE_E2E_NAMESPACE!;
  if(!url||!tls||!namespace)throw new Error("Use npm run test:docker");
  const databaseName=process.env.FACTORIZE_E2E_DATABASE!;
  if(!/^docker_e2e_[a-f0-9]{32}$/.test(databaseName))throw new Error("Invalid isolated database");
  const admin=new Database({connectionString:url}),address=new URL(url);address.pathname="/"+databaseName;
  const db=new Database({connectionString:address.href}),storage=await mkdtemp(join(tmpdir(),"factorize-artifacts-"));
  const tenantId=randomUUID(),userId=randomUUID(),marker=randomUUID(),secret="synthetic-"+randomUUID(),integrationId=randomUUID(),unselectedId=randomUUID();
  const app=namespace+"-triggers",org="factorize-fixture",issuer="https://oidc.fly.io/"+org,network=namespace+"-triggers";
  const pair=generateKeyPairSync("rsa",{modulusLength:2048}),jwk={...pair.publicKey.export({format:"jwk"}),kid:"docker-fixture",alg:"RS256",use:"sig"};
  const originalFetch=globalThis.fetch,receipts:unknown[]=[];
  let created=false,api:Awaited<ReturnType<typeof startLocalApiServer>>|undefined,runner:ReturnType<typeof createLocalExecutionRunner>|undefined;
  let destructionEvidence:unknown;
  try{
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);created=true;
    const migrations=new URL("../migrations/",import.meta.url);
    for(const file of(await readdir(migrations)).filter(f=>f.endsWith(".sql")).sort())await db.pool.query(await readFile(new URL(file,migrations),"utf8"));
    await new IdentityRepository(db,tenantId).upsertOwner(userId,"docker-owner@example.test");
    docker("network","create",network);
    const env={DATABASE:db,APP_ORIGIN:"",CREDENTIAL_ENCRYPTION_KEY:btoa("a".repeat(32)),SESSION_SIGNING_SECRET:randomUUID(),TEST_DOCKER_EXECUTION:{enabled:true,image:process.env.FACTORIZE_E2E_JOB_IMAGE!},RUN_ARTIFACTS:createLocalArtifactStorage(storage)} as Env;
    await new FlyConnectionRepository(db,tenantId,env.CREDENTIAL_ENCRYPTION_KEY).save({organizationSlug:org,organizationName:"Fixture"},"fixture-control-token");
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      const target=String(input instanceof Request?input.url:input);
      if(target===issuer+"/.well-known/openid-configuration")return Response.json({issuer,jwks_uri:issuer+"/jwks"});
      if(target===issuer+"/jwks")return Response.json({keys:[jwk]});
      if(target.startsWith("https://fixture-upstream.example.com/")){
        const headers=new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer "+secret);
        expect(headers.has("X-Factorize-Run-Id")).toBe(false);
        const body=await new Response(init?.body).text();receipts.push({path:new URL(target).pathname,body});
        return Response.json({marker});
      }
      return originalFetch(input,init);
    });
    api=await startLocalApiServer({key:await readFile(join(tls,"server.key")),cert:await readFile(join(tls,"server.crt")),fetch:request=>worker.fetch(request,env,{waitUntil(){}} as any)});
    env.APP_ORIGIN=`https://${process.env.FACTORIZE_E2E_HOST_IP}:${api.port}`;
    const member=await new IdentityRepository(db,tenantId).member(userId);
    const cookie="factorize_session="+await signSession({tenantId,userId,email:"docker-owner@example.test",sessionVersion:member!.sessionVersion,exp:Math.floor(Date.now()/1000)+600},env.SESSION_SIGNING_SECRET);
    const request=(path:string,method="GET",body?:unknown)=>originalFetch(env.APP_ORIGIN+"/api/v1"+path,{method,headers:{Cookie:cookie,Origin:env.APP_ORIGIN,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const json=async(path:string,method="GET",body?:unknown)=>{const r=await request(path,method,body),v=await r.json() as any;if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(v)}`);return v;};
    for(const [index,id] of[integrationId,unselectedId].entries())await json("/integrations/bearer","POST",{id,expectedRevision:index,idempotencyKey:randomUUID(),name:"Fixture "+index,origin:"https://fixture-upstream.example.com",description:null,token:secret});
    const script=`#!/bin/bash
set -eu
node --input-type=module <<'JS'
import fs from 'node:fs';
const base=process.env.FACTORIZE_PROXY_URL;
const list=await(await fetch(base+'/integrations')).json();
if(list.integrations.length!==1||list.integrations[0].id!==${JSON.stringify(integrationId)})throw new Error('selection mismatch');
const r=await fetch(base+'/integrations/${integrationId}/echo/${marker}',{method:'POST',body:${JSON.stringify(marker)}});
if(!r.ok||(await r.json()).marker!==${JSON.stringify(marker)})throw new Error('egress failed');
console.log('executed:${marker}');
while(!fs.existsSync('/tmp/finish-test'))await new Promise(r=>setTimeout(r,100));
fs.writeFileSync(process.env.FACTORIZE_RESULT_PATH,JSON.stringify({status:'succeeded',outputs:{marker:${JSON.stringify(marker)}}}));
JS
`;
    const retired=await request("/triggers","POST",{name:"docker-code",executionType:"code",script,executionConfigId:"docker"});expect(retired.status).toBe(400);
    const trigger=await json("/triggers","POST",{name:"docker-history",prompt:"Historical compatibility fixture",events:[{kind:"manual",slug:"event-1",config:{}}]});
    // Seed a run accepted before script retirement. Its execution and cleanup
    // must remain compatible even though no public API can create another one.
    const runId=randomUUID(),invocationId=randomUUID();
    await db.transaction(async client=>{
      const event=(await client.query("SELECT id FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 LIMIT 1",[tenantId,trigger.id])).rows[0];
      await client.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context) VALUES($1,$2,$3,'manual','historical',$4,'{}')",[tenantId,invocationId,trigger.id,event.id]);
      await submitRun(client,tenantId,{id:runId,triggerId:trigger.id,invocationId,name:"Historical Docker run",source:"manual",claim:"historical",workspaceName:"",createdAt:new Date().toISOString(),encryptedPrompt:await encrypt("",env.CREDENTIAL_ENCRYPTION_KEY),config:{targetId:"docker",connectionId:"docker",workspace:"",cwd:"",agentKind:"code",tags:[],requiresVm:true,executionProvider:"docker",image:env.TEST_DOCKER_EXECUTION!.image,executionType:"code",script,portableIntegrationIds:[integrationId],modelAccess:"native",runScopes:[...DEFAULT_RUN_SCOPES],inputContext:{}}});
    });
    const infrastructure=createDockerTriggerInfrastructure({testMode:true,namespace:app,network,beforeDestroy:async id=>{
      const r=(await db.pool.query("SELECT trigger_result,artifact_state FROM app.runs WHERE tenant_id=$1 AND id=$2",[tenantId,runId])).rows[0];destructionEvidence={marker:r.trigger_result?.outputs?.marker,artifactState:r.artifact_state};
    }});
    const guests=new Map<string,ReturnType<typeof infrastructure.guest>>();
    const guest=(id:string)=>{
      let saved=guests.get(id);if(saved)return saved;
      const raw=infrastructure.guest(id);let initialized:Promise<void>|undefined;
      const prepare=()=>initialized??=(async()=>{
        await raw.upload!("/tmp/fixture-ca.crt",new Uint8Array(await readFile(join(tls,"ca.crt"))));
        // This signing key exists only inside this isolated fixture. Production
        // trusts Fly's JWKS; it cannot accept this test issuer key.
        const machine = await infrastructure.machines.inspectMachine(app, id);
        const source=`const http=require('node:http'),crypto=require('node:crypto');const key=${JSON.stringify(pair.privateKey.export({type:"pkcs8",format:"pem"}).toString())};require('node:fs').mkdirSync('/.fly',{recursive:true});http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const now=Math.floor(Date.now()/1000),h=Buffer.from(JSON.stringify({alg:'RS256',kid:'docker-fixture'})).toString('base64url'),p=Buffer.from(JSON.stringify({iss:${JSON.stringify(issuer)},sub:${JSON.stringify(org+":"+app+":"+machine.name)},aud:JSON.parse(body).aud,machine_id:${JSON.stringify(id)},iat:now,exp:now+120})).toString('base64url'),data=h+'.'+p;res.end(data+'.'+crypto.sign('RSA-SHA256',Buffer.from(data),key).toString('base64url'));});}).listen('/.fly/api');`;
        await raw.upload!("/tmp/vendor-fixture.cjs",new TextEncoder().encode(source));
        const started=await raw.run(["sh","-c","nohup node /tmp/vendor-fixture.cjs >/tmp/vendor-fixture.log 2>&1 </dev/null & sleep 0.3"]);expect(started.ok).toBe(true);
      })();
      saved={...raw,run:async(command,input)=>{await prepare();return raw.run(["env","NODE_EXTRA_CA_CERTS=/tmp/fixture-ca.crt",...command],input);}};guests.set(id,saved);return saved;
    };
    const backend=new FlyTriggerExecutionBackend({app,organizationSlug:org,image:process.env.FACTORIZE_E2E_JOB_IMAGE!,region:"iad",size:"shared-cpu-1x",machines:infrastructure.machines,guest:machine=>guest(machine.id)});
    runner=createLocalExecutionRunner(db,env,async()=>backend);
    await runner.tick();
    const row=(await db.pool.query("SELECT execution_handle,execution_diagnostics FROM app.runs WHERE tenant_id=$1 AND id=$2",[tenantId,runId])).rows[0];
    expect(row.execution_diagnostics?.state,JSON.stringify(row.execution_diagnostics)).not.toBe("failed");
    expect(row.execution_handle.backendKind).toBe("fly");
    const id=row.execution_handle.id.split("/")[1],raw=infrastructure.guest(id);
    const deadline=Date.now()+15_000;while(receipts.length===0&&Date.now()<deadline)await wait(100);
    expect(receipts).toEqual([{path:`/echo/${marker}`,body:marker}]);
    const probe=async(path:string)=>(await raw.run(["runuser","-u","exedev","--","node","-e",`fetch('http://127.0.0.1:18180${path}').then(r=>console.log(r.status))`])).stdout.trim();
    expect(await probe(`/integrations/${unselectedId}/echo/no`)).toBe("403");
    expect(await probe("/api/v1/triggers")).toBe("200");
    await json(`/integrations/bearer/${integrationId}`,"DELETE",{expectedRevision:2,idempotencyKey:randomUUID()});
    expect(await probe(`/integrations/${integrationId}/echo/no`)).toBe("403");
    expect(receipts).toHaveLength(1);
    const surfaces=await raw.run(["sh","-c","cat /run/factorize-identity/config.json; cat /home/exedev/.factorize-trigger/launch.json 2>/dev/null || true"]);
    expect(surfaces.stdout).not.toContain(secret);expect(surfaces.stdout).not.toMatch(/fzt_run_|fzc_/);
    await raw.run(["touch","/tmp/finish-test"]);
    let terminal:any;
    const end=Date.now()+60_000;while(Date.now()<end){await runner.tick();terminal=(await db.pool.query("SELECT state,artifact_state,trigger_result FROM app.runs WHERE tenant_id=$1 AND id=$2",[tenantId,runId])).rows[0];if(["succeeded","failed","stopped"].includes(terminal.state))break;await wait(200);}
    expect(terminal).toMatchObject({state:"succeeded",artifact_state:"stored",trigger_result:{outputs:{marker}}});
    expect(destructionEvidence).toMatchObject({marker});
    expect(docker("ps","-aq","--filter",`id=${id}`)).toBe("");
    const artifacts=(await db.pool.query("SELECT object_key FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows;expect(artifacts.length).toBeGreaterThan(0);
    for(const artifact of artifacts){const object=await env.RUN_ARTIFACTS!.get(artifact.object_key);expect(await object!.text()).not.toContain(secret);}

    const directScript=`#!/bin/bash
set -eu
printf '%s' '{"status":"succeeded","outputs":{"mode":"direct"}}' > "$FACTORIZE_RESULT_PATH"
`;
    expect((await request("/runs","POST",{script:directScript,executionConfigId:"docker"})).status).toBe(400);
    const direct={runId:randomUUID()},directInvocation=randomUUID();
    await db.transaction(async client=>{
      await client.query("INSERT INTO app.invocations(tenant_id,id,source,claim_key,context) VALUES($1,$2,'direct','historical-direct','{}')",[tenantId,directInvocation]);
      await submitRun(client,tenantId,{id:direct.runId,triggerId:null,invocationId:directInvocation,name:"Historical direct script",source:"direct",claim:"historical-direct",workspaceName:"",createdAt:new Date().toISOString(),encryptedPrompt:await encrypt("",env.CREDENTIAL_ENCRYPTION_KEY),config:{targetId:"docker",connectionId:"docker",workspace:"",cwd:"",agentKind:"code",tags:[],requiresVm:true,executionProvider:"docker",image:env.TEST_DOCKER_EXECUTION!.image,executionType:"code",script:directScript,portableIntegrationIds:[],modelAccess:"native",runScopes:[],inputContext:{}}});
    });
    let directRun;
    const directDeadline = Date.now() + 60_000;
    do {
      await runner.tick();
      directRun = (await db.pool.query("SELECT trigger_id,state,trigger_result,failure_reason FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId,direct.runId])).rows[0];
      if (["succeeded", "failed", "stopped"].includes(directRun.state)) break;
      await wait(200);
    } while (Date.now() < directDeadline);
    expect(directRun, directRun.failure_reason).toMatchObject({trigger_id: null, state: "succeeded", trigger_result: {outputs: {mode: "direct"}}});
  }finally{
    await runner?.close();await api?.close();vi.unstubAllGlobals();
    for(const id of docker("ps","-aq","--filter",`label=sh.factorize.test.namespace=${app}`).split("\n").filter(Boolean))docker("rm","-f",id);
    try{docker("network","rm",network);}catch{}
    await db.close();if(created)await admin.pool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);await admin.close();await rm(storage,{recursive:true,force:true});
  }
},120_000);

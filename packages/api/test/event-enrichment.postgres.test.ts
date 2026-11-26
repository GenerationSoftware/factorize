import { expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { CredentialRepository } from "../src/postgres/credential-repository";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers",()=>({ WorkerEntrypoint:class {}, WorkflowEntrypoint:class {}, DurableObject:class {} }));
vi.mock("@cloudflare/workers-oauth-provider",()=>({ OAuthProvider:class {},AuthorizationError:class Error {},getOAuthApi:vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
it.skipIf(!url)("runs an opted-in Event rule once through REST/MCP, retains safe evaluation evidence, and rechecks authority",async()=>{
  const f=await loadingFixture(url!);
  try {
    const repository=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY),credentialId=crypto.randomUUID();
    await repository.write({id:credentialId,kind:"bearer",name:"GitHub CI fixture",description:null,origin:"https://api.github.com",
      expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"private-fixture-token"});
    const integration=(await f.db.pool.query<{id:string;epoch:number}>("SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id=$2",
      [f.tenantId,credentialId])).rows[0];
    const scopes=["triggers:read","triggers:write","proxy:use","integration:"+integration.id+":"+integration.epoch];
    const auth={...f.auth,authMethod:"oauth" as const,oauthGrantId:"fixture-enrichment-grant",oauthClientId:"fixture-enrichment-client",
      oauthExpiresAt:Date.now()/1000+600,scopes,explicitIntegrationScopes:true};
    let active=true;
    f.env.OAUTH_PROVIDER={listUserGrants:vi.fn(async()=>({items:active?[{id:auth.oauthGrantId,userId:auth.userId,clientId:auth.oauthClientId,
      metadata:{tenantId:f.tenantId},scope:scopes}]:[]}))} as unknown as NonNullable<typeof f.env.OAUTH_PROVIDER>;
    const api=(method:string,path:string,body?:unknown,identity=auth)=> protectedApiFetch(new Request(f.env.APP_ORIGIN+path,{
      method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)
    }),f.env,identity,{} as ExecutionContext);

    const config={extraDataUrls:[
      {name:"pr",integration:integration.id,method:"GET",path:"/repos/acme/repo/pulls/{{input.pr}}"},
      {name:"checks",integration:integration.id,method:"GET",path:"/repos/acme/repo/commits/{{lookups.pr.head.sha}}/check-runs"},
    ],rule:"lookups.pr.state == 'open' && lookups.pr.draft == `false` && lookups.pr.base.ref == 'main' && lookups.pr.head.sha == input.sha && lookups.checks.head_sha == input.sha && length(lookups.checks.required) > `0` && length(lookups.checks.required[?conclusion != 'success']) == `0`"};
    const rejected = await api("POST","/api/v1/events",{name:"invalid-event",enrichment:{...config,
      extraDataUrls:[{...config.extraDataUrls[0],path:"https://outside.example.test/"}]}});
    expect(rejected.status).toBe(400);
    expect((await api("POST","/api/v1/events",{name:"unapproved-event",enrichment:config},{...auth,scopes:scopes.slice(0,3)})).status).toBe(403);
    const created=await api("POST","/api/v1/events",{name:"ci-ready",enrichment:config});
    expect(created.status,await created.clone().text()).toBe(201);
    const event=await created.json() as {id:string;enrichment:unknown;evaluatorAuthority?:unknown};
    expect(event.enrichment).toEqual(config);
    expect(event.evaluatorAuthority).toBeUndefined();
    const createdTrigger=await api("POST","/api/v1/triggers",{name:"ci-signal",eventId:event.id,inputMapping:{pr:"number",sha:"head.sha"},
      sources:[{kind:"manual",slug:"manual",enabled:true,config:{}}]});
    expect(createdTrigger.status,await createdTrigger.clone().text()).toBe(201);
    const trigger=await createdTrigger.json() as {id:string};

    let currentSha="good-sha", fail=false,revokeAfterFirst=false, calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async (value:URL|string,init:RequestInit)=>{
      const target=new URL(value);
      expect(target.origin).toBe("https://api.github.com");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer private-fixture-token");
      calls.push(target.pathname);
      if(target.pathname.includes("/pulls/")) {
        if(revokeAfterFirst) active=false;
        return Response.json({state:"open",draft:false,base:{ref:"main"},head:{sha:currentSha},privateDetail:"provider-fixture-secret"});
      }
      return fail ? new Response("provider-fixture-secret",{status:503}) :
        Response.json({head_sha:currentSha,required:[{name:"build",conclusion:"success"},{name:"test",conclusion:"success"}],privateDetail:"provider-fixture-secret"});
    }));
    const rpc=mcpRequest(f.env,auth);
    const fire=async(key:string,sha="good-sha",number: string|number=42)=>{
      const response=await rpc("tools/call",{name:"fire_trigger",arguments:{triggerId:trigger.id,idempotencyKey:key,data:{
        number,head:{sha},internal:"unmapped-fixture-secret"
      }}});
      expect(response.message.result?.isError,JSON.stringify(response)).not.toBe(true);
      return response.message.result.structuredContent as {occurrenceId:string|null;duplicate:boolean;evaluationId?:string};
    };
    const [fired, duplicate]=await Promise.all([fire("once"),fire("once")]);
    expect(fired.occurrenceId).toBeTruthy();
    expect(duplicate.occurrenceId).toBe(fired.occurrenceId);
    expect([fired,duplicate].filter(reply=>reply.duplicate)).toHaveLength(1);
    expect(calls).toEqual(["/repos/acme/repo/pulls/42","/repos/acme/repo/commits/good-sha/check-runs"]);
    expect((await f.db.pool.query("SELECT payload FROM app.event_occurrences WHERE tenant_id=$1",[f.tenantId])).rows)
      .toEqual([{payload:{pr:42,sha:"good-sha"}}]);
    currentSha="other-sha"; expect((await fire("stale")).occurrenceId).toBeNull();
    fail=true; expect((await fire("failed")).occurrenceId).toBeNull();
    const beforeInvalid=calls.length;
    expect((await fire("bad-input","good-sha","not/an/id")).occurrenceId).toBeNull();
    expect(calls).toHaveLength(beforeInvalid);
    revokeAfterFirst=true;
    expect((await fire("revoked")).occurrenceId).toBeNull();
    expect(calls).toHaveLength(beforeInvalid+1);
    expect((await fire("revoked")).duplicate).toBe(true);
    expect(calls).toHaveLength(beforeInvalid+1);
    const diagnostics=await api("GET","/api/v1/events/"+event.id+"/evaluations");
    expect(diagnostics.status).toBe(200);
    const logged=await diagnostics.text();
    expect(logged).not.toMatch(/provider-fixture-secret|unmapped-fixture-secret|private-fixture-token/);
    expect(JSON.parse(logged)).toEqual(expect.arrayContaining([
      expect.objectContaining({state:"excluded",stage:"rule",reason:"rule_did_not_match",input:{pr:42,sha:"good-sha"}}),
      expect.objectContaining({state:"failed",stage:"checks",reason:"lookup_http_failure",steps:[{name:"pr",outcome:"ok",status:200},{name:"checks",outcome:"failed",status:503}]}),
      expect.objectContaining({state:"failed",stage:"checks",reason:"authority_unavailable"}),
    ]));
  } finally {vi.unstubAllGlobals();await f.cleanup();}
});

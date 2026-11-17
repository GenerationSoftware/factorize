import {describe,expect,it,vi,afterEach} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {modelDeviceAuthorization,ModelAccountUnavailable} from "../src/model-device-auth";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class{},getOAuthApi:vi.fn()}));
const url=process.env.AUTH_TEST_DATABASE_URL;
afterEach(()=>vi.unstubAllGlobals());
describe.skipIf(!url)("server managed model device authorization",{timeout:60_000},()=>{
  async function fixture(){const f=await loadingFixture(url!),id=crypto.randomUUID(),repo=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);await repo.write({id,kind:"model",name:"ChatGPT",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:"{}"});return{...f,id,repo,call:(action:"authorize"|"status"|"cancel")=>modelDeviceAuthorization(f.env,f.auth,id,action),due:()=>f.db.pool.query("UPDATE app.model_device_authorizations SET next_poll_at=now()-interval '1 second' WHERE tenant_id=$1",[f.tenantId])};}
  it("keeps private challenges encrypted, throttles polling, verifies PKCE and stores tokens without returning them",async()=>{
    const f=await fixture();try{
      const verifier="fixture-verifier",digest=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))).toString("base64url");
      const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
        expect(init?.redirect).toBe("error");
        if(String(input).endsWith("/usercode"))return Response.json({device_auth_id:"private-device-id",user_code:"PUBLIC-CODE",interval:1});
        if(String(input).endsWith("/deviceauth/token"))return Response.json({authorization_code:"private-code",code_verifier:verifier,code_challenge:digest});
        expect(String(input)).toBe("https://auth.openai.com/oauth/token");
        expect(new URLSearchParams(String(init?.body)).get("code_verifier")).toBe(verifier);
        return Response.json({access_token:"private-access",refresh_token:"private-refresh",id_token:"private-id"});
      });vi.stubGlobal("fetch",fetcher);
      const pending=await f.call("authorize");expect(pending).toMatchObject({state:"pending",userCode:"PUBLIC-CODE",verificationUrl:"https://auth.openai.com/codex/device"});
      expect(await f.call("authorize")).toEqual(pending);expect(await f.call("status")).toEqual(pending);expect(fetcher).toHaveBeenCalledTimes(1);
      const stored=(await f.db.pool.query("SELECT encrypted_payload FROM app.model_device_authorizations WHERE tenant_id=$1",[f.tenantId])).rows[0].encrypted_payload;expect(stored).not.toContain("private-device-id");
      await f.due();expect(await f.call("status")).toEqual({state:"authorized"});
      const credential=JSON.parse((await f.repo.managedCredential(f.id,"model"))!.payload);expect(credential.tokens).toMatchObject({access_token:"private-access",refresh_token:"private-refresh"});
      expect(JSON.stringify(await f.repo.metadata())).not.toContain("private-access");expect((await f.db.pool.query("SELECT 1 FROM app.model_device_authorizations WHERE tenant_id=$1",[f.tenantId])).rowCount).toBe(0);
      await expect(modelDeviceAuthorization(f.env,{...f.auth,tenantId:f.otherTenant},f.id,"status")).rejects.toBeInstanceOf(ModelAccountUnavailable);
    }finally{await f.cleanup();}
  });
  it("handles pending, bad PKCE, cancel, expiry, rotation and disconnect without overwriting a credential",async()=>{
    const f=await fixture();try{
      let mode="pending";
      const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("/usercode")?Response.json({device_auth_id:"private",user_code:"CODE",interval:1}):mode==="pending"?new Response(null,{status:403}):Response.json({authorization_code:"code",code_verifier:"wrong",code_challenge:"mismatch"}));vi.stubGlobal("fetch",fetcher);
      await f.call("authorize");await f.due();expect((await f.call("status")).state).toBe("pending");
      mode="bad";await f.due();expect(await f.call("status")).toEqual({state:"failed"});expect((await f.repo.managedCredential(f.id,"model"))!.payload).toBe("{}");
      await f.call("authorize");expect(await f.call("cancel")).toEqual({state:"canceled"});expect(await f.call("status")).toEqual({state:"idle"});
      await f.call("authorize");await f.db.pool.query("UPDATE app.model_device_authorizations SET expires_at=now()-interval '1 second'");expect(await f.call("status")).toEqual({state:"expired"});
      await f.call("authorize");await f.repo.write({id:f.id,kind:"model",name:"ChatGPT",origin:null,description:null,expectedRevision:await f.repo.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:'{"OPENAI_API_KEY":"replacement"}'});
      expect(await f.call("status")).toEqual({state:"authorized"});
      await f.repo.write({id:f.id,kind:"model",name:"ChatGPT",origin:null,description:null,expectedRevision:await f.repo.revision(),idempotencyKey:crypto.randomUUID(),operation:"delete"});
      await expect(f.call("status")).rejects.toBeInstanceOf(ModelAccountUnavailable);
      expect(fetcher.mock.calls.every(([url])=>String(url).startsWith("https://auth.openai.com/"))).toBe(true);
    }finally{await f.cleanup();}
  });
});

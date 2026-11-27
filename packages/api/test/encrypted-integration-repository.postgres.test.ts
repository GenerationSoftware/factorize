import {describe, expect, it, vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {CredentialRepository, IntegrationIdempotencyConflictError, StaleIntegrationRevisionError, MANAGED_BEARER_PREFIX} from "../src/credentials/storage/credential-repository";
import {decrypt, encrypt} from "../src/crypto";

vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class{},getOAuthApi:vi.fn()}));
const url=process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("managed credential persistence", {timeout:60_000}, () => {
  it("encrypts credentials, exposes metadata only, isolates tenants and preserves CAS/idempotency", async () => {
    const f=await loadingFixture(url!);
    try {
      const repo=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
      const input={id:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),expectedRevision:0,operation:"upsert" as const,kind:"bearer" as const,name:"Service",origin:"https://api.example.com",description:null,managedSecret:"fixture-private-secret"};
      expect(await repo.write(input)).toEqual({revision:1,duplicate:false});
      expect(await repo.write(input)).toEqual({revision:1,duplicate:true});
      await expect(repo.write({...input,managedSecret:"different"})).rejects.toBeInstanceOf(IntegrationIdempotencyConflictError);
      await expect(repo.write({...input,idempotencyKey:crypto.randomUUID()})).rejects.toBeInstanceOf(StaleIntegrationRevisionError);
      const stored=(await f.db.pool.query("SELECT encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2",[f.tenantId,input.id])).rows[0].encrypted_payload;
      expect(stored).not.toContain(input.managedSecret);
      expect(await decrypt(stored,f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe(MANAGED_BEARER_PREFIX+input.managedSecret);
      expect(JSON.stringify(await repo.metadata())).not.toContain(input.managedSecret);
      expect(await new CredentialRepository(f.db,f.otherTenant,f.env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(input.id,"bearer")).toBeNull();
      expect((await repo.managedCredential(input.id,"bearer"))?.payload).toBe(input.managedSecret);
      await repo.write({...input,expectedRevision:1,idempotencyKey:crypto.randomUUID(),managedSecret:"rotated"});
      expect((await repo.managedCredential(input.id,"bearer"))?.payload).toBe("rotated");
      const {managedSecret,...metadata}=input;
      await repo.write({...metadata,expectedRevision:2,idempotencyKey:crypto.randomUUID(),operation:"delete"});
      expect(await repo.managedCredential(input.id,"bearer")).toBeNull();
    } finally {await f.cleanup();}
  });

});

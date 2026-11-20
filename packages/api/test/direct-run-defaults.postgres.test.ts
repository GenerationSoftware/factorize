import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService, ServiceError } from "../src/flow-service";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import { encrypt } from "../src/crypto";
import { CredentialRepository, MANAGED_BEARER_PREFIX } from "../src/postgres/credential-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const defaults = (vmImage: string) => ({ executionConfigId: "local", model: "", effort: "", vmImage, tags: [], portableIntegrationIds: [], githubInstallationIds: [], xConnectionIds: [], runScopes: [] });
async function modelFixture(f:Awaited<ReturnType<typeof loadingFixture>>){
 const repository=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY),id=crypto.randomUUID();
 await repository.write({id,kind:"model",name:"Fixture model",origin:null,description:null,expectedRevision:await repository.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://models.example/v1"})});
 await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2",[f.tenantId,id]);
 const integration=(await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id=$2",[f.tenantId,id])).rows[0].id;
 return {id,integration};
}


describe.skipIf(!url)("direct run defaults and integration access", { timeout: 30_000 }, () => {
  it("uses team defaults and inherits or narrows effective integrations", async () => {
    const f = await loadingFixture(url!);
    try {
      const model=await modelFixture(f);
      const credentialId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.integration_collections(tenant_id) VALUES($1) ON CONFLICT DO NOTHING", [f.tenantId]);
      const encryptedPayload = await encrypt(`${MANAGED_BEARER_PREFIX}test-only-secret`, f.env.CREDENTIAL_ENCRYPTION_KEY);
      await f.db.pool.query("INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,revision,encrypted_payload) VALUES($1,$2,'bearer','Direct test','https://upstream.test',1,$3)", [f.tenantId, credentialId, encryptedPayload]);
      await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND kind='bearer' AND credential_id=$2", [f.tenantId, credentialId]);
      const integrationRow = await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='bearer' AND credential_id=$2", [f.tenantId, credentialId]);
      const effectiveIntegrationId = integrationRow.rows[0].id as string;
      await f.db.pool.query("UPDATE app.team_settings SET run_defaults=$2 WHERE tenant_id=$1", [f.tenantId, {...defaults("ghcr.io/factorize/direct-run:test"),modelAccountId:model.id,model:"fixture-model", portableIntegrationIds:[credentialId]}]);

      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "team:read", "integrations:read", "proxy:use"] });
      const inherited = await service.startRun({ prompt: "Inherited defaults", idempotencyKey: "inherit" });
      const inheritedConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, inherited.runId])).rows[0].execution_config;
      expect(inheritedConfig.image).toBe("ghcr.io/factorize/direct-run:test");
      expect(inheritedConfig.portableIntegrationIds).toEqual([credentialId]);
      expect(inheritedConfig.agentIntegrationIds).toEqual(expect.arrayContaining([effectiveIntegrationId,model.integration]));

      const empty = await service.startRun({ prompt: "Direct", integrationIds: [model.integration], idempotencyKey: "empty" });
      const emptyConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, empty.runId])).rows[0].execution_config;
      expect(emptyConfig.executionType).toBe("agent");
      expect(emptyConfig.agentIntegrationIds).toEqual([model.integration]);
      expect(emptyConfig.portableIntegrationIds).toEqual([]);

      const narrowed = await service.startRun({ prompt: "Narrowed", integrationIds: [effectiveIntegrationId,model.integration], runScopes: ["team:read"] });
      const narrowedConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, narrowed.runId])).rows[0].execution_config;
      expect(narrowedConfig).toMatchObject({agentIntegrationIds: [effectiveIntegrationId,model.integration], runScopes: ["team:read"]});
      const withoutProxy = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "narrow", oauthClientId: "client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start"] });
      await expect(withoutProxy.startRun({ prompt: "narrowed token", integrationIds: [effectiveIntegrationId] })).rejects.toMatchObject({ status: 403 });
      const denied = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy) VALUES($1,$2,'bearer',$3,'Requestable only',true,'requestable')", [f.tenantId, denied, crypto.randomUUID()]);
      await expect(service.startRun({ prompt: "not authorized", integrationIds: [denied], idempotencyKey: "denied" })).rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<ServiceError>);
    } finally { await f.cleanup(); }
  });

  it("uses explicit execution settings before presets and rejects empty agent models", async () => {
    const f = await loadingFixture(url!);
    try {
      const model=await modelFixture(f);
      await f.db.pool.query("UPDATE app.team_settings SET run_defaults=$2 WHERE tenant_id=$1", [f.tenantId, { ...defaults("ghcr.io/factorize/team-default:test"),modelAccountId:model.id,model:"fixture-model", capacity: 4 }]);
      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "team:read", "integrations:read", "proxy:use"] });
      await expect(service.startRun({prompt:"Empty model",model:"",integrationIds:[]})).rejects.toMatchObject({status:409,code:"model_configuration_required"});
      const run = await service.startRun({ prompt: "Explicit settings", vmImage: "alpine:3.22", integrationIds: [model.integration], idempotencyKey: "explicit-first" });
      const config = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, run.runId])).rows[0].execution_config;
      expect(config.image).toBe("alpine:3.22");
      expect(config.model).toBe("fixture-model");
    } finally { await f.cleanup(); }
  });

  it("inherits effective MCP scopes, accepts an empty subset, and rejects disabled scopes", async () => {
    const f = await loadingFixture(url!);
    try {
      const model=await modelFixture(f);
      await f.db.pool.query("UPDATE app.team_settings SET run_defaults=$2 WHERE tenant_id=$1", [f.tenantId, {...defaults("ghcr.io/factorize/direct-run:test"),modelAccountId:model.id,model:"fixture-model",runScopes:["runs:start","team:read","triggers:write"]}]);
      await f.db.pool.query("INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,disabled_scopes) VALUES($1,'oauth','test-grant',$2,$3,$4)", [f.tenantId, f.userId, f.auth.sessionVersion, ["triggers:write"]]);
      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "team:read", "integrations:read", "triggers:write","proxy:use"] });

      const inherited = await service.startRun({ prompt: "Inherited access", idempotencyKey: "effective-scopes" });
      const inheritedConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, inherited.runId])).rows[0].execution_config;
      expect(inheritedConfig.runScopes).toContain("runs:start");
      expect(inheritedConfig.runScopes).not.toContain("triggers:write");

      const empty = await service.startRun({ prompt: "No application permissions", integrationIds: [model.integration], runScopes: [], idempotencyKey: "empty-scopes" });
      const emptyConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, empty.runId])).rows[0].execution_config;
      expect(emptyConfig.runScopes).toEqual([]);

      await expect(service.startRun({ prompt: "cannot delegate disabled scope", runScopes: ["triggers:write"], idempotencyKey: "denied-scope" })).rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<ServiceError>);
    } finally { await f.cleanup(); }
  });

  it("resolves hosted Pi models independently of the VM agent catalog",async()=>{
    const f=await loadingFixture(url!);
    try{
      const repository=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY),id=crypto.randomUUID();
      await repository.write({id,kind:"model",name:"Fixture",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://models.example/v1"})});
      await f.db.pool.query("UPDATE app.team_settings SET run_defaults=$2 WHERE tenant_id=$1",[f.tenantId,{...defaults(""),modelAccountId:id,model:"default-model"}]);
      const service=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"runs:start"]});
      const started=await service.startRun({prompt:"Hosted",model:"custom-provider-model",modelAccountId:id});
      const saved=(await f.db.pool.query("SELECT execution_config,execution_backend_kind FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,started.runId])).rows[0];
      expect(saved).toMatchObject({execution_backend_kind:"hosted-pi",execution_config:{agentKind:"pi",model:"custom-provider-model",modelAccountId:id}});
      await expect(service.startRun({prompt:"Missing model",model:""})).rejects.toMatchObject({status:409,code:"model_configuration_required"});
    }finally{await f.cleanup();}
  });
});

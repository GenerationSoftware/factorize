import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService, ServiceError } from "../src/flow-service";
import { ConnectionRepository } from "../src/postgres/connection-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const defaults = (vmImage: string) => ({ executionConfigId: "local", model: "", effort: "", vmImage, tags: [], portableIntegrationIds: [], githubInstallationIds: [], xConnectionIds: [], runScopes: [] });

describe.skipIf(!url)("direct run defaults and integration access", { timeout: 30_000 }, () => {
  it("uses user defaults when the project has none and inherits or narrows effective integrations", async () => {
    const f = await loadingFixture(url!);
    try {
      const integrationId = crypto.randomUUID(), credentialId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.integration_collections(tenant_id) VALUES($1)", [f.tenantId]);
      await f.db.pool.query("INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,revision,encrypted_payload) VALUES($1,$2,'bearer','Direct test','https://upstream.test',1,'ciphertext')", [f.tenantId, credentialId]);
      await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy) VALUES($1,$2,'bearer',$3,'Direct test',true,'baseline')", [f.tenantId, integrationId, credentialId]);
      await f.db.pool.query("INSERT INTO app.user_run_defaults(tenant_id,user_id,run_defaults) VALUES($1,$2,$3)", [f.tenantId, f.userId, defaults("ghcr.io/factorize/direct-run:test")]);

      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "projects:read", "integrations:read"] });
      const inherited = await service.startRun({ projectId: f.projectId, prompt: "Keep prompt requests compatible", idempotencyKey: "inherit" });
      const inheritedConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, inherited.runId])).rows[0].execution_config;
      expect(inheritedConfig.image).toBe("ghcr.io/factorize/direct-run:test");
      expect(inheritedConfig.portableIntegrationIds).toEqual([credentialId]);
      expect(inheritedConfig.agentIntegrationIds).toEqual([integrationId]);

      const empty = await service.startRun({ projectId: f.projectId, script: "echo direct", integrationIds: [], idempotencyKey: "empty" });
      const emptyConfig = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, empty.runId])).rows[0].execution_config;
      expect(emptyConfig.executionType).toBe("code");
      expect(emptyConfig.agentIntegrationIds).toEqual([]);
      expect(emptyConfig.portableIntegrationIds).toEqual([]);

      const denied = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy) VALUES($1,$2,'bearer',$3,'Requestable only',true,'requestable')", [f.tenantId, denied, crypto.randomUUID()]);
      await expect(service.startRun({ projectId: f.projectId, prompt: "not authorized", integrationIds: [denied], idempotencyKey: "denied" })).rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<ServiceError>);
    } finally { await f.cleanup(); }
  });

  it("uses project execution defaults before user defaults", async () => {
    const f = await loadingFixture(url!);
    try {
      await f.db.pool.query("INSERT INTO app.user_run_defaults(tenant_id,user_id,run_defaults) VALUES($1,$2,$3)", [f.tenantId, f.userId, { ...defaults("ghcr.io/factorize/user-default:test"), model: "user-default-model" }]);
      const projectDefaults = { ...defaults("ghcr.io/factorize/project-default:test"), capacity: 4 } as Record<string, unknown>;
      delete projectDefaults.model;
      await f.db.pool.query("UPDATE app.projects SET run_defaults=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.projectId, projectDefaults]);
      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "projects:read", "integrations:read"] });
      const run = await service.startRun({ projectId: f.projectId, prompt: "project wins", integrationIds: [], idempotencyKey: "project-first" });
      const config = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, run.runId])).rows[0].execution_config;
      expect(config.image).toBe("ghcr.io/factorize/project-default:test");
      expect(config.model).toBe("user-default-model");
    } finally { await f.cleanup(); }
  });

  it("validates the resolved agent model against the selected execution provider", async () => {
    const f = await loadingFixture(url!);
    try {
      await new ConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY).put("exe:local", { apiToken: "private-exe-token", agentKind: "codex", models: ["supported-model"] });
      await f.db.pool.query("INSERT INTO app.user_run_defaults(tenant_id,user_id,run_defaults) VALUES($1,$2,$3)", [f.tenantId, f.userId, defaults("")]);
      const service = new ApiService(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "test-grant", oauthClientId: "test-client", oauthExpiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ["runs:start", "projects:read", "integrations:read"] });
      await expect(service.startRun({ projectId: f.projectId, prompt: "invalid model", model: "other-model", integrationIds: [], idempotencyKey: "invalid-model" })).rejects.toMatchObject({ status: 400, code: "invalid_request" });
      const run = await service.startRun({ projectId: f.projectId, prompt: "valid model", model: "supported-model", integrationIds: [], idempotencyKey: "valid-model" });
      const config = (await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, run.runId])).rows[0].execution_config;
      expect(config.agentKind).toBe("codex");
      expect(config.model).toBe("supported-model");
    } finally { await f.cleanup(); }
  });
});

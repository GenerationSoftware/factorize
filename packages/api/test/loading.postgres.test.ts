import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { Database } from "../src/postgres/database";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
import { TriggerSummaryRepository } from "../src/postgres/job-summary-repository";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import { CredentialRepository } from "../src/postgres/credential-repository";
import { FlyConnectionRepository } from "../src/postgres/fly-connection-repository";
import { FlyExecutionConfigurationRepository } from "../src/postgres/fly-execution-configuration-repository";
import { GitHubRepository } from "../src/postgres/github-repository";
import { XConnectionRepository } from "../src/postgres/x-connection-repository";
import { encrypt } from "../src/crypto";
import { ApiService } from "../src/flow-service";
import worker from "../src/worker";
import { signSession } from "../src/index";
import type { Env, OAuthProps } from "../src/types";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("request loading with PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  let db: Database, env: Env, auth: OAuthProps, cookie: string, triggerIds: string[], runId: string, tenantId: string, userId: string, otherTenant: string;
  let request: Awaited<ReturnType<typeof loadingFixture>>["request"];
  beforeAll(async () => { fixture = await loadingFixture(url!); ({ db, env, auth, cookie, triggerIds, runId, tenantId, userId, otherTenant, request } = fixture); }, 30_000);
  afterAll(async () => fixture?.cleanup());

  it("lists ten triggers in three data queries, preserving decrypted prompts, event order and statistics", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const triggers = await new ApiService(env, auth).listTriggers();
      expect(triggers).toHaveLength(10);
      expect(triggers.find(j => j.id === triggerIds[0])).toMatchObject({ prompt: "Prompt", runningCount: 1, lastRunState: "queued" });
      for (const trigger of triggers) expect(trigger.events.map(t => t.kind)).toEqual(["manual", "schedule"]);
      expect(query).toHaveBeenCalledTimes(4); // membership + triggers + events + statistics
    } finally { query.mockRestore(); }
  });
  it("counts only active runs and keeps latest-state ties tenant qualified", async () => {
    const eventId = (await db.pool.query("SELECT id FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND kind='manual'", [tenantId, triggerIds[0]])).rows[0].id;
    const otherEventId = (await db.pool.query("SELECT id FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND kind='manual'", [otherTenant, triggerIds[0]])).rows[0].id;
    const states = ["reserved", "starting", "blocked", "stopping", "queued", "succeeded", "failed"];
    for (const [i, state] of states.entries()) {
      const invocationId = crypto.randomUUID(), id = `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      await db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context) VALUES ($1,$2,$3,'manual',$4,$5,'{}')", [tenantId, invocationId, triggerIds[0], `summary-test-${i}`, eventId]);
      await db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt,created_at) VALUES ($1,$2,$3,$4,$5,'test',$6)", [tenantId, id, triggerIds[0], invocationId, state, i >= 5 ? "2100-01-01T00:00:00Z" : `2099-01-01T00:00:0${i}Z`]);
    }
    const otherInvocation = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context) VALUES ($1,$2,$3,'manual','summary-other-tenant',$4,'{}')", [otherTenant, otherInvocation, triggerIds[0], otherEventId]);
    await db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt,created_at) VALUES ($1,$2,$3,$4,'running','test','2101-01-01T00:00:00Z')", [otherTenant, crypto.randomUUID(), triggerIds[0], otherInvocation]);

    const triggers = await new ApiService(env, auth).listTriggers();
    expect(triggers.find(trigger => trigger.id === triggerIds[0])).toMatchObject({ runningCount: 5, lastRunState: "failed" });
    expect(triggers.find(trigger => trigger.id === triggerIds[1])).toMatchObject({ runningCount: 0, lastRunState: null });
    const summaries = (await new TriggerSummaryRepository(db, tenantId).page({ limit: 100, q: "" })).items;
    expect(summaries.find(trigger => trigger.id === triggerIds[0])).toMatchObject({ runningCount: 5, lastRunState: "failed" });
    expect(summaries.find(trigger => trigger.id === triggerIds[1])).toMatchObject({ runningCount: 0, lastRunState: null });
  });
  it("does not load another tenant's triggers", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const triggers = await new PostgresTriggerRepository(db, otherTenant, async v => v, async v => v).list();
      expect(triggers).toHaveLength(1); expect(triggers[0].events.map(t => t.slug)).toEqual(["private"]);
      expect(query).toHaveBeenCalledTimes(2);
      query.mockClear();
      expect(await new PostgresTriggerRepository(db, tenantId, async v => v, async v => v).list()).toHaveLength(10);
      expect(query).toHaveBeenCalledTimes(2);
    } finally { query.mockRestore(); }
  });
  it("validates cookie membership once and exposes timing plus the trigger name in run detail", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const response = await request(`/api/v1/runs/${runId}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Server-Timing")).toMatch(/auth;dur=[\d.]+, application;dur=[\d.]+/);
      expect(await response.json()).toMatchObject({ trigger_name: "Trigger-0", prompt: "Prompt", activity: [], trace_projection: null, trace_generation: null, harness_log: null });
      expect(query.mock.calls.filter(([sql]) => typeof sql === "string" && sql.includes("FROM app.members m JOIN app.auth_users"))).toHaveLength(1);
    } finally { query.mockRestore(); }
  });
  it("batches integration reads and never returns credentials", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const status = await new ApiService(env, auth).integrationStatus();
      expect(status.cloudflareTail.installations).toEqual([{ integrationId: "local", name: "Local", status: "connected", secretConfigured: true, referencedTriggerCount: 0 }]);
      expect(JSON.stringify(status)).not.toContain("private-");
      expect(query).toHaveBeenCalledTimes(3); // membership + connections + reference counts
    } finally { query.mockRestore(); }
  });
  it("keeps the integration status available when legacy connection metadata is malformed", async () => {
    const connections = new ConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY), originalLinear = await connections.get("linear");
    try {
      await connections.put("linear", { organizationName: 42, viewerEmail: false });
      await connections.put("exe:legacy", { apiToken: "private-token", accountTags: "not-an-array" });
      await connections.put("amp:legacy", { accessToken: "private-token", project: 42, apiBaseUrl: false });
      await connections.put("cloudflare-tail:legacy", { signingSecret: "private-secret" });
      const status = await new ApiService(env, auth).integrationStatus();
      expect(status.linear).toEqual({ organizationName: null, viewerEmail: null });
      expect(status.exeConnections).toContainEqual(expect.objectContaining({ connectionId: "legacy", credentialStatus: "connected", accountTags: [] }));
      expect(status.ampConnections).toContainEqual({ connectionId: "legacy", project: "Unnamed Amp project" });
      expect(status.cloudflareTail.installations).toContainEqual({ integrationId: "legacy", name: "Unnamed Tail integration", status: "connected", secretConfigured: true, referencedTriggerCount: 0 });
      expect(JSON.stringify(status)).not.toContain("private-");
    } finally {
      await Promise.all([originalLinear ? connections.put("linear", originalLinear) : connections.delete("linear"), connections.delete("exe:legacy"), connections.delete("amp:legacy"), connections.delete("cloudflare-tail:legacy")]);
    }
  });

  it("creates a trigger with a deterministic migrated execution integration UUID", async () => {
    const target = "local";
    try {
      const trigger = await new ApiService(env, auth).createTrigger({ name: "migrated-target-trigger",  prompt: "Do work", executionConfigId: target, vmImage: "ghcr.io/GenerationSoftware/anarack:ReleaseA", concurrencyLimit: 1, events: [{ kind: "manual", enabled: true, config: {} }] });
      expect(trigger.executionConfigId).toBe(target);
      expect(trigger).toMatchObject({ portableIntegrationIds: [] });
      expect(trigger.executionConfig).toMatchObject({ connectionId: "local", agentKind: "pi" });
      expect(trigger.executionConfig.image).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
      const native = await new ApiService(env, auth).createTrigger({ name: "native-model-trigger",  prompt: "Do work", executionConfigId: target, concurrencyLimit: 1, events: [{ kind: "manual", enabled: true, config: {} }] });
      expect(native).toMatchObject({ portableIntegrationIds: [] });
    } finally {
      await db.pool.query("DELETE FROM app.triggers WHERE execution_config->>'targetId'=$1", [target]);
    }
  });
  it("persists explicit integration and model selections and snapshots them at invocation", async () => {
    const service = new ApiService(env, auth);
    const write = async (kind: "bearer" | "model", name: string, owner = tenantId) => {
      const repository = new CredentialRepository(db, owner, env.CREDENTIAL_ENCRYPTION_KEY), id = crypto.randomUUID();
      await repository.write({ id, idempotencyKey: crypto.randomUUID(), expectedRevision: await repository.revision(), operation: "upsert", kind, name, origin: kind === "bearer" ? "https://api.example.test" : null, description: null, ...(kind === "bearer" ? {managedSecret: "fixture"} : {managedModelPayload: JSON.stringify({providerUrl:"https://models.example/v1",apiKey:"fixture-model-key"})}) });
      return id;
    };
    const bearerA = await write("bearer", "Tools A"), bearerB = await write("bearer", "Tools B");
    const accountA = await write("model", "Account A"), accountB = await write("model", "Account B"), foreignAccount = await write("model", "Foreign Account", otherTenant);
    await new FlyConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY).save({ organizationSlug: "fixture", organizationName: "Fixture" }, "fixture-token");
    const execution = await new FlyExecutionConfigurationRepository(db, tenantId).save({ name: "Fixture", image: "ghcr.io/example/agent:latest", region: "iad", size: "shared-cpu-1x" });
    const base = { name: `portable-${crypto.randomUUID().slice(0, 8)}`,  prompt: "Do work", executionConfigId: execution.id, concurrencyLimit: 1, events: [{ kind: "manual" as const, enabled: true, config: {} }] };
    try {
      await expect(service.createTrigger({ ...base, modelAccountId: foreignAccount })).rejects.toMatchObject({ status: 400 });
      const trigger = await service.createTrigger({ ...base, portableIntegrationIds: [bearerA], modelAccountId: accountA });
      expect(trigger).toMatchObject({ portableIntegrationIds: [bearerA], modelAccountId: accountA });
      expect(trigger.executionConfig).toMatchObject({ region: "iad", size: "shared-cpu-1x" });
      const invoked = await service.invokeTrigger(trigger.id, { prompt: "run", data: {} });
      const snapshot = (await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, invoked.runId])).rows[0].execution_config;
      expect(snapshot).toMatchObject({ portableIntegrationIds: [bearerA], modelAccountId: accountA });
      const updated = await service.updateTrigger(trigger.id, { ...base, portableIntegrationIds: [bearerB], modelAccountId: accountB });
      expect(updated).toMatchObject({ portableIntegrationIds: [bearerB], modelAccountId: accountB });
      expect((await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, invoked.runId])).rows[0].execution_config).toEqual(snapshot);
      const omitted = await service.updateTrigger(trigger.id, { ...base });
      expect(omitted).toMatchObject({ portableIntegrationIds: [bearerB], modelAccountId: accountB });
      await expect(service.createTrigger({ ...base, portableIntegrationIds: [foreignAccount] })).rejects.toMatchObject({ status: 400 });
      await expect(service.createTrigger({ ...base, name: `code-${crypto.randomUUID().slice(0, 8)}`, executionType:"code",script:"echo ok" })).rejects.toMatchObject({code:"scripts_retired"});
      expect(await service.createTrigger({...base,name:`need-${crypto.randomUUID().slice(0,8)}`})).not.toHaveProperty("modelAccess");
    } finally {
      await db.pool.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND (slug LIKE 'portable-%' OR slug LIKE 'code-%' OR slug LIKE 'need-%')", [tenantId]);
      await db.pool.query("DELETE FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id=$2", [tenantId, execution.id]);
      await new FlyConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY).remove();
    }
  });
  it("snapshots selected tenant GitHub and Linear connections and rejects disconnected or foreign selections", async () => {
    const service = new ApiService(env, auth), github = new GitHubRepository(db, tenantId), otherGithub = new GitHubRepository(db, otherTenant);
    const installationId = Number(`8${Date.now().toString().slice(-8)}`), foreignInstallationId = installationId + 1;
    const connections = new ConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY), priorLinear = await connections.get<any>("linear");
    const slug = `provider-${crypto.randomUUID().slice(0, 8)}`;
    const base = { name: slug, prompt: "Do work", executionConfigId: "local", concurrencyLimit: 1, events: [{ kind: "manual" as const, enabled: true, config: {} }] };
    try {
      await github.save({ installationId, accountLogin: "tenant-install", accountType: "Organization", state: "active" });
      await otherGithub.save({ installationId: foreignInstallationId, accountLogin: "foreign-install", accountType: "Organization", state: "active" });
      await connections.put("linear", { organizationName: "Tenant Linear", accessToken: "first" });
      await expect(service.createTrigger({ ...base, githubInstallationIds: [foreignInstallationId] })).rejects.toMatchObject({ status: 400 });
      const trigger = await service.createTrigger({ ...base, githubInstallationIds: [installationId], linearConnectionId: "linear" });
      expect(trigger).toMatchObject({ githubInstallationIds: [installationId], linearConnectionId: "linear" });
      const invoked = await service.invokeTrigger(trigger.id, { prompt: "run", data: {} });
      const readSnapshot = async () => (await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, invoked.runId])).rows[0].execution_config;
      const snapshot = await readSnapshot();
      expect(snapshot).toMatchObject({ githubInstallationIds: [installationId], linearConnectionId: "linear" });
      await connections.put("linear", { organizationName: "Tenant Linear", accessToken: "rotated" });
      await expect(service.updateTrigger(trigger.id, { ...base, githubInstallationIds: [installationId], linearConnectionId: "linear" })).resolves.toMatchObject({ githubInstallationIds: [installationId], linearConnectionId: "linear" });
      expect(await readSnapshot()).toEqual(snapshot);
      await github.updateState(installationId, "suspended");
      await expect(service.updateTrigger(trigger.id, { ...base, githubInstallationIds: [installationId], linearConnectionId: "linear" })).rejects.toMatchObject({ status: 400 });
      await connections.delete("linear");
      await expect(service.createTrigger({ ...base, name: `${slug}-disconnected`, linearConnectionId: "linear" })).rejects.toMatchObject({ status: 400 });
    } finally {
      await db.pool.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND slug LIKE $2", [tenantId, `${slug}%`]);
      await db.pool.query("DELETE FROM app.github_installations WHERE tenant_id=$1 AND installation_id=ANY($2::bigint[])", [tenantId, [installationId]]);
      await db.pool.query("DELETE FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [otherTenant, foreignInstallationId]);
      if (priorLinear) await connections.put("linear", priorLinear); else await connections.delete("linear");
    }
  });
  it("validates tenant-owned X selections and keeps each run's X connection snapshot immutable", async () => {
    const service = new ApiService(env, auth), x = new XConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY), foreign = new XConnectionRepository(db, otherTenant, env.CREDENTIAL_ENCRYPTION_KEY);
    const firstId = crypto.randomUUID(), nextId = crypto.randomUUID(), foreignId = crypto.randomUUID(), slug = `x-provider-${crypto.randomUUID().slice(0, 8)}`;
    const scopes = ["tweet.read", "users.read", "offline.access"];
    const createConnected = async (repository: XConnectionRepository, id: string, name: string) => {
      await repository.create({ id, name, clientId: "public-client", clientSecret: "private", scopes });
      await repository.completeOAuth(id, { accessToken: "access", refreshToken: "refresh", expiresAt: new Date(Date.now()+3_600_000).toISOString(), accountId: id, accountHandle: name.toLowerCase().replaceAll(" ", "_"), grantedScopes: scopes });
    };
    const base = { name: slug, prompt: "Do work", executionConfigId: "local", concurrencyLimit: 1, events: [{ kind: "manual" as const, enabled: true, config: {} }] };
    try {
      await createConnected(x, firstId, "First X"); await createConnected(x, nextId, "Next X"); await createConnected(foreign, foreignId, "Foreign X");
      await expect(service.createTrigger({ ...base, xConnectionIds: [foreignId] })).rejects.toMatchObject({ status: 400 });
      const trigger = await service.createTrigger({ ...base, xConnectionIds: [firstId] });
      expect(trigger).toMatchObject({ xConnectionIds: [firstId] });
      const run = await service.invokeTrigger(trigger.id, { prompt: "run", data: {} });
      const readSnapshot = async () => (await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, run.runId])).rows[0].execution_config;
      const snapshot = await readSnapshot(); expect(snapshot.xConnectionIds).toEqual([firstId]);
      await service.updateTrigger(trigger.id, { ...base, xConnectionIds: [nextId] });
      expect(await readSnapshot()).toEqual(snapshot);
      await x.delete(firstId);
      await expect(service.updateTrigger(trigger.id, { ...base, xConnectionIds: [firstId] })).rejects.toMatchObject({ status: 400 });
      await expect(service.createTrigger({ ...base, name: `${slug}-foreign`, xConnectionIds: [foreignId] })).rejects.toMatchObject({ status: 400 });
    } finally {
      await db.pool.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND slug LIKE $2", [tenantId, `${slug}%`]);
      await db.pool.query("DELETE FROM app.x_connections WHERE (tenant_id=$1 AND id=ANY($2::uuid[])) OR (tenant_id=$3 AND id=$4)", [tenantId, [firstId, nextId], otherTenant, foreignId]);
    }
  });
  it("enforces tenant and scope boundaries, email verification, cookie expiry and session revocation", async () => {
    await expect(new ApiService(env, { ...auth, tenantId: otherTenant }).listTriggers()).rejects.toMatchObject({ status: 401 });
    await expect(new ApiService(env, { ...auth, scopes: ["runs:read"] }).listTriggers()).rejects.toMatchObject({ status: 403 });
    const expired = await signSession({ ...auth, email: "owner@example.test", exp: 1 }, env.SESSION_SIGNING_SECRET);
    expect((await request("/api/v1/triggers", `factorize_session=${expired}`)).status).toBe(401);
    expect((await request("/api/v1/triggers", cookie + "tampered")).status).toBe(401);
    await db.pool.query("UPDATE app.auth_users SET email_verified=false WHERE id=$1", [userId]);
    expect((await request("/api/v1/triggers")).status).toBe(401);
    await db.pool.query("UPDATE app.auth_users SET email_verified=true WHERE id=$1", [userId]);
    await new IdentityRepository(db, tenantId).revoke(userId);
    expect((await request("/api/v1/triggers")).status).toBe(401);
    await db.pool.query("UPDATE app.members SET session_version=$3 WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId, auth.sessionVersion]);
  });
  it("checks token revocation and expiry independently of membership", async () => {
    const service = new ApiService(env, auth), issued: any = await service.createAccessToken({ name: "test", scopes: ["team:read", "triggers:read", "integrations:read"], expiryDays: 7 });
    const tokenAuth = { ...auth, scopes: ["team:read", "triggers:read", "integrations:read"], authMethod: "access_token" as const, accessTokenId: issued.id };
    const bearer = () => worker.fetch(new Request("https://factorize.test/api/v1/triggers", { headers: { Authorization: `Bearer ${issued.token}` } }), env, { waitUntil() {} } as any);
    expect(await new ApiService(env, tokenAuth).listTriggers()).toHaveLength(10);
    expect((await bearer()).status).toBe(200);
    await db.pool.query("UPDATE app.access_tokens SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenantId, issued.id]);
    await expect(new ApiService(env, tokenAuth).listTriggers()).rejects.toMatchObject({ status: 401 });
    expect((await bearer()).status).toBe(401);
    await db.pool.query("UPDATE app.access_tokens SET expires_at=now()+interval '1 day',revoked_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, issued.id]);
    await expect(new ApiService(env, tokenAuth).listTriggers()).rejects.toMatchObject({ status: 401 });
    expect((await bearer()).status).toBe(401);
  });
});

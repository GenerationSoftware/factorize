import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { Database } from "../src/postgres/database";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { PostgresJobRepository } from "../src/postgres/job-repository";
import { JobSummaryRepository } from "../src/postgres/job-summary-repository";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import { EncryptedIntegrationRepository } from "../src/postgres/encrypted-integration-repository";
import { FlyConnectionRepository } from "../src/postgres/fly-connection-repository";
import { FlyExecutionConfigurationRepository } from "../src/postgres/fly-execution-configuration-repository";
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
  let db: Database, env: Env, auth: OAuthProps, cookie: string, jobIds: string[], runId: string, tenantId: string, userId: string, otherTenant: string;
  let request: Awaited<ReturnType<typeof loadingFixture>>["request"];
  beforeAll(async () => { fixture = await loadingFixture(url!); ({ db, env, auth, cookie, jobIds, runId, tenantId, userId, otherTenant, request } = fixture); }, 30_000);
  afterAll(async () => fixture?.cleanup());

  it("lists ten jobs in three data queries, preserving decrypted prompts, trigger order and statistics", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const jobs = await new ApiService(env, auth).listJobs();
      expect(jobs).toHaveLength(10);
      expect(jobs.find(j => j.id === jobIds[0])).toMatchObject({ promptTemplate: "Prompt", runningCount: 1, lastRunState: "queued" });
      for (const job of jobs) expect(job.triggers.map(t => t.kind)).toEqual(["manual", "schedule"]);
      expect(query).toHaveBeenCalledTimes(4); // membership + jobs + triggers + statistics
    } finally { query.mockRestore(); }
  });
  it("counts only active runs and keeps latest-state ties tenant qualified", async () => {
    const triggerId = (await db.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND job_id=$2 AND kind='manual'", [tenantId, jobIds[0]])).rows[0].id;
    const otherTriggerId = (await db.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND job_id=$2 AND kind='manual'", [otherTenant, jobIds[0]])).rows[0].id;
    const states = ["reserved", "starting", "blocked", "stopping", "queued", "succeeded", "failed"];
    for (const [i, state] of states.entries()) {
      const invocationId = crypto.randomUUID(), id = `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual',$4,$5,'{}')", [tenantId, invocationId, jobIds[0], `summary-test-${i}`, triggerId]);
      await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,created_at) VALUES ($1,$2,$3,$4,$5,'test',$6)", [tenantId, id, jobIds[0], invocationId, state, i >= 5 ? "2100-01-01T00:00:00Z" : `2099-01-01T00:00:0${i}Z`]);
    }
    const otherInvocation = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','summary-other-tenant',$4,'{}')", [otherTenant, otherInvocation, jobIds[0], otherTriggerId]);
    await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,created_at) VALUES ($1,$2,$3,$4,'running','test','2101-01-01T00:00:00Z')", [otherTenant, crypto.randomUUID(), jobIds[0], otherInvocation]);

    const jobs = await new ApiService(env, auth).listJobs();
    expect(jobs.find(job => job.id === jobIds[0])).toMatchObject({ runningCount: 5, lastRunState: "failed" });
    expect(jobs.find(job => job.id === jobIds[1])).toMatchObject({ runningCount: 0, lastRunState: null });
    const summaries = (await new JobSummaryRepository(db, tenantId).page({ limit: 100, q: "" })).items;
    expect(summaries.find(job => job.id === jobIds[0])).toMatchObject({ runningCount: 5, lastRunState: "failed" });
    expect(summaries.find(job => job.id === jobIds[1])).toMatchObject({ runningCount: 0, lastRunState: null });
  });
  it("does not load another tenant's jobs", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const jobs = await new PostgresJobRepository(db, otherTenant, async v => v, async v => v).list();
      expect(jobs).toHaveLength(1); expect(jobs[0].triggers.map(t => t.slug)).toEqual(["private"]);
      expect(query).toHaveBeenCalledTimes(2);
      query.mockClear();
      expect(await new PostgresJobRepository(db, tenantId, async v => v, async v => v).list()).toHaveLength(10);
      expect(query).toHaveBeenCalledTimes(2);
    } finally { query.mockRestore(); }
  });
  it("validates cookie membership once and exposes timing plus the job name in run detail", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const response = await request(`/api/v1/runs/${runId}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Server-Timing")).toMatch(/auth;dur=[\d.]+, application;dur=[\d.]+/);
      expect(await response.json()).toMatchObject({ job_name: "Job-0", prompt: "Prompt", activity: [], trace_projection: null, trace_generation: null, harness_log: null });
      expect(query.mock.calls.filter(([sql]) => typeof sql === "string" && sql.includes("FROM app.members m JOIN app.auth_users"))).toHaveLength(1);
    } finally { query.mockRestore(); }
  });
  it("batches integration reads and never returns credentials", async () => {
    const query = vi.spyOn(db.pool, "query");
    try {
      const status = await new ApiService(env, auth).integrationStatus();
      expect(status.cloudflareTail.installations).toEqual([{ integrationId: "local", name: "Local", status: "connected", secretConfigured: true, referencedJobCount: 0 }]);
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
      expect(status.cloudflareTail.installations).toContainEqual({ integrationId: "legacy", name: "Unnamed Tail integration", status: "connected", secretConfigured: true, referencedJobCount: 0 });
      expect(JSON.stringify(status)).not.toContain("private-");
    } finally {
      await Promise.all([originalLinear ? connections.put("linear", originalLinear) : connections.delete("linear"), connections.delete("exe:legacy"), connections.delete("amp:legacy"), connections.delete("cloudflare-tail:legacy")]);
    }
  });

  it("creates a job with a deterministic migrated execution integration UUID", async () => {
    const target = "local";
    try {
      const job = await new ApiService(env, auth).createJob({ name: "Migrated target job", slug: "migrated-target-job", promptTemplate: "Do work", executionConfigId: target, vmImage: "ghcr.io/GenerationSoftware/anarack:ReleaseA", concurrencyLimit: 1, triggers: [{ kind: "manual", enabled: true, config: {} }] });
      expect(job.executionConfigId).toBe(target);
      expect(job).toMatchObject({ portableIntegrationIds: [], modelAccess: "native" });
      expect(job.executionConfig).toMatchObject({ connectionId: "local", agentKind: "codex" });
      expect(job.executionConfig.image).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
      const native = await new ApiService(env, auth).createJob({ name: "Native model job", slug: "native-model-job", promptTemplate: "Do work", executionConfigId: target, modelAccess: "native", concurrencyLimit: 1, triggers: [{ kind: "manual", enabled: true, config: {} }] });
      expect(native).toMatchObject({ modelAccess: "native", portableIntegrationIds: [] });
    } finally {
      await db.pool.query("DELETE FROM app.jobs WHERE execution_config->>'targetId'=$1", [target]);
    }
  });
  it("persists explicit integration and model selections and snapshots them at invocation", async () => {
    const service = new ApiService(env, auth);
    const write = async (kind: "bearer" | "model", name: string, owner = tenantId) => {
      const repository = new EncryptedIntegrationRepository(db, owner, env.CREDENTIAL_ENCRYPTION_KEY), id = crypto.randomUUID();
      await repository.write({ id, idempotencyKey: crypto.randomUUID(), expectedRevision: await repository.revision(), operation: "upsert", kind, name, origin: kind === "bearer" ? "https://api.example.test" : null, description: null, encryptedPayload: await encrypt("fixture", env.CREDENTIAL_ENCRYPTION_KEY) });
      return id;
    };
    const bearerA = await write("bearer", "Tools A"), bearerB = await write("bearer", "Tools B");
    const accountA = await write("model", "Account A"), accountB = await write("model", "Account B"), foreignAccount = await write("model", "Foreign Account", otherTenant);
    await new FlyConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY).save({ organizationSlug: "fixture", organizationName: "Fixture" }, "fixture-token");
    const execution = await new FlyExecutionConfigurationRepository(db, tenantId).save({ name: "Fixture", image: "ghcr.io/example/agent:latest", region: "iad", size: "shared-cpu-1x" });
    const base = { name: "Portable", slug: `portable-${crypto.randomUUID().slice(0, 8)}`, promptTemplate: "Do work", executionConfigId: execution.id, concurrencyLimit: 1, triggers: [{ kind: "manual" as const, enabled: true, config: {} }] };
    try {
      await expect(service.createJob({ ...base, modelAccountId: foreignAccount })).rejects.toMatchObject({ status: 400 });
      const job = await service.createJob({ ...base, portableIntegrationIds: [bearerA], modelAccess: "portable", modelAccountId: accountA });
      expect(job).toMatchObject({ portableIntegrationIds: [bearerA], modelAccess: "portable", modelAccountId: accountA });
      expect(job.executionConfig).toMatchObject({ region: "iad", size: "shared-cpu-1x" });
      const invoked = await service.invokeJob(job.id, { prompt: "run", data: {} });
      const snapshot = (await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, invoked.runId])).rows[0].execution_config;
      expect(snapshot).toMatchObject({ portableIntegrationIds: [bearerA], modelAccess: "portable", modelAccountId: accountA });
      const updated = await service.updateJob(job.id, { ...base, portableIntegrationIds: [bearerB], modelAccess: "portable", modelAccountId: accountB });
      expect(updated).toMatchObject({ portableIntegrationIds: [bearerB], modelAccountId: accountB });
      expect((await db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, invoked.runId])).rows[0].execution_config).toEqual(snapshot);
      const omitted = await service.updateJob(job.id, { ...base });
      expect(omitted).toMatchObject({ portableIntegrationIds: [bearerB], modelAccess: "portable", modelAccountId: accountB });
      await expect(service.createJob({ ...base, portableIntegrationIds: [foreignAccount], modelAccess: "native" })).rejects.toMatchObject({ status: 400 });
      const code = await service.createJob({ ...base, name: "Code", slug: `code-${crypto.randomUUID().slice(0, 8)}`, executionType: "code", script: "echo ok" });
      expect(code).toMatchObject({ modelAccess: "native", portableIntegrationIds: [] });
      await expect(service.createJob({ ...base, name: "Needs account", slug: `need-${crypto.randomUUID().slice(0, 8)}`, modelAccess: "portable" })).rejects.toMatchObject({ status: 400 });
    } finally {
      await db.pool.query("DELETE FROM app.jobs WHERE tenant_id=$1 AND (slug LIKE 'portable-%' OR slug LIKE 'code-%' OR slug LIKE 'need-%')", [tenantId]);
      await db.pool.query("DELETE FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id=$2", [tenantId, execution.id]);
      await new FlyConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY).remove();
    }
  });
  it("enforces tenant and scope boundaries, email verification, cookie expiry and session revocation", async () => {
    await expect(new ApiService(env, { ...auth, tenantId: otherTenant }).listJobs()).rejects.toMatchObject({ status: 401 });
    await expect(new ApiService(env, { ...auth, scopes: ["runs:read"] }).listJobs()).rejects.toMatchObject({ status: 403 });
    const expired = await signSession({ ...auth, email: "owner@example.test", exp: 1 }, env.SESSION_SIGNING_SECRET);
    expect((await request("/api/v1/jobs", `factorize_session=${expired}`)).status).toBe(401);
    expect((await request("/api/v1/jobs", cookie + "tampered")).status).toBe(401);
    await db.pool.query("UPDATE app.auth_users SET email_verified=false WHERE id=$1", [userId]);
    expect((await request("/api/v1/jobs")).status).toBe(401);
    await db.pool.query("UPDATE app.auth_users SET email_verified=true WHERE id=$1", [userId]);
    await new IdentityRepository(db, tenantId).revoke(userId);
    expect((await request("/api/v1/jobs")).status).toBe(401);
    await db.pool.query("UPDATE app.members SET session_version=$3 WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId, auth.sessionVersion]);
  });
  it("checks token revocation and expiry independently of membership", async () => {
    const service = new ApiService(env, auth), issued: any = await service.createAccessToken({ name: "test", scopes: ["flows:read"], expiryDays: 7 });
    const tokenAuth = { ...auth, scopes: ["flows:read"], authMethod: "access_token" as const, accessTokenId: issued.id };
    const bearer = () => worker.fetch(new Request("https://factorize.test/api/v1/jobs", { headers: { Authorization: `Bearer ${issued.token}` } }), env, { waitUntil() {} } as any);
    expect(await new ApiService(env, tokenAuth).listJobs()).toHaveLength(10);
    expect((await bearer()).status).toBe(200);
    await db.pool.query("UPDATE app.access_tokens SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenantId, issued.id]);
    await expect(new ApiService(env, tokenAuth).listJobs()).rejects.toMatchObject({ status: 401 });
    expect((await bearer()).status).toBe(401);
    await db.pool.query("UPDATE app.access_tokens SET expires_at=now()+interval '1 day',revoked_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, issued.id]);
    await expect(new ApiService(env, tokenAuth).listJobs()).rejects.toMatchObject({ status: 401 });
    expect((await bearer()).status).toBe(401);
  });
});

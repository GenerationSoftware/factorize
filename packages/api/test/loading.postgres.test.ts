import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { Database } from "../src/postgres/database";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { PostgresJobRepository } from "../src/postgres/job-repository";
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
  beforeAll(async () => { fixture = await loadingFixture(url!); ({ db, env, auth, cookie, jobIds, runId, tenantId, userId, otherTenant, request } = fixture); });
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

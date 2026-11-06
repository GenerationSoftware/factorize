import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";
import { authenticateRunCredential, issueRunCredential, RUN_SCOPES } from "../src/run-credentials";
import { normalizeScopes } from "../src/access-tokens";
import type { OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("configurable run scopes with PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(url!); });
  afterAll(async () => { await fixture?.cleanup(); });
  function request(path: string, auth: OAuthProps, body?: unknown) {
    return protectedApiFetch(new Request(fixture.env.APP_ORIGIN + path, {
      method: body === undefined ? "GET" : "PUT",
      headers: { "Content-Type": "application/json", Origin: fixture.env.APP_ORIGIN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), fixture.env, auth, { waitUntil() {} } as any);
  }
  const owner = (method: OAuthProps["authMethod"] = "session"): OAuthProps => ({ ...fixture.auth, authMethod: method, scopes: ["jobs:read", "jobs:write"] });
  async function updateBody(jobId: string) {
    const response = await request(`/api/v1/jobs/${jobId}`, owner());
    expect(response.status).toBe(200);
    const job: any = await response.json();
    return { name: job.name, slug: job.slug.toLowerCase(), promptTemplate: job.promptTemplate,
      executionConfigId: "local", concurrencyLimit: job.concurrencyLimit,
      expectedUpdatedAt: job.updatedAt };
  }

  it.each(["session", "access_token", "oauth"] as const)("saves run scopes with a scoped %s and preserves them when legacy clients omit the field", async method => {
    const id = fixture.jobIds[2];
    const saved = await request(`/api/v1/jobs/${id}`, owner(method), { ...await updateBody(id), runScopes: ["jobs:read", "jobs:write"] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ runScopes: ["jobs:read", "jobs:write"] });
    const omitted = await request(`/api/v1/jobs/${id}`, owner(method), await updateBody(id));
    expect(omitted.status).toBe(200);
    expect(await omitted.json()).toMatchObject({ runScopes: ["jobs:read", "jobs:write"] });
  });

  it("rejects missing write authority, unknown scopes, and duplicate scopes before changing the job", async () => {
    const id = fixture.jobIds[3], body = await updateBody(id);
    expect((await request(`/api/v1/jobs/${id}`, { ...owner(), scopes: ["jobs:read"] }, { ...body, runScopes: ["jobs:write"] })).status).toBe(403);
    for (const runScopes of [["jobs:admin"], ["jobs:write", "jobs:write"]]) {
      expect((await request(`/api/v1/jobs/${id}`, owner(), { ...body, runScopes })).status).toBe(400);
    }
    const saved: any = await (await request(`/api/v1/jobs/${id}`, owner())).json();
    expect(saved.runScopes).toEqual(RUN_SCOPES);
  });

  it("allows an orchestration run to change job scopes without upgrading its own active credential", async () => {
    const { tenantId, runId, env, db } = fixture;
    await db.pool.query("UPDATE app.job_runs SET state='running' WHERE tenant_id=$1 AND id=$2", [tenantId, runId]);
    const bearer = (token: string) => new Request(env.APP_ORIGIN, { headers: { Authorization: `Bearer ${token}` } });
    const token = await issueRunCredential(env, tenantId, runId, ["jobs:write"]);
    const auth = (await authenticateRunCredential(bearer(token), env))!;
    expect(auth.scopes).toEqual(["jobs:write"]);
    const id = fixture.jobIds[0];
    const updated = await request(`/api/v1/jobs/${id}`, auth, { ...await updateBody(id), runScopes: ["jobs:write", "integrations:write"] });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ runScopes: ["jobs:write", "integrations:write"] });
    const foreignJob = await db.pool.query("SELECT run_scopes FROM app.jobs WHERE tenant_id=$1 AND id=$2", [fixture.otherTenant, id]);
    expect(foreignJob.rows[0].run_scopes).toEqual(RUN_SCOPES);
    expect((await authenticateRunCredential(bearer(token), env))?.scopes).toEqual(["jobs:write"]);
    const rotated = await issueRunCredential(env, tenantId, runId, ["jobs:write", "integrations:write"]);
    expect(await authenticateRunCredential(bearer(token), env)).toBeNull();
    expect((await authenticateRunCredential(bearer(rotated), env))?.scopes).toEqual(["jobs:write"]);
    const foreign = crypto.randomUUID();
    expect((await request(`/api/v1/jobs/${foreign}`, auth, { ...await updateBody(id), runScopes: [] })).status).toBe(404);
  });

  it("attributes an explicitly granted run error report to the execution credential", async () => {
    const { tenantId, env, db } = fixture;
    const source = (await db.pool.query("SELECT id FROM app.job_runs WHERE tenant_id=$1 AND state='running' AND id<>$2 LIMIT 1", [tenantId, fixture.runId])).rows[0].id;
    const token = await issueRunCredential(env, tenantId, source, ["runs:write"]);
    const auth = (await authenticateRunCredential(new Request(env.APP_ORIGIN, { headers: { Authorization: `Bearer ${token}` } }), env))!;
    const result = await protectedApiFetch(new Request(env.APP_ORIGIN + `/api/v1/runs/${source}/report-error`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Orchestrator detected a problem" }),
    }), env, auth, {} as any);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ reported: true });
    const saved = await db.pool.query("SELECT agent_error_reporter_kind,agent_error_reporter_id FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, source]);
    expect(saved.rows[0]).toEqual({ agent_error_reporter_kind: "run_token", agent_error_reporter_id: source });
  });

  it("supports empty scopes, normalizes legacy run access, and keeps identity introspection authenticated", async () => {
    const id = fixture.jobIds[4];
    const saved = await request(`/api/v1/jobs/${id}`, owner(), { ...await updateBody(id), runScopes: [] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ runScopes: [] });
    const unscoped = { ...owner("oauth"), scopes: [] };
    const context = await request("/api/v1/runtime-context", unscoped);
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ scopes: [] });
    expect((await request(`/api/v1/jobs/${id}`, unscoped)).status).toBe(403);
    expect((await request("/api/v1/runtime-context", { ...unscoped, userId: crypto.randomUUID() })).status).toBe(401);
    expect(normalizeScopes(["runs:write"])).toEqual(expect.arrayContaining(["runs:read", "runs:invoke", "runs:cancel", "runs:write"]));
  });
});

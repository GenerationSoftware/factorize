import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";
import { DEFAULT_RUN_SCOPES as RUN_SCOPES } from "../src/run-scopes";
import {snapshotRunAuthorization} from "../src/run-authorizations";
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
  const owner = (method: OAuthProps["authMethod"] = "session"): OAuthProps => ({ ...fixture.auth, authMethod: method, scopes: ["triggers:read", "triggers:write"] });
  async function updateBody(triggerId: string) {
    const response = await request(`/api/v1/triggers/${triggerId}`, owner());
    expect(response.status).toBe(200);
    const trigger: any = await response.json();
    return { name: trigger.name.toLowerCase(),  prompt: trigger.prompt,
      executionConfigId: "local", concurrencyLimit: trigger.concurrencyLimit,
      expectedUpdatedAt: trigger.updatedAt };
  }

  it.each(["session", "access_token", "oauth"] as const)("saves run scopes with a scoped %s and preserves them when legacy clients omit the field", async method => {
    const id = fixture.triggerIds[2];
    const saved = await request(`/api/v1/triggers/${id}`, owner(method), { ...await updateBody(id), runScopes: ["triggers:read", "triggers:write"] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ runScopes: ["triggers:read", "triggers:write"] });
    const omitted = await request(`/api/v1/triggers/${id}`, owner(method), await updateBody(id));
    expect(omitted.status).toBe(200);
    expect(await omitted.json()).toMatchObject({ runScopes: ["triggers:read", "triggers:write"] });
  });

  it("rejects missing write authority, unknown scopes, and duplicate scopes before changing the trigger", async () => {
    const id = fixture.triggerIds[3], body = await updateBody(id);
    expect((await request(`/api/v1/triggers/${id}`, { ...owner(), scopes: ["triggers:read"] }, { ...body, runScopes: ["triggers:write"] })).status).toBe(403);
    for (const runScopes of [["triggers:admin"], ["triggers:write", "triggers:write"]]) {
      expect((await request(`/api/v1/triggers/${id}`, owner(), { ...body, runScopes })).status).toBe(400);
    }
    const saved: any = await (await request(`/api/v1/triggers/${id}`, owner())).json();
    expect(saved.runScopes).toEqual(RUN_SCOPES);
  });

  it("allows an orchestration run to change trigger scopes without upgrading its own active credential", async () => {
    const { tenantId, runId, env, db } = fixture;
    await db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2", [tenantId, runId]);
    await snapshotRunAuthorization(db,{tenantId,runId,scopes:["triggers:write"]});
    const auth: OAuthProps = {...fixture.auth,authMethod:"vendor_identity",runId,runTriggerId:fixture.triggerIds[0],runIdentityProvider:"fly.io",scopes:["triggers:write"]};
    expect(auth.scopes).toEqual(["triggers:write"]);
    const id = fixture.triggerIds[0];
    const updated = await request(`/api/v1/triggers/${id}`, auth, { ...await updateBody(id), runScopes: ["triggers:write", "integrations:write"] });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ runScopes: ["triggers:write", "integrations:write"] });
    const foreignTrigger = await db.pool.query("SELECT run_scopes FROM app.triggers WHERE tenant_id=$1 AND id=$2", [fixture.otherTenant, id]);
    expect(foreignTrigger.rows[0].run_scopes).toEqual(RUN_SCOPES);
    await snapshotRunAuthorization(db,{tenantId,runId,scopes:["triggers:write","integrations:write"]});
    expect((await db.pool.query("SELECT scopes FROM app.run_authorizations WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows[0].scopes).toEqual(["triggers:write"]);
    const foreign = crypto.randomUUID();
    expect((await request(`/api/v1/triggers/${foreign}`, auth, { ...await updateBody(id), runScopes: [] })).status).toBe(404);
  });

  it("attributes an explicitly granted run error report to the execution credential", async () => {
    const { tenantId, env, db } = fixture;
    const source = (await db.pool.query("SELECT id FROM app.trigger_runs WHERE tenant_id=$1 AND state='running' AND id<>$2 LIMIT 1", [tenantId, fixture.runId])).rows[0].id;
    const auth: OAuthProps = {...fixture.auth,authMethod:"vendor_identity",runId:source,runIdentityProvider:"fly.io",scopes:["runs:read", "runs:invoke", "runs:cancel", "runs:write"]};
    const result = await protectedApiFetch(new Request(env.APP_ORIGIN + `/api/v1/runs/${source}/report-error`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Orchestrator detected a problem" }),
    }), env, auth, {} as any);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ reported: true });
    const saved = await db.pool.query("SELECT agent_error_reporter_kind,agent_error_reporter_id FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenantId, source]);
    expect(saved.rows[0]).toEqual({ agent_error_reporter_kind: "run_token", agent_error_reporter_id: source });
  });

  it("supports empty scopes, keeps run write access explicit, and keeps identity introspection authenticated", async () => {
    const id = fixture.triggerIds[4];
    const saved = await request(`/api/v1/triggers/${id}`, owner(), { ...await updateBody(id), runScopes: [] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ runScopes: [] });
    const unscoped = { ...owner("oauth"), scopes: [] };
    const context = await request("/api/v1/runtime-context", unscoped);
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ scopes: [] });
    expect((await request(`/api/v1/triggers/${id}`, unscoped)).status).toBe(403);
    expect((await request("/api/v1/runtime-context", { ...unscoped, userId: crypto.randomUUID() })).status).toBe(401);
    expect(normalizeScopes(["runs:write"])).toEqual(["runs:write"]);
  });
});

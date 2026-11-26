import { expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;

it.skipIf(!url)("preserves blocked integrations through a connection permission edit until explicitly re-enabled", async () => {
  const f = await loadingFixture(url!);
  try {
    const [linear, github] = [crypto.randomUUID(), crypto.randomUUID()];
    const [linearScope, githubScope] = [`integration:${linear}:1`, `integration:${github}:1`];
    const blocked = { [linear]: false, [github]: false };
    const grantId = "fixture-grant";
    const readScopes = ["team:read", "proxy:use"];
    Object.assign(f.env, { OAUTH_PROVIDER: {
      listUserGrants: async () => ({ items: [{
        id: grantId, clientId: "fixture-client", metadata: { tenantId: f.tenantId },
        scope: [...readScopes, linearScope, githubScope], createdAt: Math.floor(Date.now() / 1000),
      }] }),
      lookupClient: async () => ({ clientName: "Fixture client" }),
    } });
    await f.db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy)
      VALUES ($1,$2,'linear','linear','Linear',true,'baseline'), ($1,$3,'github','123','GitHub',true,'requestable')`, [f.tenantId, linear, github]);
    await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,integration_overrides,permissions_revision)
      VALUES ($1,'oauth',$2,$3,$4,$5,1)`, [f.tenantId, grantId, f.userId, f.auth.sessionVersion, JSON.stringify(blocked)]);

    const fetch = (path: string, method: string, body?: object) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path, {
      method, headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), f.env, f.auth, {} as ExecutionContext);
    const read = async () => {
      const response = await fetch("/api/v1/access/authorized-clients", "GET");
      expect(response.status, await response.clone().text()).toBe(200);
      const [client] = await response.json() as { scopes: string[]; availableScopes: string[]; revision: number; pendingScopes: string[] }[];
      return client;
    };
    const save = async (body: object) => {
      const response = await fetch(`/api/v1/access/authorizations/${grantId}/permissions`, "PUT", body);
      expect(response.status, await response.text()).toBe(200);
    };

    const initial = await read();
    expect(initial).toMatchObject({ scopes: readScopes, revision: 1, pendingScopes: [] });
    expect(initial.availableScopes).toEqual(expect.arrayContaining([linearScope, githubScope]));
    await save({ scopes: initial.scopes, expectedRevision: initial.revision });
    const saved = await read();
    expect(saved).toMatchObject({ scopes: readScopes, revision: 2, pendingScopes: [] });

    const updatedScopes = [...saved.scopes, "team:write"];
    await save({ scopes: updatedScopes, expectedRevision: saved.revision });
    const edited = await read();
    expect(edited).toMatchObject({ scopes: updatedScopes, revision: 3, pendingScopes: ["team:write"] });

    await save({
      scopes: [...edited.scopes, linearScope], expectedRevision: edited.revision,
    });
    const reenabled = await read();
    expect(reenabled).toMatchObject({ scopes: [...updatedScopes, linearScope], revision: 4 });
    expect(reenabled.pendingScopes).toEqual(["team:write", linearScope]);
    expect(reenabled.scopes).not.toContain(githubScope);
  } finally {
    await f.cleanup();
  }
});


it.skipIf(!url)("renames only the selected connection and preserves policy before and after identity creation", async () => {
  const f = await loadingFixture(url!);
  try {
    const integrationId = crypto.randomUUID(), scope = `integration:${integrationId}:1`;
    const grantId = "rename-fixture";
    await f.db.pool.query("UPDATE app.auth_users SET username=$1 WHERE id=$2", ["actual-owner", f.userId]);
    const now = Math.floor(Date.now() / 1000);
    const grants = [
      { id: grantId, metadata: { tenantId: f.tenantId, initialIntegrationDenials: [integrationId] }, expiresAt: now + 86400 },
      { id: "sibling", metadata: { tenantId: f.tenantId } },
      { id: "other-team", metadata: { tenantId: f.otherTenant } },
      { id: "expired-grant", metadata: { tenantId: f.tenantId }, expiresAt: now - 1 },
    ].map(grant => ({ ...grant, clientId: "same-app", scope: ["proxy:use", scope], createdAt: now }));
    Object.assign(f.env, { OAUTH_PROVIDER: {
      listUserGrants: async (userId: string) => {
        expect(userId).toBe(f.userId);
        return { items: grants };
      },
      lookupClient: async () => ({ clientName: "Registered app" }),
    } });
    await f.db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy)
      VALUES ($1,$2,'github','123','GitHub',true,'baseline')`, [f.tenantId, integrationId]);
    const request = (path: string, body?: object, auth = f.auth) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path, {
      method: body ? "PUT" : "GET", headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    }), f.env, auth, {} as ExecutionContext);
    const rename = (id: string, name: string, auth = f.auth) => request(`/api/v1/access/authorizations/${id}/name`, { name }, auth);
    const clients = async () => (await request("/api/v1/access/authorized-clients")).json() as Promise<unknown[]>;

    expect((await rename("other-team", "Out of scope")).status).toBe(404);
    expect((await rename(grantId, "   ")).status).toBe(400);
    expect((await rename(grantId, "Non-interactive", { ...f.auth, authMethod: "oauth" })).status).toBe(403);
    const response = await rename(grantId, "  Release assistant  ");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ name: "Release assistant" });
    expect(await clients()).toEqual(expect.arrayContaining([
      expect.objectContaining({ grantId, clientName: "Release assistant", appName: "Registered app", ownerUsername: "actual-owner", scopes: ["proxy:use"], revision: 0, pendingScopes: [], authorizationDate: new Date(now * 1000).toISOString(), expiresAt: new Date((now + 86400) * 1000).toISOString() }),
      expect.objectContaining({ grantId: "sibling", clientName: "Registered app", ownerUsername: "actual-owner", expiresAt: null }),
      expect.objectContaining({ grantId: "expired-grant", credentialScopes: [] }),
    ]));
    expect((await request("/api/v1/access/authorized-clients", undefined, { ...f.auth, authMethod: "oauth" })).status).toBe(403);

    const permissions = await request(`/api/v1/access/authorizations/${grantId}/permissions`, { scopes: ["team:read"], expectedRevision: 0 });
    expect(permissions.status, await permissions.text()).toBe(200);
    expect((await rename(grantId, "Updated name")).status).toBe(200);
    expect(await clients()).toContainEqual(expect.objectContaining({
      grantId, clientName: "Updated name", scopes: ["team:read"], revision: 1, pendingScopes: ["team:read"],
    }));
  } finally {
    await f.cleanup();
  }
});

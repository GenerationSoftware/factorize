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
      const [client] = await response.json() as { scopes: string[]; availableScopes: string[]; revision: number; integrationOverrides: Record<string, string | false> }[];
      return client;
    };
    const save = async (body: object) => {
      const response = await fetch(`/api/v1/access/authorizations/${grantId}/permissions`, "PUT", body);
      expect(response.status, await response.text()).toBe(200);
    };

    const initial = await read();
    expect(initial).toMatchObject({ scopes: readScopes, revision: 1, integrationOverrides: blocked });
    expect(initial.availableScopes).toEqual(expect.arrayContaining([linearScope, githubScope]));
    await save({ scopes: initial.scopes, expectedRevision: initial.revision });
    const saved = await read();
    expect(saved).toMatchObject({ scopes: readScopes, revision: 2, integrationOverrides: blocked });

    const updatedScopes = [...saved.scopes, "team:write"];
    await save({ scopes: updatedScopes, expectedRevision: saved.revision });
    const edited = await read();
    expect(edited).toMatchObject({ scopes: updatedScopes, revision: 3, integrationOverrides: blocked });

    await save({
      scopes: [...edited.scopes, linearScope], expectedRevision: edited.revision,
      integrationOverrides: { [linear]: linearScope },
    });
    const reenabled = await read();
    expect(reenabled).toMatchObject({ scopes: [...updatedScopes, linearScope], revision: 4 });
    expect(reenabled.integrationOverrides).toEqual({ [github]: false });
  } finally {
    await f.cleanup();
  }
});

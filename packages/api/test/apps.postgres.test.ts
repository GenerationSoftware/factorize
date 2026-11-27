import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/api-service";
import { accessTokenDigest } from "../src/access-tokens";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("Registered apps", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(url!); });
  afterAll(async () => { await f?.cleanup(); });

  it("permits scoped OAuth management and isolates registrations and browser-issued secrets", async () => {
    const input = { name: "Server app", redirectUris: ["https://server.example/callback"] };
    const oauth = new ApiService(f.env, { ...f.auth, authMethod: "oauth", scopes: ["apps:manage"] });
    const unscoped = new ApiService(f.env, { ...f.auth, authMethod: "oauth", scopes: ["team:write"] });
    const browser = new ApiService(f.env, { ...f.auth, scopes: ["apps:manage", "team:read", "team:write"] });
    await expect(unscoped.apps.createApp(input)).rejects.toMatchObject({ status: 403 });
    const app = await oauth.apps.createApp(input);
    expect(app).toMatchObject({ enabled: true, public: false, secretConfigured: false });
    expect(await oauth.apps.getApp(app.id)).toEqual(app);
    await expect(oauth.apps.rotateAppSecret(app.id)).rejects.toMatchObject({ status: 403 });
    const first = await browser.apps.rotateAppSecret(app.id);
    const second = await browser.apps.rotateAppSecret(app.id);
    expect(first.clientSecret).not.toBe(second.clientSecret);
    const stored = await f.db.pool.query("SELECT secret_digest FROM app.oauth_apps WHERE id=$1", [app.id]);
    expect(stored.rows[0].secret_digest).toBe(await accessTokenDigest(second.clientSecret));
    expect(await oauth.apps.getApp(app.id)).toMatchObject({ secretConfigured: true });
    expect(await oauth.apps.getApp(app.id)).not.toHaveProperty("clientSecret");
    const response = await f.request("/api/v1/apps/" + app.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: app.id, secretConfigured: true });
    const owner = await f.db.pool.query("SELECT email FROM app.members WHERE tenant_id=$1 AND user_id=$2", [f.tenantId, f.userId]);
    await f.db.pool.query("INSERT INTO app.members(tenant_id,user_id,email,role,session_version) VALUES($1,$2,$3,'owner',$4)",
      [f.otherTenant, f.userId, owner.rows[0].email, f.auth.sessionVersion]);
    const other = new ApiService(f.env, { ...f.auth, tenantId: f.otherTenant, authMethod: "oauth", scopes: ["apps:manage"] });
    await expect(other.apps.getApp(app.id)).rejects.toMatchObject({ status: 404 });

    await f.db.pool.query(`INSERT INTO app.oauth_app_connections(app_id,tenant_id,user_id,session_version,scopes)
      VALUES($1,$2,$3,$4,ARRAY['openid'])`, [app.id, f.tenantId, f.userId, f.auth.sessionVersion]);
    expect(await browser.apps.listConnectedApps()).toMatchObject([{ appId: app.id, name: app.name, scopes: ["openid"] }]);
    await oauth.apps.updateApp(app.id, { ...input, public: true, enabled: false });
    expect(await browser.apps.listConnectedApps()).toEqual([]);
  });
});

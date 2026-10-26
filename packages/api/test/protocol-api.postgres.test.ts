import worker from "../src/worker";
import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";
import { deviceAuthorization } from "../src/device-oauth";
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("cookie protocol APIs against PostgreSQL", () => {
  it("lists skills and their usage through an existing browser session", async () => {
    const f = await loadingFixture(url!);
    try {
      const request = (body?: unknown) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/skills", {
        method: body ? "POST" : "GET",
        headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), f.env, {} as ExecutionContext);
      const empty = await request();
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({ items: [], nextCursor: null });
      const created = await request({ key: "review", body: "Review carefully" });
      expect(created.status).toBe(201);
      const skill = await created.json() as { id: string };
      const detail = await worker.fetch(new Request(f.env.APP_ORIGIN + `/api/v1/skills/${skill.id}`, { headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN } }), f.env, {} as ExecutionContext);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ id: skill.id, key: "review", body: "Review carefully", revision: 1, usageCount: 0 });
      await f.db.pool.query("INSERT INTO app.job_skills(tenant_id,job_id,skill_id,position) VALUES($1,$2,$3,0)", [f.tenantId, f.jobIds[0], skill.id]);
      const listed = await request();
      expect(listed.status).toBe(200);
      const page = await listed.json() as { items: Record<string, unknown>[]; nextCursor: string | null };
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ id: skill.id, key: "review", revision: 1, usageCount: 1 });
      expect(page.items[0]).not.toHaveProperty("body");
      expect(page.nextCursor).toBeNull();
    } finally { await f.cleanup(); }
  });

  it("checks real owner/session version before consent and rejects revoked sessions", async () => {
    const f = await loadingFixture(url!);
    try {
      const parsed = { responseType: "code", clientId: "client", redirectUri: "https://external.test/callback", scope: ["flows:read"], state: "state", codeChallenge: "challenge", codeChallengeMethod: "S256", resource: f.env.APP_ORIGIN + "/mcp", issuer: f.env.APP_ORIGIN };
      const oauth = { parseAuthRequest: async () => parsed, lookupClient: async () => ({ clientId: "client", clientName: "CLI", redirectUris: [parsed.redirectUri] }), completeAuthorization: vi.fn(async (_input: unknown) => ({ redirectTo: parsed.redirectUri + "?code=issued" })) };
      f.env.OAUTH_PROVIDER = oauth as any;
      const request = (path: string, body: unknown, cookie = f.cookie) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path, { method: "POST", headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) }), f.env, null, {} as ExecutionContext);
      const previewResponse = await request("/api/v1/oauth/consent/preview", { authorizationQuery: "client_id=client" }); expect(previewResponse.status).toBe(200); const preview = await previewResponse.json() as any;
      const input = { request: preview.request, signature: preview.signature, scopes: ["flows:read"], decision: "allow" };
      expect((await request("/api/v1/oauth/consent/decision", input)).status).toBe(200); expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
      await f.db.pool.query("UPDATE app.members SET session_version=session_version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenantId, f.userId]);
      expect((await request("/api/v1/oauth/consent/decision", input)).status).toBe(401); expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
  it("locks racing device approvals, issues one grant and never publishes its code to the browser", async () => {
    const f = await loadingFixture(url!);
    try {
      const oauth = { lookupClient: async () => ({ clientId: "client", clientName: "CLI", redirectUris: ["https://external.test/callback"], tokenEndpointAuthMethod: "none" }), completeAuthorization: vi.fn(async (_input: unknown) => ({ redirectTo: "https://external.test/callback?code=issued" })) };
      f.env.OAUTH_PROVIDER = oauth as any;
      const form = new FormData(); form.set("client_id", "client"); form.set("scope", "flows:read");
      const issued = await (await deviceAuthorization(new Request(f.env.APP_ORIGIN + "/oauth/device_authorization", { method: "POST", body: form }), f.env, oauth as any, ["flows:read"])).json() as any;
      const request = (path: string, body: unknown) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path, { method: "POST", headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) }), f.env, null, {} as ExecutionContext);
      const preview = await (await request("/api/v1/oauth/device/preview", { userCode: issued.user_code })).json() as any; expect(preview.clientName).toBe("CLI"); expect(preview.device_code).toBeUndefined();
      const responses = await Promise.all([request("/api/v1/oauth/device/decision", { userCode: issued.user_code, signature: preview.signature, decision: "allow" }), request("/api/v1/oauth/device/decision", { userCode: issued.user_code, signature: preview.signature, decision: "allow" })]);
      expect(responses.map(r => r.status).sort()).toEqual([200, 400]); expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
      const successful = await responses.find(r => r.status === 200)!.json(); expect(successful).toEqual({ status: "approved" });
      const row = (await f.db.pool.query("SELECT record FROM app.oauth_device_authorizations WHERE device_code=$1", [issued.device_code])).rows[0]; expect(row.record.authorizationCode).toBe("issued"); expect(row.record.status).toBe("approved");
    } finally { await f.cleanup(); }
  });
});

import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { hashPassword } from "../src/auth";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class { constructor(protected ctx: unknown, protected env: unknown) {} },
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}));

// Keep the real OAuth provider and request routing. Only replace its
// Cloudflare KV binding; all credentials belong to this disposable fixture.
function localKV() {
  const values = new Map<string, string>();
  return {
    async get(key: string, options?: string | { type?: string }) {
      const value = values.get(key);
      return value === undefined ? null : (options === "json" || typeof options === "object" && options.type === "json") ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
    async list({ prefix = "" } = {}) {
      return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true };
    },
  } as unknown as KVNamespace;
}

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("browser-only sign-out", () => {
  it("keeps an independent browser and MCP access/refresh grants until explicit client revocation", async () => {
    const f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
    try {
      delete f.env.OAUTH_PROVIDER; // Use the real provider helpers.
      f.env.OAUTH_KV = localKV();
      const origin = f.env.APP_ORIGIN, resource = origin + "/mcp", password = "fixture browser password";
      await f.db.pool.query(`INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash)
        VALUES ($1,$2,'credential',$3,$4)`, [crypto.randomUUID(), f.userId, f.userId, await hashPassword(password)]);
      const call = (path: string, method: string, headers: Record<string, string> = {}, body?: string) =>
        worker.fetch(new Request(origin + path, { method, headers: { Host: new URL(origin).host, ...headers }, body }), f.env, { waitUntil() {} } as unknown as ExecutionContext);
      const json = (path: string, value: object, headers: Record<string, string> = {}) =>
        call(path, "POST", { Origin: origin, "Content-Type": "application/json", ...headers }, JSON.stringify(value));
      const form = (path: string, value: Record<string, string>) =>
        call(path, "POST", { "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams(value).toString());
      const login = async () => {
        const response = await json("/api/v1/auth/login", { email: "owner@example.test", password });
        expect(response.status, await response.clone().text()).toBe(200);
        return { Cookie: response.headers.getSetCookie().find(value => value.startsWith("factorize_session="))!.split(";")[0] };
      };
      const browser = await login(), otherBrowser = await login();
      expect(browser.Cookie).not.toBe(otherBrowser.Cookie);

      const redirect = "http://127.0.0.1/callback";
      const registration = await json("/oauth/register", {
        client_name: "Local OAuth fixture", redirect_uris: [redirect], token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      });
      expect(registration.status).toBe(201);
      const { client_id } = await registration.json() as { client_id: string };
      const verifier = randomBytes(32).toString("base64url");
      const query = new URLSearchParams({
        response_type: "code", client_id, redirect_uri: redirect, state: "fixture-state", scope: "triggers:read",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource,
      }).toString();
      await f.db.pool.query("INSERT INTO app.team_permission_defaults(tenant_id,permission,enabled) VALUES($1,'triggers:read',true)", [f.tenantId]);
      const previewResult = await json("/api/v1/oauth/consent/preview", { authorizationQuery: query }, browser);
      expect(previewResult.status).toBe(200);
      const { request, signature, selectedScopes: scopes } = await previewResult.json() as { request: string; signature: string; selectedScopes: string[] };
      const decision = await json("/api/v1/oauth/consent/decision", { request, signature, decision: "allow", scopes }, browser);
      expect(decision.status).toBe(200);
      const { redirectTo } = await decision.json() as { redirectTo: string };
      const code = new URL(redirectTo).searchParams.get("code")!;
      const exchange = await form("/oauth/token", { grant_type: "authorization_code", client_id, code, redirect_uri: redirect, code_verifier: verifier, resource });
      expect(exchange.status).toBe(200);
      const tokens = await exchange.json() as { access_token: string; refresh_token: string };
      const listTriggers = (token: string) => json("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_triggers", arguments: {} } }, {
        Authorization: "Bearer " + token, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25",
      });
      const expectWorking = async (token: string) => {
        const response = await listTriggers(token);
        expect(response.status, await response.clone().text()).toBe(200);
        const text = await response.text();
        expect(JSON.parse(text.startsWith("{") ? text : text.split("\n").find(line => line.startsWith("data: "))!.slice(6))).toMatchObject({ result: { structuredContent: { items: [] } } });
      };
      const refresh = (refresh_token: string) => form("/oauth/token", { grant_type: "refresh_token", client_id, refresh_token, resource });
      await expectWorking(tokens.access_token);

      const logout = await json("/api/v1/auth/logout", {}, browser);
      expect(logout.status).toBe(200);
      expect(logout.headers.getSetCookie()).toEqual(expect.arrayContaining([expect.stringMatching(/^factorize_session=;.*Max-Age=0/)]));
      expect(await (await call("/api/v1/session", "GET", browser)).json()).toEqual({ authenticated: false });
      expect(await (await call("/api/v1/session", "GET", otherBrowser)).json()).toMatchObject({ authenticated: true });
      await expectWorking(tokens.access_token);
      const refreshed = await refresh(tokens.refresh_token);
      expect(refreshed.status).toBe(200);
      const updated = await refreshed.json() as typeof tokens;
      await expectWorking(updated.access_token);

      const revoke = await call("/api/v1/access/authorized-clients/" + client_id, "DELETE", { ...otherBrowser, Origin: origin });
      expect(revoke.status).toBe(200);
      expect(await revoke.json()).toEqual({ revoked: 1 });
      expect((await listTriggers(updated.access_token)).status).toBe(401);
      const afterRevoke = await refresh(updated.refresh_token);
      expect(afterRevoke.status).toBe(400);
      expect(await afterRevoke.json()).toMatchObject({ error: "invalid_grant" });

      const changed = await json("/api/v1/auth/password", {
        currentPassword: password, password: "replacement fixture browser password",
      }, otherBrowser);
      expect(changed.status).toBe(200);
      expect(await (await call("/api/v1/session", "GET", otherBrowser)).json()).toEqual({ authenticated: false });
    } finally {
      await f.cleanup();
    }
  }, 20_000);
});

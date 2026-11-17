import { afterEach, describe, expect, it, vi } from "vitest";
import { XConnectionRepository } from "../src/postgres/x-connection-repository";
import worker from "../src/worker";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!databaseUrl)("X owner OAuth callback (PostgreSQL)", { timeout: 60_000 }, () => {
  it("consumes owner-bound PKCE once, exchanges the code, verifies identity/scopes, and stores tokens encrypted", async () => {
    const fixture = await loadingFixture(databaseUrl!);
    try {
      const repository = new XConnectionRepository(fixture.db, fixture.tenantId, fixture.env.CREDENTIAL_ENCRYPTION_KEY);
      const id = crypto.randomUUID(), clientSecret = "private-x-client-secret";
      await repository.create({ id, name: "X test", clientId: "client-123", clientSecret, scopes: ["tweet.read", "users.read", "offline.access"] });
      const start = await worker.fetch(new Request(`https://factorize.test/api/v1/x/connections/${id}/authorize`, {
        method: "POST", headers: { Cookie: fixture.cookie, Origin: fixture.env.APP_ORIGIN, "Content-Type": "application/json" }, body: "{}",
      }), fixture.env, { waitUntil() {} } as any);
      expect(start.status).toBe(200);
      const { authorizationUrl } = await start.json() as { authorizationUrl: string };
      const authorize = new URL(authorizationUrl);
      expect(authorize.origin + authorize.pathname).toBe("https://x.com/i/oauth2/authorize");
      expect(authorize.searchParams.get("redirect_uri")).toBe("https://factorize.test/oauth/x/callback");
      expect(authorize.searchParams.get("scope")).toBe("tweet.read users.read offline.access");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      const state = authorize.searchParams.get("state")!;
      const oauthCookie = start.headers.get("Set-Cookie")!.split(";", 1)[0]!;
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input); calls.push({ url, init });
        if (url === "https://api.x.com/2/oauth2/token") return Response.json({ access_token: "secret-access", refresh_token: "secret-refresh", expires_in: 3600, scope: "tweet.read users.read offline.access" });
        if (url.startsWith("https://api.x.com/2/users/me")) return Response.json({ data: { id: "12345", username: "verified_user" } });
        throw new Error("Unexpected X request");
      });
      const callbackUrl = `https://factorize.test/oauth/x/callback?code=authorization-code&state=${encodeURIComponent(state)}`;
      const callback = () => worker.fetch(new Request(callbackUrl, { headers: { Cookie: `${fixture.cookie}; ${oauthCookie}` } }), fixture.env, { waitUntil() {} } as any);
      const result = await callback();
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe("https://factorize.test/settings/integrations?x=connected");
      expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(calls.map(call => call.url)).toEqual([
        "https://api.x.com/2/oauth2/token", "https://api.x.com/2/users/me?user.fields=id%2Cusername",
      ]);
      expect(calls[0]!.init?.body).toBeInstanceOf(URLSearchParams);
      expect((calls[0]!.init!.body as URLSearchParams).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(calls[0]!.init?.headers).toMatchObject({ Authorization: `Basic ${btoa(`client-123:${clientSecret}`)}` });
      expect(calls[1]!.init?.headers).toMatchObject({ Authorization: "Bearer secret-access" });
      const replay = await callback();
      expect(replay.headers.get("Location")).toContain("x=expired");
      expect(calls).toHaveLength(2);
      expect(await repository.get(id)).toMatchObject({ status: "connected", accountId: "12345", accountHandle: "verified_user", grantedScopes: ["offline.access", "tweet.read", "users.read"] });
      const stored = (await fixture.db.pool.query("SELECT encrypted_secret FROM app.x_connections WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, id])).rows[0].encrypted_secret;
      expect(stored).not.toContain("secret-access");
      expect(stored).not.toContain("secret-refresh");
      await expect(repository.clientCredentials(id)).resolves.toMatchObject({ accessToken: "secret-access", refreshToken: "secret-refresh" });
    } finally { await fixture.cleanup(); }
  });

  it("handles X denial without exchanging a code or losing the saved connection", async () => {
    const fixture = await loadingFixture(databaseUrl!);
    try {
      const repository = new XConnectionRepository(fixture.db, fixture.tenantId, fixture.env.CREDENTIAL_ENCRYPTION_KEY), id = crypto.randomUUID();
      await repository.create({ id, name: "Denied X app", clientId: "client-456", clientSecret: "private", scopes: ["tweet.read", "users.read", "offline.access"] });
      const start = await worker.fetch(new Request(`https://factorize.test/api/v1/x/connections/${id}/authorize`, { method: "POST", headers: { Cookie: fixture.cookie, Origin: fixture.env.APP_ORIGIN, "Content-Type": "application/json" }, body: "{}" }), fixture.env, { waitUntil() {} } as any);
      const state = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
      const cookie = start.headers.get("Set-Cookie")!.split(";", 1)[0]!;
      const response = await worker.fetch(new Request(`https://factorize.test/oauth/x/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { Cookie: `${fixture.cookie}; ${cookie}` } }), fixture.env, { waitUntil() {} } as any);
      expect(response.headers.get("Location")).toContain("x=denied");
      expect(await repository.get(id)).toMatchObject({ status: "pending", accountId: null });
    } finally { await fixture.cleanup(); }
  });
});

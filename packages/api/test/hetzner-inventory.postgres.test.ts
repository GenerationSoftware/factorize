import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { ConnectionRepository } from "../src/credentials/storage/connection-repository";
import { HetznerConnectionRepository } from "../src/credentials/storage/hetzner-connection-repository";
import { IdentityRepository } from "../src/auth/storage/identity-repository";
import { signSession } from "../src/auth/application/session";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("owner-only Hetzner project inventory REST routes (PostgreSQL)", { timeout: 60_000 }, () => {
  it("encrypts the tenant credential, lists only safe fields, and clears its SSH enrollments on rotation or delete", async () => {
    const f = await loadingFixture(databaseUrl!);
    const token = "syntheticHetznerReadOnlyToken";
    const replacement = "syntheticHetznerReplacementToken";
    const otherToken = "syntheticOtherProjectToken";
    let permit = true;
    let rejectedStatus = 403;
    const provider = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toBe("https://api.hetzner.cloud/v1/servers?page=1&per_page=25");
      expect(options?.method).toBe("GET");
      const auth = new Headers(options?.headers).get("Authorization");
      if (!permit) return new Response(JSON.stringify({ providerMessage: auth }), { status: rejectedStatus });
      expect(auth).toMatch(/^Bearer syntheticHetzner(?:ReadOnly|Replacement)Token$/);
      return Response.json({ servers: [{ id: 41, name: "my server", status: "running", location: { name: "hel1" }, public_net: { metadata: token } }],
        meta: { pagination: { next_page: null } } });
    });
    vi.stubGlobal("fetch", provider);
    try {
      const call = (path: string, method = "GET", body?: unknown, cookie: string | null = f.cookie, authorization?: string) =>
        worker.fetch(new Request(`${f.env.APP_ORIGIN}/api/v1/hetzner/${path}`, {
          method,
          headers: { ...(cookie ? { Cookie: cookie } : {}), ...(authorization ? { Authorization: authorization } : {}),
            Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }), f.env, { waitUntil() {} } as any);
      expect(await (await call("connection")).json()).toEqual({ connection: null });
      expect((await call("servers")).status).toBe(404);
      expect((await call("servers", "GET", undefined, null)).status).toBe(401);
      const patResponse = await worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/access-tokens", {
        method: "POST", headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Fixture", expiryDays: 7, scopes: ["integrations:read", "integrations:write"] }),
      }), f.env, { waitUntil() {} } as any);
      expect(patResponse.status).toBe(201);
      const pat = (await patResponse.json() as {token: string}).token;
      for (const [path, method, body] of [["connection", "GET", undefined], ["servers", "GET", undefined],
        ["connection", "PUT", { name: "Unauthorized", token }], ["connection", "DELETE", undefined]] as const) {
        const denied = await call(path, method, body, null, "Bearer " + pat);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { code: "session_required" } });
      }
      expect((await call("connection", "PUT", { name: "External URL", token, origin: "https://example.test" })).status).toBe(400);
      expect(provider).not.toHaveBeenCalled();

      const saved = await call("connection", "PUT", { name: "Test project", token });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ connection: { name: "Test project" } });
      const key = f.env.CREDENTIAL_ENCRYPTION_KEY;
      const repo = new HetznerConnectionRepository(f.db, f.tenantId, key);
      const firstRevision = (await repo.get())?.revision;
      expect(firstRevision).toMatch(/^[a-f0-9-]{36}$/);
      const stored = (await f.db.pool.query<{encrypted_value: string}>(
        "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId])).rows[0]!.encrypted_value;
      expect(stored).not.toContain(token);
      const result = await call("servers");
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(await result.json()).toEqual({ truncated: false, servers: [{ id: 41, name: "my server", status: "running", location: "hel1" }] });

      const generic = new ConnectionRepository(f.db, f.tenantId, key);
      const otherGeneric = new ConnectionRepository(f.db, f.otherTenant, key);
      const otherRepo = new HetznerConnectionRepository(f.db, f.otherTenant, key);
      await otherRepo.save("Other project", otherToken);
      await generic.put("hetzner-ssh:41", { key: "fixture" });
      await otherGeneric.put("hetzner-ssh:41", { key: "isolated fixture" });
      permit = false;
      const rejected = await call("connection", "PUT", { name: "Invalid project", token: replacement });
      expect(rejected.status).toBe(422);
      const publicError = await rejected.text();
      expect(publicError).not.toContain(replacement);
      expect(publicError).not.toContain("providerMessage");
      expect((await repo.get())?.revision).toBe(firstRevision);
      expect(await generic.get("hetzner-ssh:41")).not.toBeNull();

      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        rejectedStatus = 429;
        const unavailable = await call("connection", "PUT", { name: "Invalid project", token: replacement });
        expect(unavailable.status).toBe(502);
        const requestId = unavailable.headers.get("X-Request-Id");
        expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(errors).toHaveBeenCalledExactlyOnceWith({ event: "integration_failure", requestId,
          provider: "hetzner", operation: "validate_token", reason: "rate_limited", upstreamStatus: 429, durationMs: expect.any(Number) });
        expect(JSON.stringify(errors.mock.calls)).not.toContain(replacement);
        expect(await unavailable.text()).not.toContain(replacement);
        expect((await repo.get())?.revision).toBe(firstRevision);
      } finally { errors.mockRestore(); }

      permit = true;
      expect((await call("connection", "PUT", { name: "Reconnected project", token: replacement })).status).toBe(200);
      expect((await repo.get())?.revision).not.toBe(firstRevision);
      expect(await generic.get("hetzner-ssh:41")).toBeNull();
      expect(await otherGeneric.get("hetzner-ssh:41")).not.toBeNull();

      const otherUser = crypto.randomUUID();
      await new IdentityRepository(f.db, f.otherTenant).upsertOwner(otherUser, "other@example.test");
      const membership = await new IdentityRepository(f.db, f.otherTenant).member(otherUser);
      const otherCookie = `factorize_session=${await signSession({ ...f.auth, tenantId: f.otherTenant, userId: otherUser,
        sessionVersion: membership!.sessionVersion, email: "other@example.test", exp: Math.floor(Date.now()/1000) + 3600 }, f.env.SESSION_SIGNING_SECRET)}`;
      expect(await (await call("connection", "GET", undefined, otherCookie)).json()).toEqual({ connection: { name: "Other project" } });

      await generic.put("hetzner-ssh:41", { key: "fixture" });
      expect(await (await call("connection", "DELETE")).json()).toEqual({ deleted: true });
      expect(await generic.get("hetzner-ssh:41")).toBeNull();
      expect(await repo.get()).toBeNull();
      expect(await otherGeneric.get("hetzner-ssh:41")).not.toBeNull();
      expect((await otherRepo.get())?.token).toBe(otherToken);
      expect(provider).toHaveBeenCalledTimes(4);
    } finally { vi.unstubAllGlobals(); await f.cleanup(); }
  });
});

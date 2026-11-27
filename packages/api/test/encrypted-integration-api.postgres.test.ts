import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { IdentityRepository } from "../src/auth/storage/identity-repository";
import { CredentialRepository } from "../src/credentials/storage/credential-repository";
import { signSession } from "../src/auth/application/session";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("owner-only managed credential API (PostgreSQL)", { timeout: 60_000 }, () => {
  it("does not expose retired proxy or unlock operations", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      for (const path of ["/credential-proxy/setup", "/credential-proxy/browser-capability", "/unlock-key/verification", "/unlock-key/rotation"]) {
        const response = await worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1" + path, {method:"POST", headers:{Cookie:f.cookie, Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:"{}"}),f.env,{waitUntil(){}} as any);
        expect(response.status).toBe(404);
      }
    } finally {await f.cleanup();}
  });
  it("supports safe create, list, update, delete and rejects malformed and stale writes", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const request = (path: string, method = "GET", body?: unknown, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1" + path, {
        method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), f.env, { waitUntil() {} } as any);
      const id = crypto.randomUUID(), idempotencyKey = crypto.randomUUID(), token = "synthetic upstream bearer credential";
      const created = await request("/integrations/bearer", "POST", { id, expectedRevision: 0, idempotencyKey, name: "Test service", origin: "https://api.example.test", description: "fixture", token });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ revision: 1, duplicate: false });

      const listed = await request("/integrations/bearer");
      expect(listed.status).toBe(200);
      const result = await listed.json() as any;
      expect(result).toEqual({ revision: 1, integrations: [{ id, kind: "bearer", name: "Test service", origin: "https://api.example.test", description: "fixture", revision: 1 }] });
      expect(JSON.stringify(result)).not.toContain(token);
      expect(result.integrations[0]).not.toHaveProperty("unlockKey");
      expect(result.integrations[0]).not.toHaveProperty("token");

      const updated = await request(`/integrations/bearer/${id}`, "PUT", { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), name: "Renamed service", origin: "https://api.example.test", description: null, token });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toEqual({ revision: 2, duplicate: false });

      const malformed = await request("/integrations/bearer", "POST", { id: crypto.randomUUID(), expectedRevision: 2, idempotencyKey: crypto.randomUUID(), name: "Malformed", origin: "https://api.example.test", description: null, token: "" });
      expect(malformed.status).toBe(400);
      const oldFormat = await request("/integrations/bearer", "POST", { id: crypto.randomUUID(), expectedRevision: 2, idempotencyKey: crypto.randomUUID(), name: "Old format", origin: "https://api.example.test", description: null, encryptedPayload: "cipher" });
      expect(oldFormat.status).toBe(400);
      const stored = await f.db.pool.query<{ encrypted_payload: string }>("SELECT encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2", [f.tenantId, id]);
      expect(stored.rows[0]!.encrypted_payload).not.toContain(token);
      const stale = await request(`/integrations/bearer/${id}`, "PUT", { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), name: "Stale", origin: "https://api.example.test", description: null, token });
      expect(stale.status).toBe(409);
      expect((await stale.json() as any).error.code).toBe("stale_revision");

      const deleted = await request(`/integrations/bearer/${id}`, "DELETE", { expectedRevision: 2, idempotencyKey: crypto.randomUUID() });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ id, deleted: true, revision: 3, duplicate: false });
      expect((await (await request("/integrations/bearer")).json() as any).integrations).toEqual([]);
    } finally { await f.cleanup(); }
  });

});

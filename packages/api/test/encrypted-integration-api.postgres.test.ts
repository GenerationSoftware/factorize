import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { signSession } from "../src/session";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

async function userEncrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(btoa("u".repeat(32))), c => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
  return `${encode(iv)}.${encode(new Uint8Array(body))}`;
}

describe.skipIf(!databaseUrl)("browser-only encrypted bearer integration API (PostgreSQL)", { timeout: 60_000 }, () => {
  it("stores one ciphertext-only unlock verification per owner and never accepts a plaintext key", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const request = (method = "GET", body?: unknown, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/unlock-key/verification", {
        method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), f.env, { waitUntil() {} } as any);
      expect(await (await request()).json()).toEqual({ ownerId: f.userId, verification: null });
      const generationId = crypto.randomUUID();
      const encryptedVerification = JSON.stringify({ version: 1, algorithm: "A256GCM", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAA" });
      const body = { generationId, encryptedVerification };
      expect((await request("POST", body)).status).toBe(200);
      expect(await (await request()).json()).toEqual({ ownerId: f.userId, verification: body });
      const stored = await f.db.pool.query("SELECT generation_id,encrypted_verification FROM app.unlock_key_verifications WHERE tenant_id=$1", [f.tenantId]);
      expect(stored.rows).toEqual([{ generation_id: generationId, encrypted_verification: encryptedVerification }]);
      expect(JSON.stringify(stored.rows)).not.toContain("fzk1.");
      expect((await request("POST", body)).status).toBe(409);
      expect((await request("POST", { ...body, unlockKey: "fzk1.must-not-be-accepted" })).status).toBe(400);
    } finally { await f.cleanup(); }
  });
  it("supports safe create, list, update, delete and rejects malformed and stale writes", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const request = (path: string, method = "GET", body?: unknown, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1" + path, {
        method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), f.env, { waitUntil() {} } as any);
      const id = crypto.randomUUID(), idempotencyKey = crypto.randomUUID(), cipher = await userEncrypt("synthetic upstream bearer credential");
      const created = await request("/integrations/bearer", "POST", { id, expectedRevision: 0, idempotencyKey, name: "Test service", origin: "https://api.example.test", description: "fixture", encryptedPayload: cipher });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ revision: 1, duplicate: false });

      const listed = await request("/integrations/bearer");
      expect(listed.status).toBe(200);
      const result = await listed.json() as any;
      expect(result).toEqual({ revision: 1, integrations: [{ id, kind: "bearer", name: "Test service", origin: "https://api.example.test", description: "fixture", revision: 1, encryptedPayload: cipher }] });
      expect(JSON.stringify(result)).not.toContain("synthetic upstream bearer credential");
      expect(result.integrations[0]).not.toHaveProperty("unlockKey");
      expect(result.integrations[0]).not.toHaveProperty("token");

      const updated = await request(`/integrations/bearer/${id}`, "PUT", { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), name: "Renamed service", origin: "https://api.example.test", description: null, encryptedPayload: cipher });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toEqual({ revision: 2, duplicate: false });

      const malformed = await request("/integrations/bearer", "POST", { id: crypto.randomUUID(), expectedRevision: 2, idempotencyKey: crypto.randomUUID(), name: "Malformed", origin: "https://api.example.test", description: null, encryptedPayload: "not-ciphertext" });
      expect(malformed.status).toBe(400);
      const plaintext = await request("/integrations/bearer", "POST", { id: crypto.randomUUID(), expectedRevision: 2, idempotencyKey: crypto.randomUUID(), name: "Plaintext", origin: "https://api.example.test", description: null, encryptedPayload: cipher, bearerToken: "must-not-be-accepted" });
      expect(plaintext.status).toBe(400);
      const stale = await request(`/integrations/bearer/${id}`, "PUT", { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), name: "Stale", origin: "https://api.example.test", description: null, encryptedPayload: cipher });
      expect(stale.status).toBe(409);
      expect((await stale.json() as any).error.code).toBe("stale_revision");

      const deleted = await request(`/integrations/bearer/${id}`, "DELETE", { expectedRevision: 2, idempotencyKey: crypto.randomUUID() });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ id, deleted: true, revision: 3, duplicate: false });
      expect((await (await request("/integrations/bearer")).json() as any).integrations).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it("requires a browser session and isolates records across tenants", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const path = f.env.APP_ORIGIN + "/api/v1/integrations/bearer";
      const anonymous = await worker.fetch(new Request(path), f.env, { waitUntil() {} } as any);
      expect(anonymous.status).toBe(401);
      const agent = await protectedApiFetch(new Request(path), f.env, { tenantId: f.tenantId, userId: f.userId, sessionVersion: 0, scopes: ["integrations:write"], authMethod: "access_token" } as any, {} as any);
      expect(agent.status).toBe(403);

      const id = crypto.randomUUID(), cipher = await userEncrypt("tenant private credential");
      const created = await worker.fetch(new Request(path, { method: "POST", headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ id, expectedRevision: 0, idempotencyKey: crypto.randomUUID(), name: "Private", origin: "https://api.example.test", description: null, encryptedPayload: cipher }) }), f.env, { waitUntil() {} } as any);
      expect(created.status).toBe(201);

      const otherUser = crypto.randomUUID();
      await new IdentityRepository(f.db, f.otherTenant).upsertOwner(otherUser, "other-owner@example.test");
      const member = await new IdentityRepository(f.db, f.otherTenant).member(otherUser);
      const otherCookie = `factorize_session=${await signSession({ tenantId: f.otherTenant, userId: otherUser, email: "other-owner@example.test", sessionVersion: member!.sessionVersion, exp: Math.floor(Date.now() / 1000) + 600 }, f.env.SESSION_SIGNING_SECRET)}`;
      const otherList = await worker.fetch(new Request(path, { headers: { Cookie: otherCookie } }), f.env, { waitUntil() {} } as any);
      expect(otherList.status).toBe(200);
      expect(await otherList.json()).toEqual({ revision: 0, integrations: [] });
      const otherUpdate = await worker.fetch(new Request(path + `/${id}`, { method: "PUT", headers: { Cookie: otherCookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, idempotencyKey: crypto.randomUUID(), name: "Stolen", origin: "https://api.example.test", description: null, encryptedPayload: cipher }) }), f.env, { waitUntil() {} } as any);
      expect(otherUpdate.status).toBe(404);
    } finally { await f.cleanup(); }
  });
});

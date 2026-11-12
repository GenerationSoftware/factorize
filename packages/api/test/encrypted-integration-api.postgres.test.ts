import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { RunEnrollmentRepository } from "../src/postgres/run-enrollment-repository";
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
  it("owner-only key replacement atomically resets encrypted records, changes verification, and locks the proxy", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const request = (path: string, method = "GET", body?: unknown, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1" + path, {
        method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), f.env, { waitUntil() {} } as any);
      const oldGeneration = crypto.randomUUID(), newGeneration = crypto.randomUUID();
      const verification = (generationId: string) => JSON.stringify({ version: 1, algorithm: "A256GCM", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAA" });
      expect((await request("/unlock-key/verification", "POST", { generationId: oldGeneration, encryptedVerification: verification(oldGeneration) })).status).toBe(200);
      const encrypted = await userEncrypt("synthetic bearer payload");
      const integrationId = crypto.randomUUID();
      expect((await request("/integrations/bearer", "POST", { id: integrationId, expectedRevision: 0, idempotencyKey: crypto.randomUUID(), name: "Synthetic", origin: "https://api.example.test", description: null, encryptedPayload: encrypted })).status).toBe(201);
      await f.db.pool.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,'fly:connection-fixture','encrypted-fly-fixture')", [f.tenantId]);
      await f.db.pool.query("UPDATE app.jobs SET execution_config=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.jobIds[0], { provider: "fly", connectionId: "fly:connection-fixture", region: "ord", vmSize: "shared-cpu-1x" }]);
      const flyConnectionBefore = (await f.db.pool.query("SELECT kind,encrypted_value FROM app.connections WHERE tenant_id=$1 ORDER BY kind", [f.tenantId])).rows;
      const executionConfigBefore = (await f.db.pool.query("SELECT id,execution_config FROM app.jobs WHERE tenant_id=$1 ORDER BY id", [f.tenantId])).rows;
      await f.db.pool.query("INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch,unlocked) VALUES($1,'proxy-test',$2,true)", [f.tenantId, crypto.randomUUID()]);
      const runId = crypto.randomUUID(), jobId = crypto.randomUUID(), triggerId = crypto.randomUUID(), invocationId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.jobs(tenant_id,id,project_id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES ($1,$2,$3,'Rotation test','rotation-test','test','{}',1)", [f.tenantId, jobId, f.projectId]);
      await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [f.tenantId, triggerId, jobId]);
      await f.db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','rotation-test',$4,'{}')", [f.tenantId, invocationId, jobId, triggerId]);
      await f.db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,'running','test')", [f.tenantId, runId, jobId, invocationId]);
      const enrollmentRepository = new RunEnrollmentRepository(f.db);
      const binding = { tenantId: f.tenantId, runId, vmIdentity: "vm-rotation", proxyIdentity: "proxy-test", bootEpoch: (await f.db.pool.query("SELECT boot_epoch FROM app.credential_proxy_states WHERE tenant_id=$1", [f.tenantId])).rows[0].boot_epoch };
      expect(await enrollmentRepository.authorizeRun(binding)).toBe(1);
      const issued = await enrollmentRepository.issue(binding, new Date(Date.now() + 60_000));
      expect(issued).not.toBeNull();

      const snapshot = await request("/unlock-key/rotation-snapshot");
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ ownerId: f.userId, generationId: oldGeneration, revision: 1, records: [{ id: integrationId, kind: "bearer", encryptedPayload: encrypted }] });
      const replacement = await request("/unlock-key/rotation", "POST", {
        expectedGenerationId: oldGeneration, generationId: newGeneration, expectedRevision: 1,
        encryptedVerification: verification(newGeneration), records: [], changes: [],
      });
      expect(replacement.status).toBe(200);
      expect(await replacement.json()).toEqual({ generationId: newGeneration, revision: 2, duplicate: false });
      expect((await f.db.pool.query("SELECT generation_id FROM app.unlock_key_verifications WHERE tenant_id=$1", [f.tenantId])).rows[0].generation_id).toBe(newGeneration);
      expect((await f.db.pool.query("SELECT id FROM app.integration_records WHERE tenant_id=$1", [f.tenantId])).rows).toEqual([]);
      expect((await f.db.pool.query("SELECT unlocked FROM app.credential_proxy_states WHERE tenant_id=$1", [f.tenantId])).rows[0].unlocked).toBe(false);
      expect((await f.db.pool.query("SELECT kind,encrypted_value FROM app.connections WHERE tenant_id=$1 ORDER BY kind", [f.tenantId])).rows).toEqual(flyConnectionBefore);
      expect((await f.db.pool.query("SELECT id,execution_config FROM app.jobs WHERE tenant_id=$1 ORDER BY id", [f.tenantId])).rows).toEqual(executionConfigBefore);
      expect((await f.db.pool.query("SELECT revoked_at FROM app.credential_run_grants WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, runId])).rows[0].revoked_at).toBeInstanceOf(Date);
      expect((await f.db.pool.query("SELECT consumed_at FROM app.credential_run_enrollments WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, runId])).rows[0].consumed_at).toBeInstanceOf(Date);
      expect(await enrollmentRepository.consume(issued!.token, binding)).toBeNull();
      const rotatedCipher = await userEncrypt("rotated synthetic bearer payload"), rotatedId = crypto.randomUUID();
      expect((await request("/integrations/bearer", "POST", { id: rotatedId, expectedRevision: 2, idempotencyKey: crypto.randomUUID(), name: "Rotated", origin: "https://api.example.test", description: null, encryptedPayload: encrypted })).status).toBe(201);
      const rotationSnapshot = await (await request("/unlock-key/rotation-snapshot")).json() as any;
      const finalGeneration = crypto.randomUUID();
      const rotated = await request("/unlock-key/rotation", "POST", {
        expectedGenerationId: newGeneration, generationId: finalGeneration, expectedRevision: 3,
        encryptedVerification: verification(finalGeneration),
        records: rotationSnapshot.records.map((record: any) => ({ ...record, encryptedPayload: record.id === rotatedId ? rotatedCipher : record.encryptedPayload })),
        changes: rotationSnapshot.changes.map((change: any) => ({ ...change, encryptedPayload: change.id === rotatedId && change.operation === "upsert" ? rotatedCipher : change.encryptedPayload })),
      });
      expect(rotated.status).toBe(200);
      expect(await rotated.json()).toEqual({ generationId: finalGeneration, revision: 4, duplicate: false });
      expect((await request("/integrations/bearer")).status).toBe(200);
      expect((await (await request("/integrations/bearer")).json() as any).integrations[0].encryptedPayload).toBe(rotatedCipher);
      const agent = await request("/unlock-key/rotation-snapshot", "GET", undefined, "untrusted-cookie");
      expect(agent.status).toBe(401);
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

  it("creates and deletes model accounts through owner-only revision-checked writes", async () => {
    const f = await loadingFixture(databaseUrl!);
    try {
      const path = f.env.APP_ORIGIN + "/api/v1/model-accounts", id = crypto.randomUUID();
      const request = (url: string, method = "GET", body?: unknown, cookie = f.cookie) => worker.fetch(new Request(url, {
        method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), f.env, { waitUntil() {} } as any);
      const ciphertext = await userEncrypt("{}"), createBody = {
        id, expectedRevision: 0, idempotencyKey: crypto.randomUUID(), name: "Work account",
        description: "Personal subscription", encryptedPayload: ciphertext,
      };
      const created = await request(path, "POST", createBody);
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ revision: 1, duplicate: false });
      expect(await (await request(path, "POST", createBody)).json()).toEqual({ revision: 1, duplicate: true });

      const listed = await request(path);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({ revision: 1, accounts: [{ id, name: "Work account", description: "Personal subscription", revision: 1 }] });

      const stale = await request(path + `/${id}`, "DELETE", { expectedRevision: 0, idempotencyKey: crypto.randomUUID() });
      expect(stale.status).toBe(409);
      expect((await stale.json() as any).error.code).toBe("stale_revision");

      const deleteBody = { expectedRevision: 1, idempotencyKey: crypto.randomUUID() };
      const deleted = await request(path + `/${id}`, "DELETE", deleteBody);
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ id, deleted: true, revision: 2, duplicate: false });
      expect(await (await request(path + `/${id}`, "DELETE", deleteBody)).json()).toEqual({ id, deleted: true, revision: 2, duplicate: true });
      expect(await (await request(path)).json()).toEqual({ revision: 2, accounts: [] });

      const agent = await protectedApiFetch(new Request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...createBody, id: crypto.randomUUID() }) }), f.env, { tenantId: f.tenantId, userId: f.userId, sessionVersion: 0, scopes: ["integrations:write"], authMethod: "access_token" } as any, {} as any);
      expect(agent.status).toBe(403);
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

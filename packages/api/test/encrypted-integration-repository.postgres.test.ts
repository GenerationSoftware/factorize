import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { decrypt } from "../src/crypto";
import { Database } from "../src/postgres/database";
import { EncryptedIntegrationRepository, IntegrationIdempotencyConflictError, StaleIntegrationRevisionError } from "../src/postgres/encrypted-integration-repository";

const url = process.env.AUTH_TEST_DATABASE_URL;
const serverKey = btoa("s".repeat(32));
const userKey = btoa("u".repeat(32));

async function userEncrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(userKey), c => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
  return `${encode(iv)}.${encode(new Uint8Array(body))}`;
}

describe.skipIf(!url)("encrypted integration persistence (PostgreSQL)", () => {
  let db: Database;
  let admin: pg.Client;
  let databaseName: string;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    databaseName = `encrypted_integration_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const databaseUrl = new URL(url!); databaseUrl.pathname = `/${databaseName}`;
    db = new Database({ connectionString: databaseUrl.toString() });
    const migrations = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await db.pool.query(await readFile(new URL(file, migrations), "utf8"));
    const migration = await db.pool.query("SELECT to_regclass('app.integration_collections') AS collection, to_regclass('app.integration_changes') AS changes");
    expect(migration.rows[0]).toEqual({ collection: "app.integration_collections", changes: "app.integration_changes" });
  }, 30_000);
  afterAll(async () => { await db?.close(); await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin?.end(); });

  async function freshRepository() {
    const tenantId = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    return { tenantId, repository: new EncryptedIntegrationRepository(db, tenantId, serverKey) };
  }

  it("encrypts user ciphertext again and server-key access cannot recover synthetic plaintext", async () => {
    const plaintext = "synthetic bearer secret that must remain user-encrypted";
    const innerCiphertext = await userEncrypt(plaintext);
    const id = crypto.randomUUID(), idempotencyKey = crypto.randomUUID();
    const { tenantId, repository } = await freshRepository();
    await repository.write({ id, idempotencyKey, expectedRevision: 0, operation: "upsert", kind: "bearer", name: "Source", origin: "https://api.example.test", description: "fixture", encryptedPayload: innerCiphertext });
    const stored = (await db.pool.query("SELECT encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2", [tenantId, id])).rows[0].encrypted_payload as string;
    expect(stored).not.toBe(innerCiphertext);
    expect(stored).not.toContain(plaintext);
    const returned = (await repository.records())[0]!;
    expect(returned.encryptedPayload).toBe(innerCiphertext);
    await expect(decrypt(returned.encryptedPayload, serverKey)).rejects.toThrow();
    expect(returned.encryptedPayload).not.toContain(plaintext);
  });

  it("isolates tenants, rejects stale writes, and serializes concurrent conditional edits", async () => {
    const { tenantId, repository } = await freshRepository();
    const otherTenant = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [otherTenant]);
    const other = new EncryptedIntegrationRepository(db, otherTenant, serverKey);
    const first = { id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), expectedRevision: 0, operation: "upsert" as const, kind: "model" as const, name: "Primary", origin: null, description: null, encryptedPayload: await userEncrypt("first") };
    await repository.write(first);
    expect(await other.revision()).toBe(0);
    expect(await other.records()).toEqual([]);
    await expect(repository.write({ ...first, id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ name: "StaleIntegrationRevisionError", currentRevision: 1 });
    const base = await userEncrypt("parallel");
    const results = await Promise.allSettled([0, 1].map(() => repository.write({ id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), expectedRevision: 1, operation: "upsert", kind: "model", name: `Concurrent-${crypto.randomUUID()}`, origin: null, description: null, encryptedPayload: base })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected" && result.reason instanceof StaleIntegrationRevisionError)).toHaveLength(1);
  });

  it("returns edits and deletion tombstones in revision order and deduplicates retries", async () => {
    const { repository, tenantId } = await freshRepository();
    const id = crypto.randomUUID(), idempotencyKey = crypto.randomUUID();
    const one = await userEncrypt("account version one");
    const first = { id, idempotencyKey, expectedRevision: await repository.revision(), operation: "upsert" as const, kind: "bearer" as const, name: "Ordered", origin: "https://one.example.test", description: null, encryptedPayload: one };
    const firstResult = await repository.write(first);
    expect(firstResult.duplicate).toBe(false);
    expect(await repository.write(first)).toEqual({ ...firstResult, duplicate: true });
    const two = await userEncrypt("account version two");
    const edit = { ...first, idempotencyKey: crypto.randomUUID(), expectedRevision: firstResult.revision, origin: "https://two.example.test", encryptedPayload: two };
    const editResult = await repository.write(edit);
    const deletion = { id, idempotencyKey: crypto.randomUUID(), expectedRevision: editResult.revision, operation: "delete" as const, kind: "bearer" as const, name: "Ordered", origin: "https://two.example.test", description: null };
    const deleteResult = await repository.write(deletion);
    const changes = await repository.changesSince(firstResult.revision - 1);
    expect(changes.map(({ revision, operation }) => [revision, operation])).toEqual([[firstResult.revision, "upsert"], [editResult.revision, "upsert"], [deleteResult.revision, "delete"]]);
    expect(changes.map(change => change.encryptedPayload)).toEqual([one, two, null]);
    expect(await repository.records()).not.toContainEqual(expect.objectContaining({ id }));
    const tombstone = await db.pool.query("SELECT deleted_at,encrypted_payload,revision FROM app.integration_records WHERE tenant_id=$1 AND id=$2", [tenantId, id]);
    expect(tombstone.rows[0]).toMatchObject({ encrypted_payload: null, revision: String(deleteResult.revision) });
    expect(tombstone.rows[0].deleted_at).toBeInstanceOf(Date);
    await expect(repository.write({ ...first, name: "Different operation with same key" })).rejects.toBeInstanceOf(IntegrationIdempotencyConflictError);
  });
});

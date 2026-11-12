import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { decrypt } from "../src/crypto";
import { Database } from "../src/postgres/database";
import { RunRetentionRepository } from "../src/postgres/run-retention-repository";
import { EncryptedIntegrationRepository, IntegrationIdempotencyConflictError, StaleIntegrationGenerationError, StaleIntegrationRevisionError } from "../src/postgres/encrypted-integration-repository";

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
  let tearingDown = false;
  let unexpectedPoolError: Error | undefined;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    databaseName = `encrypted_integration_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const databaseUrl = new URL(url!); databaseUrl.pathname = `/${databaseName}`;
    db = new Database({ connectionString: databaseUrl.toString() });
    db.pool.on("error", error => {
      if (tearingDown && (error as NodeJS.ErrnoException).code === "57P01") return;
      unexpectedPoolError = error;
    });
    const migrations = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await db.pool.query(await readFile(new URL(file, migrations), "utf8"));
    const migration = await db.pool.query("SELECT to_regclass('app.integration_collections') AS collection, to_regclass('app.integration_changes') AS changes");
    expect(migration.rows[0]).toEqual({ collection: "app.integration_collections", changes: "app.integration_changes" });
  }, 30_000);
  afterAll(async () => {
    await db?.close();
    tearingDown = true;
    await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin?.end();
    if (unexpectedPoolError) throw unexpectedPoolError;
  });

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

  it("prunes bounded old change history and tells stale consumers to reload the full collection", async () => {
    const { tenantId, repository } = await freshRepository();
    const encryptedPayload = await userEncrypt("retained synthetic integration");
    await repository.write({ id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), expectedRevision: 0, operation: "upsert", kind: "model", name: "Retained", origin: null, description: null, encryptedPayload });
    await db.pool.query("UPDATE app.integration_changes SET created_at=now()-interval '15 days' WHERE tenant_id=$1", [tenantId]);

    const result = await new RunRetentionRepository(db).cleanupIndependentHistory();
    expect(result.find(row => row.queue === "integration_changes")?.deleted).toBe(1);
    await expect(repository.changesSince(0)).rejects.toMatchObject({ name: "StaleIntegrationRevisionError", currentRevision: 1, resyncRequired: true });
    expect(await repository.changesSince(1)).toEqual([]);
    expect((await repository.records()).map(record => record.name)).toEqual(["Retained"]);
  });

  it("stages ciphertext only, atomically replaces the whole generation, and makes a lost commit reply retryable", async () => {
    const { repository, tenantId } = await freshRepository();
    const id = crypto.randomUUID(), original = await userEncrypt("old credential fixture"), rotated = await userEncrypt("rotated credential fixture");
    const tombstoneId = crypto.randomUUID(), tombstoneCipher = await userEncrypt("deleted credential fixture");
    const write = { id, idempotencyKey: crypto.randomUUID(), expectedRevision: 0, operation: "upsert" as const, kind: "bearer" as const, name: "Rotation", origin: "https://rotation.example.test", description: null, encryptedPayload: original };
    await repository.write(write);
    const tombstoneWrite = { id: tombstoneId, idempotencyKey: crypto.randomUUID(), expectedRevision: 1, operation: "upsert" as const, kind: "model" as const, name: "Retired", origin: null, description: null, encryptedPayload: tombstoneCipher };
    await repository.write(tombstoneWrite);
    const tombstoneRevision = (await repository.write({ ...tombstoneWrite, expectedRevision: 2, idempotencyKey: crypto.randomUUID(), operation: "delete", encryptedPayload: undefined })).revision;
    const baseRevision = tombstoneRevision;
    const generationId = crypto.randomUUID();
    const snapshot = { records: [
      { id, kind: "bearer" as const, name: "Rotation", origin: write.origin, description: null, revision: 1, encryptedPayload: rotated, deletedAt: null },
      { id: tombstoneId, kind: "model" as const, name: "Retired", origin: null, description: null, revision: tombstoneRevision, encryptedPayload: null, deletedAt: new Date() },
    ], changes: [
      { id, idempotencyKey: crypto.randomUUID(), kind: "bearer" as const, name: "Rotation", origin: write.origin, description: null, revision: 1, operation: "upsert" as const, encryptedPayload: rotated },
      { id: tombstoneId, idempotencyKey: crypto.randomUUID(), kind: "model" as const, name: "Retired", origin: null, description: null, revision: 2, operation: "upsert" as const, encryptedPayload: tombstoneCipher },
      { id: tombstoneId, idempotencyKey: crypto.randomUUID(), kind: "model" as const, name: "Retired", origin: null, description: null, revision: tombstoneRevision, operation: "delete" as const, encryptedPayload: null },
    ] };
    expect(await repository.stageGeneration({ generationId, expectedRevision: baseRevision, ...snapshot })).toEqual({ duplicate: false });
    expect(await repository.stageGeneration({ generationId, expectedRevision: baseRevision, ...snapshot })).toEqual({ duplicate: true });
    await expect(repository.stageGeneration({ generationId, expectedRevision: baseRevision, ...snapshot, records: snapshot.records.map(record => record.id === id ? { ...record, encryptedPayload: original } : record) })).rejects.toBeInstanceOf(IntegrationIdempotencyConflictError);
    const staged = await db.pool.query("SELECT encrypted_payload FROM app.integration_generation_records WHERE tenant_id=$1 AND generation_id=$2 AND encrypted_payload IS NOT NULL", [tenantId,generationId]);
    expect(staged.rows[0].encrypted_payload).toBe(rotated);
    expect(JSON.stringify(staged.rows)).not.toContain("rotated credential fixture");

    await db.pool.query(`CREATE FUNCTION app.reject_rotation_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected pre-commit failure'; END $$`);
    await db.pool.query("CREATE TRIGGER reject_rotation_delete BEFORE DELETE ON app.integration_records FOR EACH ROW EXECUTE FUNCTION app.reject_rotation_delete()");
    await expect(repository.commitGeneration(generationId, baseRevision)).rejects.toThrow("injected pre-commit failure");
    expect((await repository.records()).find(record => record.id === id)!.encryptedPayload).toBe(original);
    await db.pool.query("DROP TRIGGER reject_rotation_delete ON app.integration_records");
    await db.pool.query("DROP FUNCTION app.reject_rotation_delete()");

    const lockA = 17391, lockB = 2871;
    const gate = await db.pool.connect();
    await db.pool.query(`CREATE FUNCTION app.hold_rotation_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockA},${lockB}); RETURN NEW; END $$`);
    await db.pool.query("CREATE TRIGGER hold_rotation_insert BEFORE INSERT ON app.integration_records FOR EACH ROW EXECUTE FUNCTION app.hold_rotation_insert()");
    await gate.query("SELECT pg_advisory_lock($1,$2)", [lockA,lockB]);
    try {
      const pendingCommit = repository.commitGeneration(generationId, baseRevision);
      const deadline = Date.now() + 5_000;
      let reachedInsert = false;
      while (Date.now() < deadline) {
        const waiting = await gate.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database() AND pid<>pg_backend_pid() LIMIT 1");
        if (waiting.rowCount) { reachedInsert = true; break; }
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(reachedInsert, JSON.stringify((await gate.query("SELECT pid,state,wait_event_type,wait_event,query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")).rows)).toBe(true);
      expect((await repository.records()).find(record => record.id === id)!.encryptedPayload).toBe(original);
      await gate.query("SELECT pg_advisory_unlock($1,$2)", [lockA,lockB]);
      await pendingCommit;
    } finally {
      await gate.query("SELECT pg_advisory_unlock($1,$2)", [lockA,lockB]);
      await db.pool.query("DROP TRIGGER hold_rotation_insert ON app.integration_records");
      await db.pool.query("DROP FUNCTION app.hold_rotation_insert()");
      gate.release();
    }
    const committed = await repository.commitGeneration(generationId, baseRevision);
    expect(committed).toEqual({ revision: baseRevision + 1, duplicate: true });
    // Simulate the caller losing the response after the transaction committed.
    expect(await repository.commitGeneration(generationId, baseRevision)).toEqual({ ...committed, duplicate: true });
    await expect(repository.write({ id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), expectedRevision: baseRevision, operation: "upsert", kind: "model", name: "Stale generation write", origin: null, description: null, encryptedPayload: await userEncrypt("stale write") })).rejects.toMatchObject({ name: "StaleIntegrationRevisionError", currentRevision: committed.revision });
    expect((await repository.records()).find(record => record.id === id)!.encryptedPayload).toBe(rotated);
    const activeTombstone = await db.pool.query("SELECT deleted_at,encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2", [tenantId,tombstoneId]);
    expect(activeTombstone.rows[0].encrypted_payload).toBeNull();
    expect(activeTombstone.rows[0].deleted_at).toBeInstanceOf(Date);
    expect((await repository.changesSince(0)).map(change => change.encryptedPayload)).toEqual([rotated, tombstoneCipher, null]);
  });

  it("rejects a staged generation after concurrent writes and bounds rollback to the active commit", async () => {
    const { repository, tenantId } = await freshRepository();
    const originalId = crypto.randomUUID(), original = await userEncrypt("preserved credential");
    const first = await repository.write({ id: originalId, idempotencyKey: crypto.randomUUID(), expectedRevision: 0, operation: "upsert", kind: "model", name: "Preserved", origin: null, description: null, encryptedPayload: original });
    const replacementId = crypto.randomUUID(), replacement = await userEncrypt("replacement credential");
    const staged = { generationId: crypto.randomUUID(), expectedRevision: first.revision, records: [{ id: replacementId, kind: "model" as const, name: "Replacement", origin: null, description: null, revision: first.revision, encryptedPayload: replacement, deletedAt: null }], changes: [{ id: replacementId, idempotencyKey: crypto.randomUUID(), kind: "model" as const, name: "Replacement", origin: null, description: null, revision: first.revision, operation: "upsert" as const, encryptedPayload: replacement }] };
    await repository.stageGeneration(staged);
    await repository.write({ id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), expectedRevision: first.revision, operation: "upsert", kind: "model", name: "Concurrent", origin: null, description: null, encryptedPayload: await userEncrypt("concurrent edit") });
    await expect(repository.commitGeneration(staged.generationId, first.revision)).rejects.toMatchObject({ name: "StaleIntegrationGenerationError", currentRevision: first.revision + 1 });
    expect((await repository.records()).map(record => record.name)).toEqual(["Preserved", "Concurrent"]);

    const baseRevision = await repository.revision(), rotated = await userEncrypt("rotated preserved credential"), generationId = crypto.randomUUID();
    const activeRecords = await repository.records();
    const currentChanges = await repository.changesSince(0, 500);
    await repository.stageGeneration({ generationId, expectedRevision: baseRevision,
      records: activeRecords.map(record => ({ ...record, encryptedPayload: record.id === originalId ? rotated : record.encryptedPayload, deletedAt: null })),
      changes: currentChanges.map(change => ({ ...change, idempotencyKey: crypto.randomUUID(), encryptedPayload: change.operation === "upsert" && change.id === originalId ? rotated : change.encryptedPayload })) });
    const committed = await repository.commitGeneration(generationId, baseRevision);
    expect((await repository.records()).find(record => record.id === originalId)!.encryptedPayload).toBe(rotated);
    expect(await repository.rollbackGeneration(generationId)).toBe(committed.revision + 1);
    expect((await repository.records()).find(record => record.id === originalId)!.encryptedPayload).toBe(original);
    await expect(repository.rollbackGeneration(generationId)).rejects.toThrow("not available for rollback");
    expect(await repository.cleanupGenerations(0, 500)).toBeGreaterThanOrEqual(1);
    expect((await db.pool.query("SELECT 1 FROM app.integration_generation_journal WHERE tenant_id=$1 AND generation_id=$2", [tenantId,generationId])).rowCount).toBe(0);
  });
});

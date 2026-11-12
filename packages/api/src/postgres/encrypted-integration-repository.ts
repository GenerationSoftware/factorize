import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";

export type EncryptedIntegrationKind = "bearer" | "model";
export type IntegrationMetadata = { id: string; kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null };
export type IntegrationWrite = IntegrationMetadata & {
  expectedRevision: number;
  idempotencyKey: string;
  operation: "upsert" | "delete";
  /** Ciphertext produced with the user's unlock key. This repository never interprets it. */
  encryptedPayload?: string;
};
export type IntegrationChange = IntegrationMetadata & {
  revision: number;
  operation: "upsert" | "delete";
  encryptedPayload: string | null;
};

export type GenerationRecord = IntegrationMetadata & { revision: number; encryptedPayload: string | null; deletedAt: Date | null };
export type GenerationChange = IntegrationMetadata & { revision: number; idempotencyKey: string; operation: "upsert" | "delete"; encryptedPayload: string | null };

export class StaleIntegrationRevisionError extends Error {
  constructor(readonly currentRevision: number) { super("Integration collection revision is stale"); this.name = "StaleIntegrationRevisionError"; }
}
export class IntegrationIdempotencyConflictError extends Error {
  constructor() { super("Integration idempotency key was already used for a different change"); this.name = "IntegrationIdempotencyConflictError"; }
}
export class StaleIntegrationGenerationError extends Error {
  constructor(readonly currentRevision: number) { super("Integration generation changed while rotation was staged"); this.name = "StaleIntegrationGenerationError"; }
}
export class IntegrationValidationError extends Error {
  constructor(message: string) { super(message); this.name = "IntegrationValidationError"; }
}

type StoredChange = {
  revision: string | number; operation: "upsert" | "delete"; record_id: string; kind: EncryptedIntegrationKind;
  name: string; origin: string | null; description: string | null; encrypted_payload: string | null;
};

function safeRevision(value: string | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Stored integration revision exceeds supported range");
  return number;
}

function isUserCiphertext(value: string): boolean {
  if (value.length > 65_536) return false;
  const [encodedIv, encodedBody, extra] = value.split(".");
  if (!encodedIv || !encodedBody || extra !== undefined) return false;
  try {
    const iv = atob(encodedIv), body = atob(encodedBody);
    return iv.length === 12 && body.length >= 16
      && btoa(iv) === encodedIv && btoa(body) === encodedBody;
  } catch { return false; }
}

function validate(change: IntegrationWrite): void {
  if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new IntegrationValidationError("expectedRevision must be a non-negative safe integer");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(change.id) || !uuid.test(change.idempotencyKey)) throw new IntegrationValidationError("id and idempotencyKey must be UUIDs");
  if (change.kind !== "bearer" && change.kind !== "model") throw new IntegrationValidationError("Unsupported integration kind");
  if (!change.name.trim() || change.name.length > 120) throw new IntegrationValidationError("name must contain 1 to 120 characters");
  if (change.description !== null && change.description.length > 500) throw new IntegrationValidationError("description must be at most 500 characters");
  if (change.kind === "bearer" && (!change.origin || change.origin.length > 2048)) throw new IntegrationValidationError("bearer integrations require an origin of at most 2048 characters");
  if (change.kind === "model" && change.origin !== null) throw new IntegrationValidationError("model accounts do not have an origin");
  if (change.operation === "upsert" && (typeof change.encryptedPayload !== "string" || !isUserCiphertext(change.encryptedPayload))) throw new IntegrationValidationError("upserts require a valid user-encrypted AES-GCM ciphertext envelope");
  if (change.operation === "delete" && change.encryptedPayload !== undefined) throw new IntegrationValidationError("deletions cannot contain ciphertext");
}

export class EncryptedIntegrationRepository {
  constructor(private database: Database, private tenantId: string, private serverEncryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async revision(): Promise<number> {
    const { rows } = await this.database.pool.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1", [this.tenantId]);
    return rows.length ? safeRevision(rows[0]!.revision) : 0;
  }

  async write(input: IntegrationWrite): Promise<{ revision: number; duplicate: boolean }> {
    validate(input);
    const encryptedPayload = input.operation === "upsert" ? await encrypt(input.encryptedPayload!, this.serverEncryptionKey) : null;
    const metadata = [input.id, input.kind, input.name, input.origin, input.description, input.operation, encryptedPayload];
    return this.database.transaction(async client => {
      const existing = async () => (await client.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND idempotency_key=$2", [this.tenantId, input.idempotencyKey])).rows[0];
      const isSame = async (row: StoredChange) => row.record_id === metadata[0] && row.kind === metadata[1] && row.name === metadata[2] && row.origin === metadata[3] && row.description === metadata[4] && row.operation === metadata[5] && (row.encrypted_payload === null ? encryptedPayload === null : encryptedPayload !== null && await decrypt(row.encrypted_payload, this.serverEncryptionKey) === input.encryptedPayload);
      const duplicate = await existing();
      if (duplicate) {
        if (!await isSame(duplicate)) throw new IntegrationIdempotencyConflictError();
        return { revision: safeRevision(duplicate.revision), duplicate: true };
      }

      await client.query("INSERT INTO app.integration_collections(tenant_id) VALUES ($1) ON CONFLICT DO NOTHING", [this.tenantId]);
      const bumped = await client.query<{ revision: string | number }>("UPDATE app.integration_collections SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND revision=$2 RETURNING revision", [this.tenantId, input.expectedRevision]);
      if (!bumped.rows.length) {
        const racedDuplicate = await existing();
        if (racedDuplicate) {
          if (!await isSame(racedDuplicate)) throw new IntegrationIdempotencyConflictError();
          return { revision: safeRevision(racedDuplicate.revision), duplicate: true };
        }
        const current = await client.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1", [this.tenantId]);
        throw new StaleIntegrationRevisionError(safeRevision(current.rows[0]!.revision));
      }
      const revision = safeRevision(bumped.rows[0]!.revision);

      if (input.operation === "upsert") {
        await client.query(`INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
          ON CONFLICT (tenant_id,id) DO UPDATE SET kind=excluded.kind,name=excluded.name,origin=excluded.origin,description=excluded.description,revision=excluded.revision,encrypted_payload=excluded.encrypted_payload,deleted_at=NULL,updated_at=now()`,
          [this.tenantId, input.id, input.kind, input.name, input.origin, input.description, revision, encryptedPayload]);
      } else {
        await client.query(`INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,now())
          ON CONFLICT (tenant_id,id) DO UPDATE SET kind=excluded.kind,name=excluded.name,origin=excluded.origin,description=excluded.description,revision=excluded.revision,encrypted_payload=NULL,deleted_at=now(),updated_at=now()`,
          [this.tenantId, input.id, input.kind, input.name, input.origin, input.description, revision]);
      }
      await client.query(`INSERT INTO app.integration_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [this.tenantId, revision, crypto.randomUUID(), input.idempotencyKey, input.operation, input.id, input.kind, input.name, input.origin, input.description, encryptedPayload]);
      return { revision, duplicate: false };
    });
  }

  async records(kind?: EncryptedIntegrationKind): Promise<Array<IntegrationMetadata & { revision: number; encryptedPayload: string }>> {
    const { rows } = await this.database.pool.query<{ id: string; kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number; encrypted_payload: string }>(
      `SELECT id,kind,name,origin,description,revision,encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND deleted_at IS NULL${kind ? " AND kind=$2" : ""} ORDER BY revision,id`, kind ? [this.tenantId, kind] : [this.tenantId]);
    return Promise.all(rows.map(async row => ({ id: row.id, kind: row.kind, name: row.name, origin: row.origin, description: row.description, revision: safeRevision(row.revision), encryptedPayload: await decrypt(row.encrypted_payload, this.serverEncryptionKey) })));
  }

  /**
   * Replace only a model account's user-encrypted Codex cache. The account
   * revision is independent of the collection revision, so unrelated bearer
   * edits do not invalidate the cache's authenticated-encryption binding.
   */
  async saveModelCache(input: { id: string; expectedRevision: number; encryptedPayload: string; idempotencyKey: string }): Promise<{ revision: number; collectionRevision: number; duplicate: boolean }> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(input.id) || !uuid.test(input.idempotencyKey) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !isUserCiphertext(input.encryptedPayload)) throw new IntegrationValidationError("model cache binding is invalid");
    const encryptedPayload = await encrypt(input.encryptedPayload, this.serverEncryptionKey);
    return this.database.transaction(async client => {
      await client.query("INSERT INTO app.integration_collections(tenant_id) VALUES ($1) ON CONFLICT DO NOTHING", [this.tenantId]);
      const collection = (await client.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1 FOR UPDATE", [this.tenantId])).rows[0]!;
      const currentCollectionRevision = safeRevision(collection.revision);
      const current = (await client.query<{ kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number; encrypted_payload: string | null; deleted_at: Date | null }>(
        "SELECT kind,name,origin,description,revision,encrypted_payload,deleted_at FROM app.integration_records WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenantId, input.id])).rows[0];
      if (!current || current.kind !== "model" || current.deleted_at || current.revision === null) throw new IntegrationValidationError("model account is unavailable");
      const currentRevision = safeRevision(current.revision);
      const previousChange = (await client.query<{ revision: string | number; record_id: string; operation: string; encrypted_payload: string | null }>(
        "SELECT revision,record_id,operation,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND idempotency_key=$2", [this.tenantId,input.idempotencyKey])).rows[0];
      if (previousChange) {
        const same = previousChange.record_id === input.id && previousChange.operation === "upsert" && previousChange.encrypted_payload !== null
          && await decrypt(previousChange.encrypted_payload, this.serverEncryptionKey) === input.encryptedPayload;
        if (!same) throw new IntegrationIdempotencyConflictError();
        return { revision: Math.max(0, input.expectedRevision + 1), collectionRevision: safeRevision(previousChange.revision), duplicate: true };
      }
      if (currentRevision !== input.expectedRevision) throw new StaleIntegrationRevisionError(currentRevision);
      const collectionRevision = currentCollectionRevision + 1;
      const revision = currentRevision + 1;
      await client.query("UPDATE app.integration_collections SET revision=$2,updated_at=now() WHERE tenant_id=$1", [this.tenantId, collectionRevision]);
      await client.query("UPDATE app.integration_records SET revision=$3,encrypted_payload=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2", [this.tenantId,input.id,revision,encryptedPayload]);
      await client.query(`INSERT INTO app.integration_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload)
        VALUES ($1,$2,$3,$4,'upsert',$5,'model',$6,NULL,$7,$8)`, [this.tenantId,collectionRevision,crypto.randomUUID(),input.idempotencyKey,input.id,current.name,current.description,encryptedPayload]);
      return { revision, collectionRevision, duplicate: false };
    });
  }

  async changesSince(revision: number, limit = 100): Promise<IntegrationChange[]> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new IntegrationValidationError("revision must be a non-negative safe integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new IntegrationValidationError("limit must be between 1 and 500");
    const { rows } = await this.database.pool.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND revision>$2 ORDER BY revision LIMIT $3", [this.tenantId, revision, limit]);
    return Promise.all(rows.map(async row => ({ id: row.record_id, kind: row.kind, name: row.name, origin: row.origin, description: row.description, revision: safeRevision(row.revision), operation: row.operation, encryptedPayload: row.encrypted_payload === null ? null : await decrypt(row.encrypted_payload, this.serverEncryptionKey) })));
  }

  /** Store one complete replacement generation. Payloads must already be user-encrypted. */
  async stageGeneration(input: { generationId: string; expectedRevision: number; records: GenerationRecord[]; changes: GenerationChange[] }): Promise<{ duplicate: boolean }> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(input.generationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new IntegrationValidationError("generationId and expectedRevision are invalid");
    if (input.records.length > 5000 || input.changes.length > 10000) throw new IntegrationValidationError("generation exceeds staging limits");
    for (const record of input.records) {
      if (!uuid.test(record.id) || (record.encryptedPayload !== null && !isUserCiphertext(record.encryptedPayload)) || (record.deletedAt === null) !== (record.encryptedPayload !== null)) throw new IntegrationValidationError("generation records must contain ciphertext or a tombstone");
    }
    for (const change of input.changes) {
      if (!uuid.test(change.id) || !uuid.test(change.idempotencyKey) || !Number.isSafeInteger(change.revision) || change.revision < 1 || (change.encryptedPayload !== null && !isUserCiphertext(change.encryptedPayload)) || (change.operation === "upsert") !== (change.encryptedPayload !== null)) throw new IntegrationValidationError("generation changes must contain ordered ciphertext or tombstones");
    }
    const canonical = JSON.stringify({
      records: [...input.records].sort((a,b) => a.id.localeCompare(b.id)).map(row => ({ ...row, deletedAt: row.deletedAt?.toISOString() ?? null })),
      changes: [...input.changes].sort((a,b) => a.revision - b.revision).map(row => ({ ...row })),
    });
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
    const contentHash = Array.from(hashBytes, byte => byte.toString(16).padStart(2,"0")).join("");
    return this.database.transaction(async client => {
      const prior = (await client.query<{ expected_revision: string | number; state: string; content_hash: string }>("SELECT expected_revision,state,content_hash FROM app.integration_generation_journal WHERE tenant_id=$1 AND generation_id=$2 FOR UPDATE", [this.tenantId, input.generationId])).rows[0];
      if (prior) {
        if (safeRevision(prior.expected_revision) !== input.expectedRevision || prior.content_hash !== contentHash || prior.state === "expired" || prior.state === "rolled_back") throw new IntegrationIdempotencyConflictError();
        return { duplicate: true };
      }
      await client.query("INSERT INTO app.integration_generation_journal(tenant_id,generation_id,expected_revision,content_hash,state) VALUES($1,$2,$3,$4,'staged')", [this.tenantId, input.generationId, input.expectedRevision,contentHash]);
      for (const row of input.records) await client.query(`INSERT INTO app.integration_generation_records(tenant_id,generation_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [this.tenantId,input.generationId,row.id,row.kind,row.name,row.origin,row.description,row.revision,row.encryptedPayload,row.deletedAt]);
      for (const row of input.changes) await client.query(`INSERT INTO app.integration_generation_changes(tenant_id,generation_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [this.tenantId,input.generationId,row.revision,row.id,row.idempotencyKey,row.operation,row.id,row.kind,row.name,row.origin,row.description,row.encryptedPayload]);
      return { duplicate: false };
    });
  }

  /** Atomically archive and replace records, tombstones, changes and the collection revision. */
  async commitGeneration(generationId: string, expectedRevision: number): Promise<{ revision: number; duplicate: boolean }> {
    return this.database.transaction(async client => {
      await client.query("INSERT INTO app.integration_collections(tenant_id) VALUES($1) ON CONFLICT DO NOTHING", [this.tenantId]);
      const collection = (await client.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1 FOR UPDATE", [this.tenantId])).rows[0]!;
      const current = safeRevision(collection.revision);
      const journal = (await client.query<{ expected_revision: string | number; state: string; committed_revision: string | number | null }>("SELECT expected_revision,state,committed_revision FROM app.integration_generation_journal WHERE tenant_id=$1 AND generation_id=$2 FOR UPDATE", [this.tenantId,generationId])).rows[0];
      if (!journal || safeRevision(journal.expected_revision) !== expectedRevision) throw new IntegrationValidationError("staged generation was not found for this revision");
      if (journal.state === "committed") return { revision: safeRevision(journal.committed_revision!), duplicate: true };
      if (journal.state !== "staged") throw new IntegrationValidationError("staged generation is no longer available");
      if (current !== expectedRevision) throw new StaleIntegrationGenerationError(current);
      await client.query("DELETE FROM app.integration_generation_previous_records WHERE tenant_id=$1", [this.tenantId]);
      await client.query("DELETE FROM app.integration_generation_previous_changes WHERE tenant_id=$1", [this.tenantId]);
      await client.query(`INSERT INTO app.integration_generation_previous_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at,created_at,updated_at,generation_id) SELECT tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at,created_at,updated_at,$2 FROM app.integration_records WHERE tenant_id=$1`, [this.tenantId,generationId]);
      await client.query(`INSERT INTO app.integration_generation_previous_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload,created_at,generation_id) SELECT tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload,created_at,$2 FROM app.integration_changes WHERE tenant_id=$1`, [this.tenantId,generationId]);
      await client.query("DELETE FROM app.integration_records WHERE tenant_id=$1", [this.tenantId]);
      const records = (await client.query<{ id: string; kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number; encrypted_payload: string | null; deleted_at: Date | null }>("SELECT id,kind,name,origin,description,revision,encrypted_payload,deleted_at FROM app.integration_generation_records WHERE tenant_id=$1 AND generation_id=$2", [this.tenantId,generationId])).rows;
      for (const row of records) await client.query(`INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [this.tenantId,row.id,row.kind,row.name,row.origin,row.description,row.revision,row.encrypted_payload === null ? null : await encrypt(row.encrypted_payload,this.serverEncryptionKey),row.deleted_at]);
      await client.query("DELETE FROM app.integration_changes WHERE tenant_id=$1", [this.tenantId]);
      const changes = (await client.query<{ revision: string | number; id: string; idempotency_key: string; operation: "upsert" | "delete"; record_id: string; kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null; encrypted_payload: string | null }>("SELECT revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_generation_changes WHERE tenant_id=$1 AND generation_id=$2 ORDER BY revision", [this.tenantId,generationId])).rows;
      for (const row of changes) await client.query(`INSERT INTO app.integration_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [this.tenantId,row.revision,row.id,row.idempotency_key,row.operation,row.record_id,row.kind,row.name,row.origin,row.description,row.encrypted_payload === null ? null : await encrypt(row.encrypted_payload,this.serverEncryptionKey)]);
      const revision = current + 1;
      await client.query("UPDATE app.integration_collections SET revision=$2,updated_at=now() WHERE tenant_id=$1", [this.tenantId,revision]);
      await client.query("UPDATE app.integration_generation_journal SET state='committed',committed_revision=$3,committed_at=now() WHERE tenant_id=$1 AND generation_id=$2", [this.tenantId,generationId,revision]);
      return { revision, duplicate: false };
    });
  }

  /** Restore the previous generation only while this commit is still the active revision. */
  async rollbackGeneration(generationId: string): Promise<number> {
    return this.database.transaction(async client => {
      const collection = (await client.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1 FOR UPDATE", [this.tenantId])).rows[0];
      const journal = (await client.query<{ state: string; committed_revision: string | number | null }>("SELECT state,committed_revision FROM app.integration_generation_journal WHERE tenant_id=$1 AND generation_id=$2 FOR UPDATE", [this.tenantId,generationId])).rows[0];
      if (!collection || !journal || journal.state !== "committed") throw new IntegrationValidationError("committed generation is not available for rollback");
      const current = safeRevision(collection.revision);
      if (current !== safeRevision(journal.committed_revision!)) throw new StaleIntegrationGenerationError(current);
      await client.query("DELETE FROM app.integration_records WHERE tenant_id=$1", [this.tenantId]);
      await client.query(`INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at,created_at,updated_at) SELECT tenant_id,id,kind,name,origin,description,revision,encrypted_payload,deleted_at,created_at,updated_at FROM app.integration_generation_previous_records WHERE tenant_id=$1 AND generation_id=$2`, [this.tenantId,generationId]);
      await client.query("DELETE FROM app.integration_changes WHERE tenant_id=$1", [this.tenantId]);
      await client.query(`INSERT INTO app.integration_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload,created_at) SELECT tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload,created_at FROM app.integration_generation_previous_changes WHERE tenant_id=$1 AND generation_id=$2`, [this.tenantId,generationId]);
      const revision = current + 1;
      await client.query("UPDATE app.integration_collections SET revision=$2,updated_at=now() WHERE tenant_id=$1", [this.tenantId,revision]);
      await client.query("UPDATE app.integration_generation_journal SET state='rolled_back' WHERE tenant_id=$1 AND generation_id=$2", [this.tenantId,generationId]);
      return revision;
    });
  }

  /** Delete at most `limit` expired journals; committed archives are retained for at most maxAgeMs. */
  async cleanupGenerations(maxAgeMs: number, limit = 100): Promise<number> {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new IntegrationValidationError("cleanup bounds are invalid");
    return this.database.transaction(async client => {
      const expired = (await client.query<{ generation_id: string }>(`SELECT generation_id FROM app.integration_generation_journal WHERE tenant_id=$1 AND created_at < now() - ($2::bigint * interval '1 millisecond') ORDER BY created_at LIMIT $3 FOR UPDATE`, [this.tenantId,maxAgeMs,limit])).rows.map(row => row.generation_id);
      if (!expired.length) return 0;
      await client.query("DELETE FROM app.integration_generation_previous_records WHERE tenant_id=$1 AND generation_id=ANY($2::uuid[])", [this.tenantId,expired]);
      await client.query("DELETE FROM app.integration_generation_previous_changes WHERE tenant_id=$1 AND generation_id=ANY($2::uuid[])", [this.tenantId,expired]);
      await client.query("DELETE FROM app.integration_generation_journal WHERE tenant_id=$1 AND generation_id=ANY($2::uuid[])", [this.tenantId,expired]);
      return expired.length;
    });
  }
}

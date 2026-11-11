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

export class StaleIntegrationRevisionError extends Error {
  constructor(readonly currentRevision: number) { super("Integration collection revision is stale"); this.name = "StaleIntegrationRevisionError"; }
}
export class IntegrationIdempotencyConflictError extends Error {
  constructor() { super("Integration idempotency key was already used for a different change"); this.name = "IntegrationIdempotencyConflictError"; }
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

function validate(change: IntegrationWrite): void {
  if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new IntegrationValidationError("expectedRevision must be a non-negative safe integer");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(change.id) || !uuid.test(change.idempotencyKey)) throw new IntegrationValidationError("id and idempotencyKey must be UUIDs");
  if (change.kind !== "bearer" && change.kind !== "model") throw new IntegrationValidationError("Unsupported integration kind");
  if (!change.name.trim() || change.name.length > 120) throw new IntegrationValidationError("name must contain 1 to 120 characters");
  if (change.description !== null && change.description.length > 500) throw new IntegrationValidationError("description must be at most 500 characters");
  if (change.kind === "bearer" && (!change.origin || change.origin.length > 2048)) throw new IntegrationValidationError("bearer integrations require an origin of at most 2048 characters");
  if (change.kind === "model" && change.origin !== null) throw new IntegrationValidationError("model accounts do not have an origin");
  if (change.operation === "upsert" && (typeof change.encryptedPayload !== "string" || !change.encryptedPayload.length)) throw new IntegrationValidationError("upserts require user-encrypted ciphertext");
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

  async records(): Promise<Array<IntegrationMetadata & { revision: number; encryptedPayload: string }>> {
    const { rows } = await this.database.pool.query<{ id: string; kind: EncryptedIntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number; encrypted_payload: string }>(
      "SELECT id,kind,name,origin,description,revision,encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY revision,id", [this.tenantId]);
    return Promise.all(rows.map(async row => ({ id: row.id, kind: row.kind, name: row.name, origin: row.origin, description: row.description, revision: safeRevision(row.revision), encryptedPayload: await decrypt(row.encrypted_payload, this.serverEncryptionKey) })));
  }

  async changesSince(revision: number, limit = 100): Promise<IntegrationChange[]> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new IntegrationValidationError("revision must be a non-negative safe integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new IntegrationValidationError("limit must be between 1 and 500");
    const { rows } = await this.database.pool.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND revision>$2 ORDER BY revision LIMIT $3", [this.tenantId, revision, limit]);
    return Promise.all(rows.map(async row => ({ id: row.record_id, kind: row.kind, name: row.name, origin: row.origin, description: row.description, revision: safeRevision(row.revision), operation: row.operation, encryptedPayload: row.encrypted_payload === null ? null : await decrypt(row.encrypted_payload, this.serverEncryptionKey) })));
  }
}

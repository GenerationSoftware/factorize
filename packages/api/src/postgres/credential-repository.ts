import {decrypt, encrypt} from "../crypto";
import type {Database, DatabaseClient} from "./database";

export type IntegrationKind = "bearer";
export type IntegrationMetadata = {id: string; kind: IntegrationKind; name: string; origin: string | null; description: string | null};
export type IntegrationWrite = IntegrationMetadata & {expectedRevision: number; idempotencyKey: string; operation: "upsert" | "delete"; managedSecret?: string};
export const MANAGED_BEARER_PREFIX = "factorize-managed-bearer-v1:";
export class StaleIntegrationRevisionError extends Error { constructor(readonly currentRevision: number) {super("Integration collection revision is stale"); this.name="StaleIntegrationRevisionError";} }
export class IntegrationIdempotencyConflictError extends Error { constructor() {super("Integration idempotency key was already used for a different change"); this.name="IntegrationIdempotencyConflictError";} }
export class IntegrationValidationError extends Error { constructor(message: string) {super(message); this.name="IntegrationValidationError";} }
type StoredChange = {revision: string | number; operation: "upsert" | "delete"; record_id: string; kind: IntegrationKind; name: string; origin: string | null; description: string | null; encrypted_payload: string | null};
function safeRevision(value: string | number): number { const revision=Number(value); if (!Number.isSafeInteger(revision) || revision<0) throw new Error("Stored integration revision exceeds supported range"); return revision; }
function validate(change: IntegrationWrite): void {
  if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision<0) throw new IntegrationValidationError("expectedRevision must be a non-negative safe integer");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(change.id) || !uuid.test(change.idempotencyKey)) throw new IntegrationValidationError("id and idempotencyKey must be UUIDs");
  if (change.kind!=="bearer") throw new IntegrationValidationError("Unsupported integration kind");
  if (!change.name.trim() || change.name.length>120 || (change.description!==null && change.description.length>500)) throw new IntegrationValidationError("Invalid integration metadata");
  if (change.kind==="bearer" && (!change.origin || change.origin.length>2048)) throw new IntegrationValidationError("Bearer integrations require an origin");
  if (change.managedSecret!==undefined && change.kind!=="bearer") throw new IntegrationValidationError("Credential kind does not match its payload");
  if (change.operation==="delete") { if (change.managedSecret!==undefined) throw new IntegrationValidationError("Deletions cannot contain a credential"); return; }
  if (change.operation!=="upsert") throw new IntegrationValidationError("Invalid credential operation");
  if (change.kind==="bearer" && (typeof change.managedSecret!=="string" || !change.managedSecret || change.managedSecret.length>32768 || /[\r\n]/.test(change.managedSecret))) throw new IntegrationValidationError("A bearer credential value is required");
}

/** All credentials are encrypted by Factorize. Public reads expose metadata
 * only; exactly selected credentials are resolved through managedCredential. */
export class CredentialRepository {
  constructor(private database: Database, private tenantId: string, private serverEncryptionKey: string) {if (!tenantId) throw new Error("tenantId is required");}
  async revision(): Promise<number> {
    const { rows } = await this.database.pool.query<{ revision: string | number }>("SELECT revision FROM app.integration_collections WHERE tenant_id=$1", [this.tenantId]);
    return rows.length ? safeRevision(rows[0]!.revision) : 0;
  }

  /** Recognize an exact retry before collection-level create checks run. */
  async replay(input: IntegrationWrite): Promise<{ revision: number; duplicate: true } | null> {
    validate(input);
    const { rows } = await this.database.pool.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND idempotency_key=$2", [this.tenantId, input.idempotencyKey]);
    const row = rows[0];
    if (!row) return null;
    const suppliedPayload = input.managedSecret !== undefined ? `${MANAGED_BEARER_PREFIX}${input.managedSecret}` : undefined;
    const sameCiphertext = row.encrypted_payload === null
      ? input.operation === "delete"
      : input.operation === "upsert" && typeof suppliedPayload === "string" && await decrypt(row.encrypted_payload, this.serverEncryptionKey) === suppliedPayload;
    if (row.record_id !== input.id || row.kind !== input.kind || row.name !== input.name || row.origin !== input.origin
        || row.description !== input.description || row.operation !== input.operation || !sameCiphertext) {
      throw new IntegrationIdempotencyConflictError();
    }
    return { revision: safeRevision(row.revision), duplicate: true };
  }

  /** Recognize a delete retry after its active record has already become a tombstone. */
  async replayDelete(id: string, kind: IntegrationKind, idempotencyKey: string): Promise<{ revision: number; duplicate: true } | null> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id) || !uuid.test(idempotencyKey)) throw new IntegrationValidationError("id and idempotencyKey must be UUIDs");
    const { rows } = await this.database.pool.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND idempotency_key=$2", [this.tenantId, idempotencyKey]);
    const row = rows[0];
    if (!row) return null;
    if (row.record_id !== id || row.kind !== kind || row.operation !== "delete" || row.encrypted_payload !== null) throw new IntegrationIdempotencyConflictError();
    return { revision: safeRevision(row.revision), duplicate: true };
  }

  async write(input: IntegrationWrite, transaction?: DatabaseClient): Promise<{ revision: number; duplicate: boolean }> {
    validate(input);
    const suppliedPayload = input.managedSecret !== undefined ? `${MANAGED_BEARER_PREFIX}${input.managedSecret}` : undefined;
    const encryptedPayload = input.operation === "upsert" ? await encrypt(suppliedPayload!, this.serverEncryptionKey) : null;
    const metadata = [input.id, input.kind, input.name, input.origin, input.description, input.operation, encryptedPayload];
    const write = async (client: DatabaseClient) => {
      const existing = async () => (await client.query<StoredChange>("SELECT revision,operation,record_id,kind,name,origin,description,encrypted_payload FROM app.integration_changes WHERE tenant_id=$1 AND idempotency_key=$2", [this.tenantId, input.idempotencyKey])).rows[0];
      const isSame = async (row: StoredChange) => row.record_id === metadata[0] && row.kind === metadata[1] && row.name === metadata[2] && row.origin === metadata[3] && row.description === metadata[4] && row.operation === metadata[5] && (row.encrypted_payload === null ? encryptedPayload === null : encryptedPayload !== null && await decrypt(row.encrypted_payload, this.serverEncryptionKey) === suppliedPayload);
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
    };
    return transaction ? write(transaction) : this.database.transaction(write);
  }

  /** Resolve exactly one selected live credential. Legacy user ciphertext is
   * deliberately unavailable to the managed backend and requires re-entry. */
  async managedCredential(id: string, kind: IntegrationKind): Promise<(IntegrationMetadata & { revision: number; payload: string }) | null> {
    const row = (await this.database.pool.query<{ id: string; kind: IntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number; encrypted_payload: string }>(
      "SELECT id,kind,name,origin,description,revision,encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2 AND kind=$3 AND deleted_at IS NULL", [this.tenantId, id, kind])).rows[0];
    if (!row) return null;
    const plain = await decrypt(row.encrypted_payload, this.serverEncryptionKey);
    if (!plain.startsWith(MANAGED_BEARER_PREFIX)) return null;
    return { id: row.id, kind: row.kind, name: row.name, origin: row.origin, description: row.description,
      revision: safeRevision(row.revision), payload: plain.slice(MANAGED_BEARER_PREFIX.length) };
  }

  async metadata(kind?: IntegrationKind): Promise<Array<IntegrationMetadata & {revision: number}>> {
    const {rows}=await this.database.pool.query<{id: string; kind: IntegrationKind; name: string; origin: string | null; description: string | null; revision: string | number}>(
      `SELECT id,kind,name,origin,description,revision FROM app.integration_records WHERE tenant_id=$1 AND deleted_at IS NULL${kind ? " AND kind=$2" : ""} ORDER BY revision,id`, kind ? [this.tenantId,kind] : [this.tenantId]);
    return rows.map(row=>({...row,revision:safeRevision(row.revision)}));
  }
}

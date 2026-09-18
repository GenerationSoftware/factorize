import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";

export class ConnectionRepository {
  constructor(private database: Database, private tenantId: string, private encryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }
  async get<T>(kind: string): Promise<T | null> {
    const row = (await this.database.pool.query<{ encrypted_value: string }>("SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, kind])).rows[0];
    if (!row) return null;
    return JSON.parse(await decrypt(row.encrypted_value, this.encryptionKey)) as T;
  }
  async put(kind: string, value: unknown): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(value), this.encryptionKey);
    await this.database.pool.query(`INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id,kind) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()`, [this.tenantId, kind, encrypted]);
  }
  async delete(kind: string): Promise<boolean> { return Boolean((await this.database.pool.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, kind])).rowCount); }
  async kinds(prefix?: string): Promise<string[]> {
    const result = prefix
      ? await this.database.pool.query<{ kind: string }>("SELECT kind FROM app.connections WHERE tenant_id=$1 AND kind LIKE $2 ORDER BY kind", [this.tenantId, `${prefix}%`])
      : await this.database.pool.query<{ kind: string }>("SELECT kind FROM app.connections WHERE tenant_id=$1 ORDER BY kind", [this.tenantId]);
    return result.rows.map(row => row.kind);
  }
}

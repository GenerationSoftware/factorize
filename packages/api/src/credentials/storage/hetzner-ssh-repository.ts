import { z } from "zod";
import { decrypt, encrypt } from "../../crypto";
import type { Database, DatabaseClient } from "../../postgres/database";
import { hetznerSshTarget } from "../../integrations/api/hetzner-ssh-contracts";

export const storedHetznerSshHost = hetznerSshTarget.extend({
  version: z.uuid(), connectionRevision: z.uuid(), ownerId: z.uuid(),
  address: z.ipv4(), privateKey: z.string().min(1),
});
export type StoredHetznerSshHost = z.infer<typeof storedHetznerSshHost>;
type Query = Pick<DatabaseClient, "query">;

const prefix = "hetzner-ssh:";
export class HetznerSshRepository {
  constructor(private database: Database, private tenantId: string, private key: string) {}

  async listForOwner(ownerId: string) {
    const { rows } = await this.database.pool.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind LIKE $2 ORDER BY kind",
      [this.tenantId, prefix + "%"],
    );
    return (await Promise.all(rows.map(async row => storedHetznerSshHost.parse(JSON.parse(await decrypt(row.encrypted_value, this.key))))))
      .filter(host => host.ownerId === ownerId);
  }

  async get(serverId: number, sql: Query = this.database.pool) {
    const { rows } = await sql.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2",
      [this.tenantId, prefix + serverId],
    );
    return rows[0] ? storedHetznerSshHost.parse(JSON.parse(await decrypt(rows[0].encrypted_value, this.key))) : null;
  }

  async put(host: StoredHetznerSshHost, sql: Query) {
    const encrypted = await encrypt(JSON.stringify(storedHetznerSshHost.parse(host)), this.key);
    await sql.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)",
      [this.tenantId, prefix + host.serverId, encrypted]);
  }

  async delete(serverId: number, sql: Query) {
    await sql.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, prefix + serverId]);
  }
}

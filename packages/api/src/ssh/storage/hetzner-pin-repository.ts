import type { z } from "zod";
import { decrypt, encrypt } from "../../crypto";
import type { DatabaseClient } from "../../postgres/database";
import { hetznerSshPin } from "../api/contracts";

export class HetznerSshPinRepository {
  constructor(private sql: DatabaseClient, private tenantId: string, private userId: string, private key: string) {}
  private get prefix() { return "hetzner-command-ssh:" + this.userId + ":"; }

  private async parse(value: string) { return hetznerSshPin.parse(JSON.parse(await decrypt(value, this.key))); }

  async get(serverId: number) {
    const { rows } = await this.sql.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, this.prefix + serverId]);
    return rows[0] ? this.parse(rows[0].encrypted_value) : null;
  }

  async list(projectRevision: string) {
    const { rows } = await this.sql.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind LIKE $2 ORDER BY kind LIMIT 100",
      [this.tenantId, this.prefix + "%"]);
    return (await Promise.all(rows.map(row => this.parse(row.encrypted_value)))).filter(pin => pin.projectRevision === projectRevision);
  }

  async save(pin: z.infer<typeof hetznerSshPin>) {
    await this.sql.query(`INSERT INTO app.connections (tenant_id,kind,encrypted_value) VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id,kind) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()`,
      [this.tenantId, this.prefix + pin.serverId, await encrypt(JSON.stringify(pin), this.key)]);
    return pin;
  }

  async remove(serverId: number) {
    const result = await this.sql.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, this.prefix + serverId]);
    return Boolean(result.rowCount);
  }
}

import { decrypt, encrypt } from "../../crypto";
import type { DatabaseClient } from "../../postgres/database";
import { sshTarget, type SshTarget } from "../api/contracts";

export class SshTargetRepository {
  constructor(private sql: DatabaseClient, private tenantId: string, private userId: string, private key: string) {}
  private get prefix() { return "ssh-target:" + this.userId + ":"; }

  private async decode(encryptedValue: string) {
    return sshTarget.parse(JSON.parse(await decrypt(encryptedValue, this.key)));
  }

  async list() {
    const { rows } = await this.sql.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind LIKE $2 ORDER BY kind LIMIT 100",
      [this.tenantId, this.prefix + "%"]
    );
    return Promise.all(rows.map(row => this.decode(row.encrypted_value)));
  }

  async get(id: string) {
    const { rows } = await this.sql.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, this.prefix + id]
    );
    return rows[0] ? this.decode(rows[0].encrypted_value) : null;
  }

  async add(value: SshTarget) {
    await this.sql.query("INSERT INTO app.connections (tenant_id, kind, encrypted_value) VALUES ($1,$2,$3)",
      [this.tenantId, this.prefix + value.id, await encrypt(JSON.stringify(value), this.key)]);
    return value;
  }

  async remove(id: string) {
    const result = await this.sql.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, this.prefix + id]);
    return Boolean(result.rowCount);
  }
}

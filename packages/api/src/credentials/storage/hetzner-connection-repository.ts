import { decrypt, encrypt } from "../../crypto";
import { lockIntegrationTopology } from "../../integrations/storage/integration-removal-topology";
import type { Database, DatabaseClient } from "../../postgres/database";

export type HetznerProject = { name: string; token: string; revision: string; provisioningEnabled?: boolean };

export class HetznerConnectionRepository {
  constructor(private database: Database, private tenantId: string, private encryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  /** Use the transaction's client if its topology lock protects a paired credential write. */
  async get(client: DatabaseClient = this.database.pool): Promise<HetznerProject | null> {
    const { rows } = await client.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind='hetzner'", [this.tenantId]);
    return rows[0] ? JSON.parse(await decrypt(rows[0].encrypted_value, this.encryptionKey)) as HetznerProject : null;
  }

  async save(name: string, token: string, provisioningEnabled = false) {
    const value = await encrypt(JSON.stringify({ name, token, revision: crypto.randomUUID(), provisioningEnabled }), this.encryptionKey);
    await this.database.transaction(async client => {
      await lockIntegrationTopology(client, this.tenantId);
      const hadProject = Boolean(await this.get(client));
      await this.clearSshCredentials(client);
      await client.query(
        `INSERT INTO app.connections (tenant_id,kind,encrypted_value) VALUES ($1,'hetzner',$2)
         ON CONFLICT (tenant_id,kind) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()`,
        [this.tenantId, value]);
      // Existing grants never cross a project/token replacement or gain new provisioning power.
      if (hadProject) await client.query(
        "UPDATE app.agent_integrations SET epoch=epoch+1,revision=revision+1 WHERE tenant_id=$1 AND kind='hetzner' AND credential_id='hetzner'",
        [this.tenantId]);
    });
  }

  async delete(): Promise<boolean> {
    return this.database.transaction(async client => {
      await lockIntegrationTopology(client, this.tenantId);
      await this.clearSshCredentials(client);
      const result = await client.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind='hetzner'", [this.tenantId]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  private async clearSshCredentials(client: DatabaseClient) {
    await client.query("DELETE FROM app.connections WHERE tenant_id=$1 AND (kind LIKE 'hetzner-ssh:%' OR kind LIKE 'hetzner-client-key:%')", [this.tenantId]);
  }
}

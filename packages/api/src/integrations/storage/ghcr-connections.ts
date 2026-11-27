import { decrypt, encrypt } from "../../crypto";
import type { Database } from "../../postgres/database";
import type { GhcrConnection } from "../api/ghcr-contracts";
import { lockIntegrationTopology } from "./integration-removal-topology";

export class GhcrConnections {
  constructor(private db: Database, private tenant: string, private key: string) {}

  async list(): Promise<GhcrConnection[]> {
    return (await this.db.pool.query<GhcrConnection>(
      "SELECT id,image,username,revision FROM app.ghcr_connections WHERE tenant_id=$1 ORDER BY image", [this.tenant])).rows;
  }

  async create(image: string, username: string, token: string) {
    const encrypted = await encrypt(token, this.key);
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.tenant);
      return (await sql.query<GhcrConnection>(`INSERT INTO app.ghcr_connections(tenant_id,image,username,encrypted_token)
        VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,image) DO NOTHING RETURNING id,image,username,revision`,
        [this.tenant,image,username,encrypted])).rows[0];
    });
  }

  async replace(id: string, username: string, token: string, revision: number) {
    const encrypted = await encrypt(token, this.key);
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.tenant);
      return (await sql.query<GhcrConnection>(`UPDATE app.ghcr_connections SET username=$3,encrypted_token=$4,revision=revision+1
        WHERE tenant_id=$1 AND id=$2 AND revision=$5 RETURNING id,image,username,revision`,
        [this.tenant,id,username,encrypted,revision])).rows[0];
    });
  }

  async credential(id: string) {
    const result = (await this.db.pool.query<{ image: string; username: string; encrypted_token: string }>(
      "SELECT image,username,encrypted_token FROM app.ghcr_connections WHERE tenant_id=$1 AND id=$2", [this.tenant,id])).rows[0];
    if (!result) return null;
    return { image: result.image, username: result.username, token: await decrypt(result.encrypted_token, this.key) };
  }
}

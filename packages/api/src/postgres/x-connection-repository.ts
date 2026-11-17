import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";

export type XConnectionMetadata = {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  accountId: string | null;
  accountHandle: string | null;
  grantedScopes: string[];
  status: "pending" | "connected" | "reconnect_required";
  createdAt: string;
  updatedAt: string;
};

type XConnectionRow = XConnectionMetadata & { encrypted_secret: string };

/** Tenant-scoped X app credentials. Client secrets and later OAuth tokens share
 * one encrypted payload; all owner and runtime reads expose metadata only. */
export class XConnectionRepository {
  constructor(private database: Database, private tenantId: string, private encryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async create(input: { id: string; name: string; clientId: string; clientSecret: string; scopes: string[] }): Promise<XConnectionMetadata> {
    const encrypted = await encrypt(JSON.stringify({ clientSecret: input.clientSecret }), this.encryptionKey);
    const { rows } = await this.database.pool.query<XConnectionRow>(
      `INSERT INTO app.x_connections(tenant_id,id,name,client_id,scopes,encrypted_secret,status)
       VALUES($1,$2,$3,$4,$5,$6,'pending')
       RETURNING id,name,client_id AS "clientId",scopes,account_id AS "accountId",account_handle AS "accountHandle",
         granted_scopes AS "grantedScopes",status,created_at AS "createdAt",updated_at AS "updatedAt",encrypted_secret`,
      [this.tenantId, input.id, input.name.trim(), input.clientId.trim(), input.scopes, encrypted],
    );
    return metadata(rows[0]!);
  }

  async get(id: string): Promise<XConnectionMetadata | null> {
    const { rows } = await this.database.pool.query<XConnectionRow>(
      `SELECT id,name,client_id AS "clientId",scopes,account_id AS "accountId",account_handle AS "accountHandle",
        granted_scopes AS "grantedScopes",status,created_at AS "createdAt",updated_at AS "updatedAt",encrypted_secret
       FROM app.x_connections WHERE tenant_id=$1 AND id=$2`, [this.tenantId, id]);
    return rows[0] ? metadata(rows[0]) : null;
  }

  async list(): Promise<XConnectionMetadata[]> {
    const { rows } = await this.database.pool.query<XConnectionRow>(
      `SELECT id,name,client_id AS "clientId",scopes,account_id AS "accountId",account_handle AS "accountHandle",
        granted_scopes AS "grantedScopes",status,created_at AS "createdAt",updated_at AS "updatedAt",encrypted_secret
       FROM app.x_connections WHERE tenant_id=$1 ORDER BY created_at,id`, [this.tenantId]);
    return rows.map(metadata);
  }

  async clientCredentials(id: string): Promise<{ clientId: string; clientSecret: string; scopes: string[] } | null> {
    const { rows } = await this.database.pool.query<{ client_id: string; encrypted_secret: string; scopes: string[] }>(
      "SELECT client_id,encrypted_secret,scopes FROM app.x_connections WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]);
    const row = rows[0];
    if (!row) return null;
    const secret = JSON.parse(await decrypt(row.encrypted_secret, this.encryptionKey)) as { clientSecret?: unknown };
    if (typeof secret.clientSecret !== "string" || !secret.clientSecret) throw new Error("X connection requires credential replacement");
    return { clientId: row.client_id, clientSecret: secret.clientSecret, scopes: row.scopes };
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.database.pool.query("DELETE FROM app.x_connections WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]);
    return (rowCount ?? 0) > 0;
  }
}

function metadata(row: XConnectionRow): XConnectionMetadata {
  const { encrypted_secret: _secret, ...value } = row;
  return value;
}

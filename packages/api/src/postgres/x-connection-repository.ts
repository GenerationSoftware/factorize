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

  async clientCredentials(id: string): Promise<{ clientId: string; clientSecret: string; scopes: string[]; accessToken?: string; refreshToken?: string; expiresAt?: string } | null> {
    const { rows } = await this.database.pool.query<{ client_id: string; encrypted_secret: string; scopes: string[] }>(
      "SELECT client_id,encrypted_secret,scopes FROM app.x_connections WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]);
    const row = rows[0];
    if (!row) return null;
    const secret = JSON.parse(await decrypt(row.encrypted_secret, this.encryptionKey)) as { clientSecret?: unknown; accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown };
    if (typeof secret.clientSecret !== "string" || !secret.clientSecret) throw new Error("X connection requires credential replacement");
    return { clientId: row.client_id, clientSecret: secret.clientSecret, scopes: row.scopes, accessToken: typeof secret.accessToken === "string" ? secret.accessToken : undefined, refreshToken: typeof secret.refreshToken === "string" ? secret.refreshToken : undefined, expiresAt: typeof secret.expiresAt === "string" ? secret.expiresAt : undefined };
  }

  async createOAuthAttempt(input: { nonce: string; userId: string; sessionVersion: number; connectionId: string; scopes: string[]; verifier: string; expiresAt: Date }): Promise<boolean> {
    const encryptedVerifier = await encrypt(input.verifier, this.encryptionKey);
    const result = await this.database.pool.query(`INSERT INTO app.x_oauth_attempts(tenant_id,nonce,user_id,session_version,connection_id,scopes,encrypted_verifier,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS (SELECT 1 FROM app.x_connections WHERE tenant_id=$1 AND id=$5)`,
      [this.tenantId, input.nonce, input.userId, input.sessionVersion, input.connectionId, input.scopes, encryptedVerifier, input.expiresAt]);
    return Boolean(result.rowCount);
  }

  async consumeOAuthAttempt(nonce: string): Promise<{ userId: string; sessionVersion: number; connectionId: string; scopes: string[]; verifier: string } | null> {
    const { rows } = await this.database.pool.query<{ user_id: string; session_version: number; connection_id: string; scopes: string[]; encrypted_verifier: string }>(
      `UPDATE app.x_oauth_attempts SET consumed_at=now() WHERE tenant_id=$1 AND nonce=$2 AND consumed_at IS NULL AND expires_at>now()
       RETURNING user_id,session_version,connection_id,scopes,encrypted_verifier`, [this.tenantId, nonce]);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.user_id, sessionVersion: row.session_version, connectionId: row.connection_id, scopes: row.scopes, verifier: await decrypt(row.encrypted_verifier, this.encryptionKey) };
  }

  async completeOAuth(id: string, input: { accessToken: string; refreshToken: string; expiresAt: string; accountId: string; accountHandle: string; grantedScopes: string[] }): Promise<void> {
    const credentials = await this.clientCredentials(id);
    if (!credentials) throw new Error("X connection not found");
    const encrypted = await encrypt(JSON.stringify({ clientSecret: credentials.clientSecret, accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt }), this.encryptionKey);
    const result = await this.database.pool.query(`UPDATE app.x_connections SET encrypted_secret=$3,account_id=$4,account_handle=$5,granted_scopes=$6,status='connected',updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id, encrypted, input.accountId, input.accountHandle, input.grantedScopes]);
    if (!result.rowCount) throw new Error("X connection not found");
  }

  async resetOAuthAttempt(id: string): Promise<void> {
    await this.database.pool.query("UPDATE app.x_connections SET status='pending',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status<>'connected'", [this.tenantId, id]);
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

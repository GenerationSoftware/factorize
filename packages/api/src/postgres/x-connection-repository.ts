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
  status: "pending" | "connected" | "reconnect_required" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export class XReconnectRequiredError extends Error {
  constructor() { super("X authorization requires reconnection"); }
}
export class XAccountMismatchError extends Error {
  constructor() { super("X authorization resolved to a different account"); }
}

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

  /** Replace only the app credentials. Existing account identity remains bound,
   * while old tokens and in-flight OAuth attempts are invalidated atomically. */
  async replaceClientCredentials(id: string, input: { clientId: string; clientSecret: string }): Promise<XConnectionMetadata | null> {
    const encrypted = await encrypt(JSON.stringify({ clientSecret: input.clientSecret }), this.encryptionKey);
    return this.database.transaction(async client => {
      const { rows } = await client.query<XConnectionRow>(
        `UPDATE app.x_connections SET client_id=$3,encrypted_secret=$4,
           credential_version=credential_version+1,
           status=CASE WHEN account_id IS NULL THEN 'pending' ELSE 'reconnect_required' END,
           granted_scopes='{}',updated_at=now()
         WHERE tenant_id=$1 AND id=$2 AND status<>'revoked'
         RETURNING id,name,client_id AS "clientId",scopes,account_id AS "accountId",account_handle AS "accountHandle",
           granted_scopes AS "grantedScopes",status,created_at AS "createdAt",updated_at AS "updatedAt",encrypted_secret`,
        [this.tenantId, id, input.clientId, encrypted]);
      if (!rows[0]) return null;
      await client.query("UPDATE app.x_oauth_attempts SET consumed_at=now() WHERE tenant_id=$1 AND connection_id=$2 AND consumed_at IS NULL", [this.tenantId, id]);
      return metadata(rows[0]);
    });
  }

  /** Refresh under the connection row lock so concurrent requests share one
   * rotated refresh token. Disconnect and OAuth completion use the same row,
   * so neither can be overwritten by a late refresh. */
  async accessToken(id: string, refresh: (input: { clientId: string; clientSecret: string; refreshToken: string }) => Promise<{ accessToken: string; refreshToken: string; expiresAt: string }>): Promise<string | null> {
    const result = await this.database.transaction(async client => {
      const { rows } = await client.query<{ client_id: string; encrypted_secret: string; status: string }>(
        "SELECT client_id,encrypted_secret,status FROM app.x_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenantId, id]);
      const row = rows[0];
      if (!row || row.status !== "connected") return { accessToken: null };
      const stored = JSON.parse(await decrypt(row.encrypted_secret, this.encryptionKey)) as { clientSecret?: string; accessToken?: string; refreshToken?: string; expiresAt?: string };
      if (stored.accessToken && stored.expiresAt && Date.parse(stored.expiresAt) > Date.now() + 60_000) return { accessToken: stored.accessToken };
      if (!stored.clientSecret || !stored.refreshToken) {
        await client.query("UPDATE app.x_connections SET status='reconnect_required',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='connected'", [this.tenantId, id]);
        return { reconnectRequired: true as const };
      }
      let rotated: { accessToken: string; refreshToken: string; expiresAt: string };
      try { rotated = await refresh({ clientId: row.client_id, clientSecret: stored.clientSecret, refreshToken: stored.refreshToken }); }
      catch (error) {
        if (!(error instanceof XReconnectRequiredError)) throw error;
        await client.query("UPDATE app.x_connections SET status='reconnect_required',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='connected'", [this.tenantId, id]);
        return { reconnectRequired: true as const };
      }
      const encrypted = await encrypt(JSON.stringify({ clientSecret: stored.clientSecret, ...rotated }), this.encryptionKey);
      const updated = await client.query("UPDATE app.x_connections SET encrypted_secret=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='connected'", [this.tenantId, id, encrypted]);
      if (!updated.rowCount) return { accessToken: null };
      return { accessToken: rotated.accessToken };
    });
    if (result?.reconnectRequired) throw new XReconnectRequiredError();
    return result.accessToken;
  }

  /** Revoke locally first and return the old upstream credentials for a
   * best-effort X revocation request after the transaction commits. */
  async disconnect(id: string): Promise<{ clientId: string; clientSecret: string; accessToken?: string; refreshToken?: string } | null> {
    return this.database.transaction(async client => {
      const { rows } = await client.query<{ encrypted_secret: string; client_id: string; status: string }>(
        "SELECT encrypted_secret,client_id,status FROM app.x_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenantId, id]);
      const row = rows[0];
      if (!row || row.status === "revoked") return null;
      const stored = JSON.parse(await decrypt(row.encrypted_secret, this.encryptionKey)) as { clientSecret?: string; accessToken?: string; refreshToken?: string };
      const tombstone = await encrypt(JSON.stringify({}), this.encryptionKey);
      await client.query("UPDATE app.x_connections SET status='revoked',encrypted_secret=$3,account_id=NULL,account_handle=NULL,granted_scopes='{}',updated_at=now() WHERE tenant_id=$1 AND id=$2", [this.tenantId, id, tombstone]);
      return stored.clientSecret ? { clientId: row.client_id, clientSecret: stored.clientSecret, accessToken: stored.accessToken, refreshToken: stored.refreshToken } : null;
    });
  }

  async createOAuthAttempt(input: { nonce: string; userId: string; sessionVersion: number; connectionId: string; scopes: string[]; verifier: string; expiresAt: Date }): Promise<boolean> {
    const encryptedVerifier = await encrypt(input.verifier, this.encryptionKey);
    const result = await this.database.pool.query(`INSERT INTO app.x_oauth_attempts(tenant_id,nonce,user_id,session_version,connection_id,scopes,encrypted_verifier,expires_at,credential_version)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,credential_version FROM app.x_connections WHERE tenant_id=$1 AND id=$5 AND status<>'revoked'`,
      [this.tenantId, input.nonce, input.userId, input.sessionVersion, input.connectionId, input.scopes, encryptedVerifier, input.expiresAt]);
    return Boolean(result.rowCount);
  }

  async consumeOAuthAttempt(nonce: string): Promise<{ userId: string; sessionVersion: number; connectionId: string; scopes: string[]; verifier: string; credentialVersion: number } | null> {
    const { rows } = await this.database.pool.query<{ user_id: string; session_version: number; connection_id: string; scopes: string[]; encrypted_verifier: string; credential_version: number }>(
      `UPDATE app.x_oauth_attempts SET consumed_at=now() WHERE tenant_id=$1 AND nonce=$2 AND consumed_at IS NULL AND expires_at>now()
       AND EXISTS (SELECT 1 FROM app.x_connections c WHERE c.tenant_id=app.x_oauth_attempts.tenant_id AND c.id=app.x_oauth_attempts.connection_id AND c.status<>'revoked' AND c.credential_version=app.x_oauth_attempts.credential_version)
       RETURNING user_id,session_version,connection_id,scopes,encrypted_verifier,credential_version`, [this.tenantId, nonce]);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.user_id, sessionVersion: row.session_version, connectionId: row.connection_id, scopes: row.scopes, verifier: await decrypt(row.encrypted_verifier, this.encryptionKey), credentialVersion: row.credential_version };
  }

  async clientCredentialsForVersion(id: string, credentialVersion: number): Promise<{ clientId: string; clientSecret: string; scopes: string[] } | null> {
    const { rows } = await this.database.pool.query<{ client_id: string; encrypted_secret: string; scopes: string[] }>("SELECT client_id,encrypted_secret,scopes FROM app.x_connections WHERE tenant_id=$1 AND id=$2 AND credential_version=$3 AND status<>'revoked'", [this.tenantId, id, credentialVersion]);
    const row = rows[0];
    if (!row) return null;
    const secret = JSON.parse(await decrypt(row.encrypted_secret, this.encryptionKey)) as { clientSecret?: unknown };
    return typeof secret.clientSecret === "string" ? { clientId: row.client_id, clientSecret: secret.clientSecret, scopes: row.scopes } : null;
  }

  async completeOAuth(id: string, input: { accessToken: string; refreshToken: string; expiresAt: string; accountId: string; accountHandle: string; grantedScopes: string[] }, credentialVersion = 1): Promise<void> {
    const credentials = await this.clientCredentialsForVersion(id, credentialVersion);
    if (!credentials) throw new Error("X connection not found");
    const encrypted = await encrypt(JSON.stringify({ clientSecret: credentials.clientSecret, accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt }), this.encryptionKey);
    const result = await this.database.transaction(async client => {
      const current = await client.query<{ account_id: string | null }>("SELECT account_id FROM app.x_connections WHERE tenant_id=$1 AND id=$2 AND credential_version=$3 AND status<>'revoked' FOR UPDATE", [this.tenantId, id, credentialVersion]);
      if (!current.rows[0]) throw new Error("X connection not found");
      if (current.rows[0].account_id && current.rows[0].account_id !== input.accountId) throw new XAccountMismatchError();
      const updated = await client.query("UPDATE app.x_connections SET encrypted_secret=$4,account_id=$5,account_handle=$6,granted_scopes=$7,status='connected',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND credential_version=$3 AND status<>'revoked'", [this.tenantId, id, credentialVersion, encrypted, input.accountId, input.accountHandle, input.grantedScopes]);
      if (!updated.rowCount) throw new Error("X connection not found");
    });
  }

  async resetOAuthAttempt(id: string): Promise<void> {
    await this.database.pool.query("UPDATE app.x_connections SET status=CASE WHEN account_id IS NULL THEN 'pending' ELSE 'reconnect_required' END,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status<>'connected' AND status<>'revoked'", [this.tenantId, id]);
  }

  async delete(id: string): Promise<boolean> {
    return Boolean(await this.disconnect(id));
  }
}

function metadata(row: XConnectionRow): XConnectionMetadata {
  const { encrypted_secret: _secret, ...value } = row;
  return value;
}

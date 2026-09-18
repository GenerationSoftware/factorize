import type { OAuthProps } from "../types";
import type { Database } from "./database";

export class AccessTokenRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async list() {
    return (await this.database.pool.query("SELECT id,name,scopes,created_at,expires_at,last_used_at,revoked_at FROM app.access_tokens WHERE tenant_id=$1 ORDER BY created_at DESC", [this.tenantId])).rows;
  }

  async create(input: { name: string; digest: string; userId: string; sessionVersion: number; scopes: string[]; expiresAt: string }) {
    const id = crypto.randomUUID();
    const result = await this.database.pool.query(`INSERT INTO app.access_tokens(tenant_id,id,name,digest,user_id,session_version,scopes,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM app.members WHERE tenant_id=$1 AND user_id=$5 AND role='owner' AND session_version=$6
      RETURNING id,name,scopes,created_at,expires_at`, [this.tenantId, id, input.name, input.digest, input.userId, input.sessionVersion, JSON.stringify(input.scopes), input.expiresAt]);
    return result.rows[0] ?? null;
  }

  async authenticate(digest: string): Promise<OAuthProps | null> {
    const result = await this.database.pool.query<{ id: string; user_id: string; session_version: number; scopes: string[] }>(`UPDATE app.access_tokens t SET last_used_at=now() FROM app.members m
      WHERE t.tenant_id=$1 AND t.digest=$2 AND t.revoked_at IS NULL AND t.expires_at>now()
        AND m.tenant_id=t.tenant_id AND m.user_id=t.user_id AND m.role='owner' AND m.session_version=t.session_version
      RETURNING t.id,t.user_id,t.session_version,t.scopes`, [this.tenantId, digest]);
    const row = result.rows[0];
    return row ? { tenantId: this.tenantId, userId: row.user_id, sessionVersion: row.session_version, scopes: row.scopes, accessTokenId: row.id } : null;
  }

  async active(id: string): Promise<boolean> {
    const result = await this.database.pool.query(`SELECT 1 FROM app.access_tokens t JOIN app.members m ON m.tenant_id=t.tenant_id AND m.user_id=t.user_id
      WHERE t.tenant_id=$1 AND t.id=$2 AND t.revoked_at IS NULL AND t.expires_at>now() AND m.role='owner' AND m.session_version=t.session_version`, [this.tenantId, id]);
    return Boolean(result.rowCount);
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.database.pool.query("UPDATE app.access_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]);
    return Boolean(result.rowCount);
  }
}

import type { Database } from "./database";

export interface Member { userId: string; email: string; role: "owner" | "member"; sessionVersion: number; }

export class IdentityRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async member(userId: string): Promise<Member | null> {
    const result = await this.database.pool.query<{ user_id: string; email: string; role: Member["role"]; session_version: number }>(
      "SELECT user_id,email,role,session_version FROM app.members WHERE tenant_id=$1 AND user_id=$2", [this.tenantId, userId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, email: row.email, role: row.role, sessionVersion: row.session_version } : null;
  }

  async upsertOwner(userId: string, email: string, tenantName?: string): Promise<Member> {
    return this.database.transaction(async client => {
      await client.query("INSERT INTO app.tenants(id,name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=COALESCE(app.tenants.name,excluded.name),updated_at=now()", [this.tenantId, tenantName ?? null]);
      await client.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,$2,true) ON CONFLICT (id) DO UPDATE SET email=excluded.email", [userId, email]);
      const count = await client.query<{ count: string }>("SELECT count(*)::text count FROM app.members WHERE tenant_id=$1", [this.tenantId]);
      const role: Member["role"] = Number(count.rows[0]?.count ?? 0) === 0 ? "owner" : "member";
      const result = await client.query<{ user_id: string; email: string; role: Member["role"]; session_version: number }>(`INSERT INTO app.members(tenant_id,user_id,email,role)
        VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,user_id) DO UPDATE SET email=excluded.email
        RETURNING user_id,email,role,session_version`, [this.tenantId, userId, email, role]);
      const row = result.rows[0]!;
      return { userId: row.user_id, email: row.email, role: row.role, sessionVersion: row.session_version };
    });
  }

  async revoke(userId: string): Promise<boolean> {
    const result = await this.database.pool.query("UPDATE app.members SET session_version=session_version+1 WHERE tenant_id=$1 AND user_id=$2", [this.tenantId, userId]);
    return Boolean(result.rowCount);
  }
}

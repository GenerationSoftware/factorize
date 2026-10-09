import type { Database } from "./database";

export class GitHubRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async installations() { return (await this.database.pool.query(`SELECT installation_id "installationId",account_login "accountLogin",account_type "accountType",state,updated_at "updatedAt" FROM app.github_installations WHERE tenant_id=$1 ORDER BY account_login`, [this.tenantId])).rows; }
  async installation(id: number) { return (await this.database.pool.query<any>("SELECT * FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [this.tenantId, id])).rows[0] ?? null; }
  static async locate(database: Database, id: number) { return (await database.pool.query<any>("SELECT * FROM app.github_installations WHERE installation_id=$1", [id])).rows[0] ?? null; }
  async save(input: { installationId: number; accountLogin: string; accountType: string; state: "active" | "suspended" }) {
    const result = await this.database.pool.query(`INSERT INTO app.github_installations(installation_id,tenant_id,account_login,account_type,state) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (installation_id) DO UPDATE SET account_login=excluded.account_login,account_type=excluded.account_type,state=excluded.state,updated_at=now()
      WHERE app.github_installations.tenant_id=excluded.tenant_id RETURNING installation_id`, [input.installationId, this.tenantId, input.accountLogin, input.accountType, input.state]);
    if (!result.rowCount) throw new Error("installation_conflict");
  }
  async updateState(id: number, state: "active" | "suspended") { return Boolean((await this.database.pool.query("UPDATE app.github_installations SET state=$3,updated_at=now() WHERE tenant_id=$1 AND installation_id=$2", [this.tenantId, id, state])).rowCount); }
  async delete(id: number) { return Boolean((await this.database.pool.query("DELETE FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [this.tenantId, id])).rowCount); }
  async saveSetupState(nonce: string, expiresAt: number) { await this.database.pool.query("INSERT INTO app.github_setup_states(tenant_id,nonce,expires_at) VALUES ($1,$2,to_timestamp($3))", [this.tenantId, nonce, expiresAt]); }
  async consumeSetupState(nonce: string): Promise<boolean> {
    return Boolean((await this.database.pool.query("UPDATE app.github_setup_states SET used_at=now() WHERE tenant_id=$1 AND nonce=$2 AND used_at IS NULL AND expires_at>now()", [this.tenantId, nonce])).rowCount);
  }
}

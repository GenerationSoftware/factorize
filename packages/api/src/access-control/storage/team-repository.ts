import type { Database } from "../../postgres/database";
export class TeamRepository {
  constructor(private database: Database, private tenantId: string) {}
  async get() {
    const row = (await this.database.pool.query<{ id: string; name: string | null }>("SELECT id,name FROM app.tenants WHERE id=$1", [this.tenantId])).rows[0];
    return row ?? null;
  }
}

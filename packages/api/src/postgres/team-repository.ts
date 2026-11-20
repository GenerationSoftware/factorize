import { DEFAULT_RUN_SCOPES } from "../run-scopes";
import type { Database } from "./database";
import type { z } from "zod";
import type { teamRunDefaults } from "../flow-schemas";

export const INITIAL_TEAM_DEFAULTS = {
  capacity:4, concurrencyLimit:1, requiresVm:false, runScopes:[...DEFAULT_RUN_SCOPES], portableIntegrationIds:[], githubInstallationIds:[], linearConnectionId:null, xConnectionIds:[], allowedTriggerIds:[],
} satisfies z.infer<typeof teamRunDefaults>;

export class TeamRepository {
  constructor(private database: Database, private tenantId: string) {}

  async get() {
    const result = await this.database.pool.query<{
      id: string;
      name: string | null;
      run_defaults: z.infer<typeof teamRunDefaults>;
    }>(`SELECT t.id,t.name,s.run_defaults FROM app.tenants t
      JOIN app.team_settings s ON s.tenant_id=t.id WHERE t.id=$1`, [this.tenantId]);
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, runDefaults: row.run_defaults } : null;
  }

  async setRunDefaults(defaults: z.infer<typeof teamRunDefaults>) {
    const result = await this.database.pool.query(`UPDATE app.team_settings
      SET run_defaults=$2,updated_at=now() WHERE tenant_id=$1 RETURNING tenant_id`,
    [this.tenantId, {...INITIAL_TEAM_DEFAULTS,...defaults}]);
    return Boolean(result.rowCount);
  }
}

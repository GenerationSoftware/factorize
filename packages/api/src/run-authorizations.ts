import type { Database } from "./postgres/database";
import { normalizeScopes } from "./access-tokens";

/** Capture once, before provisioning. Retries/restarts cannot broaden scopes
 * or replace a revoked owner/session binding. There is no guest credential. */
export async function snapshotRunAuthorization(database: Database, input: {tenantId: string; runId: string; scopes: readonly string[]}): Promise<void> {
  const owner = (await database.pool.query<{user_id: string; session_version: number}>("SELECT user_id,session_version FROM app.members WHERE tenant_id=$1 AND role='owner' ORDER BY user_id LIMIT 1", [input.tenantId])).rows[0];
  if (!owner) throw new Error("Run owner is unavailable");
  await database.pool.query(`INSERT INTO app.run_authorizations(tenant_id,run_id,user_id,session_version,scopes)
    VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tenant_id,run_id) DO NOTHING`, [input.tenantId, input.runId, owner.user_id, owner.session_version, JSON.stringify(normalizeScopes(input.scopes))]);
}

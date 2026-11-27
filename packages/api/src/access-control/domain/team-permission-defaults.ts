import { AGENT_SCOPES, normalizeScopes } from "../../access-tokens";
import { integrationForScope } from "../../oauth-reconnect";
import type { DatabaseClient } from "../../postgres/database";

export const permissionKey = (scope: string) => {
  const integration = integrationForScope(scope);
  return integration ? "integration:" + integration : scope;
};

export async function teamPermissionPreferences(db: DatabaseClient, tenantId: string) {
  const { rows } = await db.query<{ permission: string; enabled: boolean }>(
    "SELECT permission,enabled FROM app.team_permission_defaults WHERE tenant_id=$1", [tenantId],
  );
  return new Map(rows.map(row => [row.permission, row.enabled]));
}

export function selectedTeamDefaults(scopes: string[], preferences: ReadonlyMap<string, boolean>) {
  return normalizeScopes(scopes).filter(scope => preferences.get(permissionKey(scope)) === true);
}

export const standardPermissions: readonly string[] = AGENT_SCOPES;

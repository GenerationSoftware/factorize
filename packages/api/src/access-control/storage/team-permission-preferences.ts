import type { DatabaseClient } from "../../postgres/database";

export async function teamPermissionPreferences(db: DatabaseClient, tenantId: string) {
  const { rows } = await db.query<{ permission: string; enabled: boolean }>(
    "SELECT permission,enabled FROM app.team_permission_defaults WHERE tenant_id=$1", [tenantId],
  );
  return new Map(rows.map(row => [row.permission, row.enabled]));
}

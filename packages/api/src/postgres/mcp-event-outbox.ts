import type { DatabaseClient } from "./database";

// The definition row is already locked FOR SHARE by both writers. This lock
// orders subscription activation against occurrence insertion through commit.
export async function lockEventOutbox(sql: DatabaseClient, tenantId: string, definitionId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mcp-events:${tenantId}:${definitionId}`]);
}

export async function enqueueMcpDeliveries(sql: DatabaseClient, tenantId: string, definitionId: string, occurrenceId: string) {
  const result = await sql.query(`INSERT INTO app.mcp_event_deliveries(tenant_id,subscription_id,occurrence_id,generation)
    SELECT tenant_id,id,$3,generation FROM app.mcp_event_subscriptions
    WHERE tenant_id=$1 AND definition_id=$2 AND status='active' AND expires_at>clock_timestamp()`,
  [tenantId, definitionId, occurrenceId]);
  return !!result.rowCount;
}

export async function lockMcpEventGrant(sql: DatabaseClient, tenantId: string, grantId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mcp-event-grant:${tenantId}:${grantId}`]);
}

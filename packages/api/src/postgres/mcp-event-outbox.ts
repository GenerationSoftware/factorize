import type { Database, DatabaseClient } from "./database";

// The definition row is already locked FOR SHARE by both writers. This lock
// orders subscription activation against occurrence insertion through commit.
export async function lockEventOutbox(sql: DatabaseClient, tenantId: string, definitionId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mcp-events:${tenantId}:${definitionId}`]);
}

export async function enqueueMcpDeliveries(sql: DatabaseClient, tenantId: string, definitionId: string, occurrenceId: string) {
  const result = await sql.query(`INSERT INTO app.mcp_event_deliveries(tenant_id,subscription_id,occurrence_id,generation,ack_epoch,ack_state,ack_updated_at)
    SELECT tenant_id,id,$3,generation,ack_epoch,CASE WHEN ack_epoch IS NOT NULL THEN 'pending' END,
      CASE WHEN ack_epoch IS NOT NULL THEN clock_timestamp() END FROM app.mcp_event_subscriptions
    WHERE tenant_id=$1 AND definition_id=$2 AND status='active' AND expires_at>clock_timestamp()`,
  [tenantId, definitionId, occurrenceId]);
  return !!result.rowCount;
}

export async function lockMcpEventGrant(sql: DatabaseClient, tenantId: string, grantId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mcp-event-grant:${tenantId}:${grantId}`]);
}

type Grant = { tenant_id: string; user_id: string; grant_id: string };
const pruneBatchSize = 250;

// The caller holds the exact grant's advisory lock. Lock subscription rows
// before changing the policy row, matching dispatch's subscription -> policy
// order. Child delivery rows cascade without touching the source Event.
export async function deleteMcpGrantSubscriptions(sql: DatabaseClient, grant: Grant) {
  await sql.query(`WITH doomed AS (
      SELECT id FROM app.mcp_event_subscriptions
      WHERE tenant_id=$1 AND user_id=$2 AND grant_id=$3 ORDER BY id LIMIT $4
    ) DELETE FROM app.mcp_event_subscriptions s USING doomed
    WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.grant_id=$3 AND s.id=doomed.id`,
  [grant.tenant_id, grant.user_id, grant.grant_id, pruneBatchSize]);
}

export async function pruneRevokedMcpSubscriptions(db: Database) {
  // Only a durable, exact authorization tombstone is deletion proof. An
  // absent provider listing (eventually consistent), expiry, logout, or a
  // delivery diagnostic is not sufficient. Never delete the tombstone.
  const { rows } = await db.pool.query<Grant>(`SELECT tenant_id,user_id,subject AS grant_id
    FROM app.agent_identities i WHERE kind='oauth' AND revoked_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM app.mcp_event_subscriptions s
      WHERE s.tenant_id=i.tenant_id AND s.user_id=i.user_id AND s.grant_id=i.subject
    ) ORDER BY revoked_at,tenant_id,subject LIMIT 20`);
  for (const grant of rows) await db.transaction(async sql => {
    await lockMcpEventGrant(sql, grant.tenant_id, grant.grant_id);
    const proof = await sql.query(`SELECT 1 FROM app.agent_identities
      WHERE tenant_id=$1 AND user_id=$2 AND kind='oauth' AND subject=$3 AND revoked_at IS NOT NULL`,
    [grant.tenant_id, grant.user_id, grant.grant_id]);
    if (proof.rowCount) await deleteMcpGrantSubscriptions(sql, grant);
  });
}

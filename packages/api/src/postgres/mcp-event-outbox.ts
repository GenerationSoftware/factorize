import type { Database, DatabaseClient } from "./database";

// The definition row is already locked FOR SHARE by both writers. This lock
// orders subscription activation against occurrence insertion through commit.
export async function lockEventOutbox(sql: DatabaseClient, tenantId: string, definitionId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`mcp-events:${tenantId}:${definitionId}`]);
}

// A row that has not been materialized yet still uses the legacy grant
// checks in dispatch. Installation state is a cheap first gate, not a
// substitute for live provider credential and membership checks.
export const joinMcpInstallation = `LEFT JOIN app.oauth_installations i
  ON (i.tenant_id,i.user_id,i.id)=(s.tenant_id,s.user_id,s.grant_id)`;
export const installationCanReceiveMcpEvents = `(i.id IS NULL OR (
  i.revoked_at IS NULL AND i.active_grant_id IS NOT NULL AND i.active_session_version IS NOT NULL
  AND i.client_id=s.client_id AND 'triggers:read'=ANY(i.selected_scopes) AND 'triggers:read'=ANY(i.active_scopes)
))`;

export async function enqueueMcpDeliveries(sql: DatabaseClient, tenantId: string, definitionId: string, occurrenceId: string) {
  const result = await sql.query(`INSERT INTO app.mcp_event_deliveries(tenant_id,subscription_id,occurrence_id,generation,ack_epoch,ack_state,ack_updated_at)
    SELECT s.tenant_id,s.id,$3,s.generation,s.ack_epoch,CASE WHEN s.ack_epoch IS NOT NULL THEN 'pending' END,
      CASE WHEN s.ack_epoch IS NOT NULL THEN clock_timestamp() END FROM app.mcp_event_subscriptions s
    ${joinMcpInstallation}
    WHERE s.tenant_id=$1 AND s.definition_id=$2 AND s.status='active' AND s.expires_at>clock_timestamp()
      AND ${installationCanReceiveMcpEvents}`,
  [tenantId, definitionId, occurrenceId]);
  return !!result.rowCount;
}

// Installation policy writes take exclusive ownership. Delivery and processing
// take shared ownership; per-subscription row locks serialize their state.
export async function lockMcpEventGrant(sql: DatabaseClient, tenantId: string, grantId: string, shared = false) {
  const lock = shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";
  await sql.query(`SELECT ${lock}(hashtextextended($1,0))`, [`mcp-event-grant:${tenantId}:${grantId}`]);
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
  // A materialized installation must itself be revoked. Its predecessor's
  // credential tombstone alone cannot delete subscriptions after reconnect.
  // Legacy grants have no separate installation. Neither provider absence,
  // expiry, logout, nor a delivery diagnostic is proof of deletion.
  const { rows } = await db.pool.query<Grant>(`WITH revoked AS (
    SELECT tenant_id,user_id,id AS grant_id,revoked_at FROM app.oauth_installations
    WHERE revoked_at IS NOT NULL
    UNION ALL
    SELECT tenant_id,user_id,subject AS grant_id,revoked_at
    FROM app.agent_identities legacy
    WHERE kind='oauth' AND revoked_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM app.oauth_installations i
      WHERE (i.tenant_id,i.user_id,i.id)=(legacy.tenant_id,legacy.user_id,legacy.subject)
    )
  )
  SELECT r.tenant_id,r.user_id,r.grant_id FROM revoked r WHERE EXISTS (
    SELECT 1 FROM app.mcp_event_subscriptions s
    WHERE (s.tenant_id,s.user_id,s.grant_id)=(r.tenant_id,r.user_id,r.grant_id)
  ) ORDER BY r.revoked_at,r.tenant_id,r.grant_id LIMIT 20`);
  for (const grant of rows) await db.transaction(async sql => {
    await lockMcpEventGrant(sql, grant.tenant_id, grant.grant_id);
    const proof = await sql.query(`SELECT 1 FROM app.oauth_installations
      WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NOT NULL
      UNION ALL
      SELECT 1 FROM app.agent_identities
      WHERE tenant_id=$1 AND user_id=$2 AND kind='oauth' AND subject=$3 AND revoked_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app.oauth_installations WHERE tenant_id=$1 AND user_id=$2 AND id=$3)`,
    [grant.tenant_id, grant.user_id, grant.grant_id]);
    if (proof.rowCount) await deleteMcpGrantSubscriptions(sql, grant);
  });
}

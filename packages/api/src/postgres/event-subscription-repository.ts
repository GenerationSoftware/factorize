import type { Database } from "./database";

type SubscriptionRow = {
  id: string;
  definition_id: string;
  name: string;
  grant_id: string;
  status: "active" | "expired" | "stopped";
  acknowledgment_mode: "required" | "off";
  expires_at: Date;
  last_cooldown_started_at: Date | null;
  last_cooldown_ends_at: Date | null;
};

// Dashboard metadata is visible to the same owner and workspace as the OAuth
// connection it belongs to. Never select webhook credentials, URL or arguments.
export async function readEventSubscriptions(db: Database, tenantId: string, userId: string, id?: string) {
  const { rows } = await db.pool.query<SubscriptionRow>(
    `SELECT s.id,s.definition_id,e.name,s.grant_id,
       CASE WHEN s.status='stopped' THEN 'stopped'
            WHEN s.expires_at<=statement_timestamp() THEN 'expired'
            ELSE 'active' END AS status,
       CASE WHEN s.ack_epoch IS NULL THEN 'off' ELSE 'required' END AS acknowledgment_mode,
       s.expires_at,s.last_cooldown_started_at,s.last_cooldown_ends_at
     FROM app.mcp_event_subscriptions s
     JOIN app.event_definitions e ON e.tenant_id=s.tenant_id AND e.id=s.definition_id
     WHERE s.tenant_id=$1 AND s.user_id=$2 ${id ? "AND s.id=$3" : ""}
     ORDER BY e.name,s.id`,
    id ? [tenantId, userId, id] : [tenantId, userId],
  );
  return rows.map(row => ({
    id: row.id, eventId: row.definition_id, eventName: row.name, grantId: row.grant_id,
    status: row.status, acknowledgmentMode: row.acknowledgment_mode, expiresAt: row.expires_at.toISOString(),
    lastCooldownStartedAt: row.last_cooldown_started_at?.toISOString() ?? null,
    lastCooldownEndsAt: row.last_cooldown_ends_at?.toISOString() ?? null,
  }));
}

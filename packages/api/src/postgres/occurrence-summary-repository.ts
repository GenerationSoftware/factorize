import type { Database } from "./database";

type Collection = { kind: "event"; id: string } | { kind: "subscription"; id: string; userId: string };
type Row = { id: string | null; occurred_at: string; source: string; delivery: string; acknowledgment: string };

// Project only safe columns. The ID is usable with the existing occurrence read
// protocol; payload, raw sources, credentials and callbacks never go to the table.
export async function readOccurrenceSummaries(db: Database, tenantId: string, collection: Collection, limit: number, boundary?: [string, string]) {
  const isSubscription = collection.kind === "subscription";
  const parent = isSubscription
    ? "SELECT tenant_id,id,definition_id FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2 AND user_id=$6"
    : "SELECT tenant_id,id AS definition_id FROM app.event_definitions WHERE tenant_id=$1 AND id=$2";
  const fields = isSubscription ? ",d.status AS delivery,COALESCE(d.ack_state,'off') AS acknowledgment" : "";
  const delivery = isSubscription
    ? "JOIN app.mcp_event_deliveries d ON d.tenant_id=o.tenant_id AND d.subscription_id=p.id AND d.occurrence_id=o.id"
    : "";
  const { rows } = await db.pool.query<Row>(
    `SELECT page.id,page.occurred_at,page.source${isSubscription ? ",page.delivery,page.acknowledgment" : ""}
     FROM (${parent}) p
     LEFT JOIN LATERAL (
       SELECT o.id,o.occurred_at AS sort_time,
         to_char(o.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
         CASE split_part(o.source_identity,':',1)
           WHEN 'manual' THEN 'manual' WHEN 'schedule' THEN 'schedule' WHEN 'github' THEN 'github'
           WHEN 'linear' THEN 'linear' WHEN 'cloudflare' THEN 'cloudflare' WHEN 'webhook' THEN 'webhook'
           ELSE 'unknown' END AS source${fields}
       FROM app.event_occurrences o ${delivery}
       WHERE o.tenant_id=p.tenant_id AND o.definition_id=p.definition_id
         AND ($3::timestamptz IS NULL OR (o.occurred_at,o.id)<($3,$4::uuid))
       ORDER BY o.occurred_at DESC,o.id DESC LIMIT $5
     ) page ON TRUE
     ORDER BY page.sort_time DESC,page.id DESC`,
    [tenantId, collection.id, boundary?.[0] ?? null, boundary?.[1] ?? null, limit + 1, ...(isSubscription ? [collection.userId] : [])],
  );
  if (!rows.length) return null;
  const items = rows.slice(0, limit).flatMap(row => !row.id ? [] : [{
    id: row.id, occurredAt: row.occurred_at, source: row.source,
    ...(isSubscription ? { delivery: row.delivery, acknowledgment: row.acknowledgment } : {}),
  }]);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? btoa(JSON.stringify([collection.id, last.occurredAt, last.id])) : null };
}

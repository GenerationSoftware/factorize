import type { Database } from "./database";
import { rankField, searchMatches } from "../search";

export class OperationsRepository {
  constructor(private database: Database, private tenantId: string) {}
  async triggerEvents(triggerId: string, limit: number) { return (await this.database.pool.query(`SELECT id,provider,delivery_id "deliveryId",outcome,detail,received_at "receivedAt" FROM app.trigger_events WHERE tenant_id=$1 AND trigger_id=$2 ORDER BY received_at DESC,id DESC LIMIT $3`, [this.tenantId, triggerId, limit])).rows; }
  async delivery(id: string) { const row = (await this.database.pool.query<any>(`SELECT id,provider,delivery_id "deliveryId",event_type event,event_action action,outcome,detail,received_at "receivedAt" FROM app.webhook_deliveries WHERE tenant_id=$1 AND (id::text=$2 OR delivery_id=$2) ORDER BY received_at DESC LIMIT 1`, [this.tenantId, id])).rows[0]; if (!row) return null; const timeline = (await this.database.pool.query(`SELECT trigger_id "triggerId",outcome,detail,created_at "createdAt" FROM app.webhook_delivery_events WHERE tenant_id=$1 AND delivery_id=$2 ORDER BY created_at,id`, [this.tenantId, row.id])).rows; return { ...row, timeline }; }
  async deliveries(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(100, Number(query.get("limit") ?? 50))), values: unknown[] = [this.tenantId], clauses = ["d.tenant_id=$1"];
    const add = (column: string, value: string | null) => { if (value) { values.push(value); clauses.push(`${column}=$${values.length}`); } };
    add("d.provider", query.get("provider")); add("d.delivery_id", query.get("deliveryId")); add("d.event_type", query.get("event")); add("d.event_action", query.get("action")); add("d.outcome", query.get("outcome"));
    if (query.get("triggerId")) { values.push(query.get("triggerId")); clauses.push(`EXISTS (SELECT 1 FROM app.webhook_delivery_events e WHERE e.tenant_id=d.tenant_id AND e.delivery_id=d.id AND e.trigger_id=$${values.length})`); }
    if (query.get("q")) { values.push(`%${query.get("q")}%`); clauses.push(`(d.delivery_id ILIKE $${values.length} OR d.detail ILIKE $${values.length})`); }
    const cursor = query.get("cursor");
    if (cursor) { try { const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)))); values.push(parsed.at, parsed.id); clauses.push(`(d.received_at,d.id)<($${values.length - 1},$${values.length})`); } catch { /* Invalid cursors simply start at the first page. */ } }
    values.push(limit + 1); const rows = (await this.database.pool.query<any>(`SELECT id,provider,delivery_id "deliveryId",event_type event,event_action action,outcome,detail,received_at "receivedAt" FROM app.webhook_deliveries d WHERE ${clauses.join(" AND ")} ORDER BY received_at DESC,id DESC LIMIT $${values.length}`, values)).rows, items = rows.slice(0, limit);
    const last = items.at(-1), encoded = last ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ at: last.receivedAt, id: last.id })))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") : null;
    return { items, nextCursor: rows.length > limit ? encoded : null };
  }
  async search(query: string) {
    const needle = query.trim(); if (!needle || !/[\p{L}\p{N}]/u.test(needle)) return { items: [] };
    const rows = await this.database.pool.query<any>(`SELECT * FROM (
      SELECT 'skill' kind,s.id::text id,s.key title,'' subtitle,'/skills/'||s.id url,s.id::text source_id,s.key source_label,s.key match_text,
        GREATEST(word_similarity($2,s.key),similarity($2,s.key)) score,CASE WHEN lower(s.key)=$2 THEN 0 WHEN starts_with(lower(s.key),$2) THEN 1 ELSE 2 END category,s.id::text stable_key
      FROM app.skills s WHERE s.tenant_id=$1 AND (strpos(lower(s.key),$2)>0 OR $2 <% s.key OR similarity($2,s.key)>0.3 OR strpos(regexp_replace(lower(s.key),'[^[:alnum:]]','','g'),regexp_replace($2,'[^[:alnum:]]','','g'))>0)
      UNION ALL
      SELECT 'run',r.id::text,r.run_name,r.state,'/runs/'||r.id,r.id::text,r.run_name,r.run_name,
        GREATEST(word_similarity($2,r.run_name),similarity($2,r.run_name)),CASE WHEN lower(r.run_name)=$2 THEN 0 WHEN starts_with(lower(r.run_name),$2) THEN 1 ELSE 2 END,r.id::text
      FROM app.runs r WHERE r.tenant_id=$1 AND (strpos(lower(r.run_name),$2)>0 OR $2 <% r.run_name OR similarity($2,r.run_name)>0.3 OR strpos(regexp_replace(lower(r.run_name),'[^[:alnum:]]','','g'),regexp_replace($2,'[^[:alnum:]]','','g'))>0)
    ) found ORDER BY category,score DESC,kind,stable_key LIMIT 100`, [this.tenantId, needle.toLowerCase()]);
    return { items: rows.rows.map(row => {
      const ranked=rankField(row.match_text,needle,row.kind);
      return {kind:row.kind,id:row.id,title:row.title,subtitle:row.subtitle,url:row.url,source:{kind:row.kind,label:row.source_label,id:row.source_id},match:{text:row.match_text,ranges:ranked?.range?[ranked.range]:searchMatches(row.match_text,needle)}};
    }) };
  }
}

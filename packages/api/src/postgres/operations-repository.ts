import type { Database } from "./database";

export class OperationsRepository {
  constructor(private database: Database, private tenantId: string) {}
  async jobEvents(jobId: string, limit: number) { return (await this.database.pool.query(`SELECT id,provider,delivery_id "deliveryId",outcome,detail,received_at "receivedAt" FROM app.job_events WHERE tenant_id=$1 AND job_id=$2 ORDER BY received_at DESC,id DESC LIMIT $3`, [this.tenantId, jobId, limit])).rows; }
  async delivery(id: string) { const row = (await this.database.pool.query<any>(`SELECT id,provider,delivery_id "deliveryId",event_type event,event_action action,outcome,detail,received_at "receivedAt" FROM app.webhook_deliveries WHERE tenant_id=$1 AND (id::text=$2 OR delivery_id=$2) ORDER BY received_at DESC LIMIT 1`, [this.tenantId, id])).rows[0]; if (!row) return null; const timeline = (await this.database.pool.query(`SELECT job_id "jobId",outcome,detail,created_at "createdAt" FROM app.webhook_delivery_events WHERE tenant_id=$1 AND delivery_id=$2 ORDER BY created_at,id`, [this.tenantId, row.id])).rows; return { ...row, timeline }; }
  async deliveries(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(100, Number(query.get("limit") ?? 50))), values: unknown[] = [this.tenantId], clauses = ["d.tenant_id=$1"];
    const add = (column: string, value: string | null) => { if (value) { values.push(value); clauses.push(`${column}=$${values.length}`); } };
    add("d.provider", query.get("provider")); add("d.delivery_id", query.get("deliveryId")); add("d.event_type", query.get("event")); add("d.event_action", query.get("action")); add("d.outcome", query.get("outcome"));
    if (query.get("jobId")) { values.push(query.get("jobId")); clauses.push(`EXISTS (SELECT 1 FROM app.webhook_delivery_events e WHERE e.tenant_id=d.tenant_id AND e.delivery_id=d.id AND e.job_id=$${values.length})`); }
    if (query.get("q")) { values.push(`%${query.get("q")}%`); clauses.push(`(d.delivery_id ILIKE $${values.length} OR d.detail ILIKE $${values.length})`); }
    const cursor = query.get("cursor");
    if (cursor) { try { const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)))); values.push(parsed.at, parsed.id); clauses.push(`(d.received_at,d.id)<($${values.length - 1},$${values.length})`); } catch { /* Invalid cursors simply start at the first page. */ } }
    values.push(limit + 1); const rows = (await this.database.pool.query<any>(`SELECT id,provider,delivery_id "deliveryId",event_type event,event_action action,outcome,detail,received_at "receivedAt" FROM app.webhook_deliveries d WHERE ${clauses.join(" AND ")} ORDER BY received_at DESC,id DESC LIMIT $${values.length}`, values)).rows, items = rows.slice(0, limit);
    const last = items.at(-1), encoded = last ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ at: last.receivedAt, id: last.id })))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") : null;
    return { items, nextCursor: rows.length > limit ? encoded : null };
  }
  async search(query: string) {
    const needle = query.trim(); if (!needle) return { items: [] };
    const rows = await this.database.pool.query<any>(`SELECT * FROM (
      SELECT 'job' kind,j.id,j.name title,j.slug subtitle,'/jobs/'||j.id url,similarity(j.name||' '||j.slug,$2) score FROM app.jobs j WHERE j.tenant_id=$1 AND (j.name ILIKE '%'||$2||'%' OR j.slug ILIKE '%'||$2||'%')
      UNION ALL SELECT 'run',r.id,coalesce(nullif(r.run_name,''),nullif(r.issue_title,''),'Run '||left(r.id::text,8)),r.state,'/job-runs/'||r.id,similarity(coalesce(r.run_name,'')||' '||coalesce(r.issue_title,'')||' '||r.issue_id,$2) FROM app.runs r WHERE r.tenant_id=$1 AND (r.run_name ILIKE '%'||$2||'%' OR r.issue_title ILIKE '%'||$2||'%' OR r.issue_id ILIKE '%'||$2||'%')
      UNION ALL SELECT 'run',e.run_id,e.title,left(e.preview_text,120),'/job-runs/'||e.run_id,ts_rank(e.search_vector,websearch_to_tsquery('english',$2)) FROM app.run_trace_events e WHERE e.tenant_id=$1 AND e.search_vector @@ websearch_to_tsquery('english',$2)
    ) found ORDER BY score DESC LIMIT 100`, [this.tenantId, needle]);
    return { items: rows.rows.map(({ score: _, ...row }) => row) };
  }
}

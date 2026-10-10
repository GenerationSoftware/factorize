import type { Database } from "./database";
import { rankField, searchMatches } from "../search";

const HIGHLIGHT_START = "<<<FACTORIZE_MATCH>>>";
const HIGHLIGHT_END = "<<<FACTORIZE_END>>>";

function markedMatch(value: string, fallback: string, query: string) {
  const text = value || fallback, ranges: { start: number; end: number }[] = [];
  let output = "", cursor = 0, start = text.indexOf(HIGHLIGHT_START);
  while (start >= 0) {
    const end = text.indexOf(HIGHLIGHT_END, start + HIGHLIGHT_START.length);
    if (end < 0) break;
    output += text.slice(cursor, start);
    const matchStart = output.length;
    output += text.slice(start + HIGHLIGHT_START.length, end);
    ranges.push({ start: matchStart, end: output.length });
    cursor = end + HIGHLIGHT_END.length;
    start = text.indexOf(HIGHLIGHT_START, cursor);
  }
  output += text.slice(cursor);
  return { text: output || fallback, ranges: ranges.length ? ranges : searchMatches(output || fallback, query) };
}

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
      SELECT 'job' kind,j.id::text id,j.name title,j.slug subtitle,'/jobs/'||j.id url,j.id::text source_id,j.name source_label,
        CASE WHEN j.name ILIKE '%'||$2||'%' THEN j.name ELSE j.slug END match_text,
        similarity(j.name||' '||j.slug,$2) score,0 category,j.id::text stable_key,NULL match_excerpt
      FROM app.jobs j WHERE j.tenant_id=$1 AND (j.name ILIKE '%'||$2||'%' OR j.slug ILIKE '%'||$2||'%')
      UNION ALL
      SELECT 'run',r.id::text,coalesce(nullif(r.run_name,''),nullif(r.issue_title,''),'Run '||left(r.id::text,8)),r.state,'/job-runs/'||r.id,r.id::text,
        coalesce(nullif(r.run_name,''),nullif(r.issue_title,''),'Run '||left(r.id::text,8)),
        CASE WHEN r.run_name ILIKE '%'||$2||'%' THEN r.run_name WHEN r.issue_title ILIKE '%'||$2||'%' THEN r.issue_title ELSE r.issue_id END,
        similarity(coalesce(r.run_name,'')||' '||coalesce(r.issue_title,'')||' '||r.issue_id,$2),1,r.id::text,NULL
      FROM app.runs r WHERE r.tenant_id=$1 AND (r.run_name ILIKE '%'||$2||'%' OR r.issue_title ILIKE '%'||$2||'%' OR r.issue_id ILIKE '%'||$2||'%')
      UNION ALL
      SELECT 'trace',e.id,e.title,left(e.preview_text,120),'/job-runs/'||e.run_id,e.run_id::text,
        coalesce(nullif(r.run_name,''),nullif(r.issue_title,''),'Run '||left(r.id::text,8)),e.title,
        ts_rank(e.search_vector,websearch_to_tsquery('english',$2)),2,e.run_id::text||':'||e.sequence,
        ts_headline('english',e.title||' '||e.preview_text,websearch_to_tsquery('english',$2),
          'StartSel=<<<FACTORIZE_MATCH>>>,StopSel=<<<FACTORIZE_END>>>,MaxFragments=1,MaxWords=32,MinWords=8')
      FROM app.run_trace_events e JOIN app.runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
      WHERE e.tenant_id=$1 AND e.search_vector @@ websearch_to_tsquery('english',$2)
    ) found ORDER BY category,score DESC,stable_key LIMIT 100`, [this.tenantId, needle]);
    return { items: rows.rows.map(row => {
      const ranked = row.kind === "trace" ? null : rankField(row.match_text, needle, row.kind === "job" ? "job" : "run");
      const match = row.kind === "trace" ? markedMatch(row.match_excerpt, row.title, needle) : { text: row.match_text, ranges: ranked?.range ? [ranked.range] : searchMatches(row.match_text, needle) };
      return { kind: row.kind, id: row.id, title: row.title, subtitle: row.subtitle, url: row.url, source: { kind: row.kind, label: row.source_label, id: row.source_id }, match };
    }) };
  }
}

import type { Database } from "./database";

const encodeCursor = (createdAt: Date, id: string) => btoa(JSON.stringify([createdAt.toISOString(), id])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decodeCursor = (value?: string | null): [string, string] | null => { if (!value) return null; try { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4), parsed = JSON.parse(atob(padded)); return Array.isArray(parsed) && parsed.length === 2 ? [String(parsed[0]), String(parsed[1])] : null; } catch { return null; } };

export class RunQueryRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async list(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(100, Number(query.get("limit") ?? 50))), cursor = decodeCursor(query.get("cursor")), values: unknown[] = [this.tenantId], clauses = ["r.tenant_id=$1"];
    if (query.get("jobId")) { values.push(query.get("jobId")); clauses.push(`r.job_id=$${values.length}`); }
    if (query.get("state")) { values.push(query.get("state")); clauses.push(`r.state=$${values.length}`); }
    if (query.get("contextQuery")) { values.push(`%${query.get("contextQuery")}%`); clauses.push(`i.context::text ILIKE $${values.length}`); }
    if (cursor) { values.push(cursor[0], cursor[1]); clauses.push(`(r.created_at,r.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`); }
    values.push(limit + 1);
    const result = await this.database.pool.query<any>(`SELECT r.id,r.job_id,r.issue_id,r.issue_url,r.issue_title,r.run_name,r.agent_name,r.workspace_name,r.agent_kind,r.state,r.provider,r.execution_backend_kind backend_kind,r.execution_capabilities capabilities,r.destination_url,r.artifact_state,r.artifact_error,r.created_at,r.updated_at,jr.started_at
      FROM app.runs r JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id WHERE ${clauses.join(" AND ")} ORDER BY r.created_at DESC,r.id DESC LIMIT $${values.length}`, values);
    const rows = result.rows.slice(0, limit), hasMore = result.rows.length > limit;
    return { items: rows, nextCursor: hasMore && rows.length ? encodeCursor(rows.at(-1).created_at, rows.at(-1).id) : null };
  }
  async get(runId: string) {
    return (await this.database.pool.query<any>(`SELECT r.*,jr.started_at,jr.encrypted_prompt,i.source invocation_source,i.claim_key invocation_claim_key,i.trigger_id invocation_trigger_id,i.context,i.occurrence,i.created_at invocation_created_at
      FROM app.runs r JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id WHERE r.tenant_id=$1 AND r.id=$2`, [this.tenantId, runId])).rows[0] ?? null;
  }
  async activity(runId: string) { return (await this.database.pool.query("SELECT action,detail,created_at FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id", [this.tenantId, runId])).rows; }
  async stop(runId: string) { return (await this.database.pool.query<any>("UPDATE app.job_runs SET state='stopping',next_poll_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked') RETURNING id,state", [this.tenantId, runId])).rows[0] ?? null; }
}

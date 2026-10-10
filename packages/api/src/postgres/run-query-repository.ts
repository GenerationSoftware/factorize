import { traceRevisionSql } from "../run-read-contracts";
import type { Database } from "./database";

const encodeCursor = (value: unknown[]) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decodeCursor = (value?: string | null): unknown[] | null => { if (!value) return null; try { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4), parsed = JSON.parse(atob(padded)); return Array.isArray(parsed) ? parsed : null; } catch { return null; } };

const sortExpressions = {
  run: "COALESCE(NULLIF(r.run_name, ''), NULLIF(r.issue_title, ''), 'Run')",
  status: "r.state",
  created: "r.created_at",
  agent: "r.agent_kind",
} as const;
type RunSort = keyof typeof sortExpressions;

export class RunQueryRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async list(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(100, Number(query.get("limit") ?? 50))), cursor = decodeCursor(query.get("cursor")), sortParam = query.get("sort"), sort = sortParam && Object.hasOwn(sortExpressions, sortParam) ? sortParam as RunSort : null, direction = sort ? (query.get("direction") === "desc" ? "DESC" : "ASC") : "DESC", values: unknown[] = [this.tenantId], clauses = ["r.tenant_id=$1"];
    if (query.get("jobId")) { values.push(query.get("jobId")); clauses.push(`r.job_id=$${values.length}`); }
    if (query.get("state")) { values.push(query.get("state") === "done" ? ["done", "succeeded"] : [query.get("state")]); clauses.push(`r.state=ANY($${values.length}::text[])`); }
    if (query.get("contextQuery")) { values.push(`%${query.get("contextQuery")}%`); clauses.push(`i.context::text ILIKE $${values.length}`); }
    if (sort && cursor?.length === 5 && cursor[0] === sort && cursor[1] === direction.toLowerCase()) {
      const expression = sortExpressions[sort], nullFlag = `(CASE WHEN ${expression} IS NULL THEN 1 ELSE 0 END)`, after = direction === "ASC" ? ">" : "<";
      values.push(Number(cursor[2]), cursor[3] ?? null, cursor[4]);
      const valuePlaceholder = sort === "created" ? `$${values.length - 1}::timestamptz` : `$${values.length - 1}`;
      clauses.push(`(${nullFlag} > $${values.length - 2} OR (${nullFlag} = $${values.length - 2} AND ((${expression} ${after} ${valuePlaceholder}) OR (${expression} IS NOT DISTINCT FROM ${valuePlaceholder} AND r.id ${after} $${values.length}::uuid))))`);
    } else if (!sort && cursor?.length === 2) {
      values.push(cursor[0], cursor[1]); clauses.push(`(r.created_at,r.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const order = sort ? `CASE WHEN ${sortExpressions[sort]} IS NULL THEN 1 ELSE 0 END ASC, ${sortExpressions[sort]} ${direction} NULLS LAST, r.id ${direction}` : "r.created_at DESC,r.id DESC";
    const result = await this.database.pool.query<any>(`SELECT r.id,r.job_id,r.issue_id,r.issue_url,r.issue_title,r.run_name,r.agent_name,r.workspace_name,r.agent_kind,r.state,r.provider,r.execution_backend_kind backend_kind,r.execution_capabilities capabilities,r.destination_url,r.artifact_state,r.artifact_error,r.created_at,r.updated_at,jr.started_at
      FROM app.runs r JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT $${values.length}`, values);
    const rows = result.rows.slice(0, limit), hasMore = result.rows.length > limit;
    const last = rows.at(-1);
    const nextCursor = hasMore && last ? sort ? (() => {
      const value = sort === "run" ? (last.run_name || last.issue_title || "Run") : last[sort === "status" ? "state" : sort === "created" ? "created_at" : "agent_kind"];
      return encodeCursor([sort, direction.toLowerCase(), sort === "run" || value != null ? 0 : 1, value, last.id]);
    })() : encodeCursor([last.created_at, last.id]) : null;
    return { items: rows, nextCursor };
  }
  async get(runId: string) {
    return (await this.database.pool.query<any>(`SELECT r.*,j.name job_name,jr.started_at,jr.encrypted_prompt,i.source invocation_source,i.claim_key invocation_claim_key,i.trigger_id invocation_trigger_id,i.context,i.occurrence,i.created_at invocation_created_at
      FROM app.runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id WHERE r.tenant_id=$1 AND r.id=$2`, [this.tenantId, runId])).rows[0] ?? null;
  }
  async status(runId: string) {
    const row = (await this.database.pool.query(`SELECT r.id,r.job_id,jr.state,r.run_name,j.name job_name,r.destination_url,
      r.created_at,greatest(r.updated_at,jr.updated_at) updated_at,jr.started_at,r.artifact_state,
      (jr.state IN ('succeeded','failed','stopped') AND (r.artifact_state IN ('pending','collecting') OR NOT r.vm_cleanup_complete)) finalizing,
      ${traceRevisionSql} trace_revision
      FROM app.runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id
      JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id
      LEFT JOIN app.run_trace_cursors c ON c.tenant_id=r.tenant_id AND c.run_id=r.id
      LEFT JOIN app.run_trace_projections p ON p.tenant_id=r.tenant_id AND p.run_id=r.id
      WHERE r.tenant_id=$1 AND r.id=$2`, [this.tenantId, runId])).rows[0];
    if (!row) return null;
    return { ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), started_at: row.started_at?.toISOString() ?? null };
  }
  async activity(runId: string) { return (await this.database.pool.query("SELECT action,detail,created_at FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id", [this.tenantId, runId])).rows; }
  async stop(runId: string) { return (await this.database.pool.query<any>("UPDATE app.job_runs SET state='stopping',next_poll_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked') RETURNING id,state", [this.tenantId, runId])).rows[0] ?? null; }
}

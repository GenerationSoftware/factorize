import type { Database } from "./database";
import type { JobPageQuery } from "../job-contracts";

interface SummaryRow {
  id: string; name: string; slug: string; enabled: boolean; model: string; effort: string;
  agent_kind: string; concurrency_limit: number; running_count: string; last_run_state: string | null;
  created_at: Date; updated_at: Date;
}

/** Never reads/decrypts prompts or loads triggers. One bounded query per page. */
export class JobSummaryRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }
  async page(input: JobPageQuery, selector = false) {
    const result = await this.database.pool.query<SummaryRow>(`
      WITH page AS MATERIALIZED (
        SELECT id,name,slug,enabled,model,effort,execution_target->>'agentKind' agent_kind,
          concurrency_limit,created_at,updated_at
        FROM app.jobs WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2)
          AND ($3='' OR strpos(lower(name),lower($3))>0 OR strpos(lower(slug),lower($3))>0)
          AND ($4::boolean IS NULL OR enabled=$4)
        ORDER BY id DESC LIMIT $5
      )
      SELECT p.*,s.running_count,s.last_run_state FROM page p
      ${selector ? "LEFT JOIN LATERAL (SELECT '0'::text running_count,NULL::text last_run_state) s ON true" : `LEFT JOIN (
        SELECT r.job_id,count(*) FILTER (WHERE r.state IN ('reserved','starting','running','blocked','stopping'))::text running_count,
          (array_agg(r.state ORDER BY r.created_at DESC,r.id DESC))[1] last_run_state
        FROM app.job_runs r JOIN page ON page.id=r.job_id WHERE r.tenant_id=$1 GROUP BY r.job_id
      ) s ON s.job_id=p.id`}
      ORDER BY p.id DESC`, [this.tenantId, input.cursor ?? null, input.q, input.enabled === undefined ? null : input.enabled === "true", input.limit + 1]);
    const rows = result.rows.slice(0, input.limit);
    return {
      items: rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, enabled: row.enabled,
        ...(selector ? {} : { model: row.model, effort: row.effort, agentKind: row.agent_kind,
          concurrencyLimit: row.concurrency_limit, runningCount: Number(row.running_count ?? 0), lastRunState: row.last_run_state ?? null,
          createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }) })),
      nextCursor: result.rows.length > input.limit ? rows.at(-1)!.id : null,
    };
  }
}

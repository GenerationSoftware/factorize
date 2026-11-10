import type { Database } from "./database";
import type { JobPageQuery } from "../job-contracts";

interface SummaryRow {
  id: string; project_id: string; name: string; slug: string; enabled: boolean; model: string; effort: string;
  agent_kind: string; execution_type: string | null; concurrency_limit: number; running_count: string; active: boolean;
  last_run_state: string | null; created_at: Date; updated_at: Date;
}

const nameOrder = `name COLLATE "en-US-x-icu"`;
const encodeCursor = (tuple: unknown[]) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(tuple)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decodeCursor = (cursor: string) => {
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((cursor.length + 3) % 4);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0))));
    return Array.isArray(parsed) ? parsed : null;
  }
  catch { return null; }
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class InvalidJobSummaryCursor extends Error {}

/** Never reads/decrypts prompts or loads triggers. One bounded query per page. */
export class JobSummaryRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }
  async page(input: JobPageQuery, selector = false) {
    const sort = input.sort ?? "id";
    const direction = sort === "active" ? "desc" : input.direction ?? "asc";
    const legacyCursor = input.cursor && uuid.test(input.cursor) ? input.cursor : null;
    const cursorTuple = input.cursor && !legacyCursor ? decodeCursor(input.cursor) : null;
    const values: unknown[] = [this.tenantId];
    const clauses = ["j.tenant_id=$1", "($2='' OR strpos(lower(j.name),lower($2))>0 OR strpos(lower(j.slug),lower($2))>0)"];
    let cursorClause = "TRUE";
    values.push(input.q);
    values.push(input.enabled === undefined ? null : input.enabled === "true");
    clauses.push(`($3::boolean IS NULL OR j.enabled=$3)`);
    values.push(input.projectId ?? null);
    clauses.push(`($4::uuid IS NULL OR j.project_id=$4)`);
    if (legacyCursor && (sort === "id" || sort === "updated")) {
      values.push(legacyCursor);
      cursorClause = `j.id<$${values.length}::uuid`;
    } else if (input.cursor) {
      const expectedLength = sort === "active" || sort === "running" ? 5 : sort === "title" ? 4 : 0;
      const tupleValid = !!cursorTuple && (sort === "active"
        ? typeof cursorTuple[2] === "boolean" && typeof cursorTuple[3] === "string"
        : sort === "running" ? Number.isInteger(cursorTuple[2]) && typeof cursorTuple[3] === "string"
          : sort === "title" && typeof cursorTuple[2] === "string");
      if (!cursorTuple || !tupleValid || cursorTuple.length !== expectedLength || cursorTuple[0] !== sort || cursorTuple[1] !== direction || !uuid.test(String(cursorTuple.at(-1)))) {
        throw new InvalidJobSummaryCursor("Invalid job summary cursor for sort or direction");
      }
      if (sort === "active") {
        values.push(Number(cursorTuple[2]), String(cursorTuple[3]), String(cursorTuple[4]));
        cursorClause = `(coalesce(c.active,false) < $5::boolean OR (coalesce(c.active,false)=$5::boolean AND (${nameOrder} > $6 COLLATE "en-US-x-icu" OR (${nameOrder}=$6 COLLATE "en-US-x-icu" AND j.id>$7::uuid))))`;
      } else if (sort === "running") {
        values.push(Number(cursorTuple[2]), String(cursorTuple[3]), String(cursorTuple[4]));
        const op = direction === "asc" ? ">" : "<";
        cursorClause = `(c.running_count ${op} $5::integer OR (c.running_count=$5::integer AND (${nameOrder} > $6 COLLATE "en-US-x-icu" OR (${nameOrder}=$6 COLLATE "en-US-x-icu" AND j.id>$7::uuid))))`;
      } else if (sort === "title") {
        values.push(String(cursorTuple[2]), String(cursorTuple[3]));
        const op = direction === "asc" ? ">" : "<";
        cursorClause = `(${nameOrder} ${op} $5 COLLATE "en-US-x-icu" OR (${nameOrder}=$5 COLLATE "en-US-x-icu" AND j.id>$6::uuid))`;
      }
    }
    values.push(input.limit + 1);
    const sortOrder = sort === "active"
      ? `coalesce(c.active,false) DESC, ${nameOrder} ASC, j.id ASC`
      : sort === "running"
        ? `coalesce(c.running_count,0) ${direction.toUpperCase()}, ${nameOrder} ASC, j.id ASC`
        : sort === "title"
          ? `${nameOrder} ${direction.toUpperCase()}, j.id ASC`
          : sort === "updated"
            ? "j.updated_at DESC,j.id DESC"
            : "j.id DESC";
    const sortsByRunCount = sort === "active" || sort === "running";
    const lastRunState = selector ? "NULL::text" : "(array_agg(r.state ORDER BY r.created_at DESC,r.id DESC))[1]";
    const summaryPages = sortsByRunCount
      ? `counts AS MATERIALIZED (
          SELECT f.id,count(*) FILTER (WHERE r.state IN ('reserved','starting','running','blocked','stopping'))::integer running_count,
            bool_or(r.state IN ('reserved','starting','running','blocked','stopping')) active,
            ${lastRunState} last_run_state
          FROM filtered f LEFT JOIN app.job_runs r ON r.tenant_id=$1 AND r.job_id=f.id GROUP BY f.id
        ), page AS MATERIALIZED (
          SELECT j.*,coalesce(c.running_count,0) running_count,coalesce(c.active,false) active,c.last_run_state
          FROM filtered j LEFT JOIN counts c ON c.id=j.id WHERE ${cursorClause} ORDER BY ${sortOrder} LIMIT $${values.length}
        )`
      : selector
        ? `page AS MATERIALIZED (
            SELECT j.*,0::integer running_count,false active,NULL::text last_run_state
            FROM filtered j WHERE ${cursorClause} ORDER BY ${sortOrder} LIMIT $${values.length}
          )`
      : `page_core AS MATERIALIZED (
          SELECT j.* FROM filtered j WHERE ${cursorClause} ORDER BY ${sortOrder} LIMIT $${values.length}
        ), counts AS MATERIALIZED (
          SELECT p.id,count(*) FILTER (WHERE r.state IN ('reserved','starting','running','blocked','stopping'))::integer running_count,
            bool_or(r.state IN ('reserved','starting','running','blocked','stopping')) active,
            ${lastRunState} last_run_state
          FROM page_core p LEFT JOIN app.job_runs r ON r.tenant_id=$1 AND r.job_id=p.id GROUP BY p.id
        ), page AS MATERIALIZED (
          SELECT p.*,coalesce(c.running_count,0) running_count,coalesce(c.active,false) active,c.last_run_state
          FROM page_core p LEFT JOIN counts c ON c.id=p.id
        )`;
    const result = await this.database.pool.query<SummaryRow>(`
      WITH filtered AS ${sortsByRunCount ? "MATERIALIZED" : ""} (
        SELECT j.id,j.project_id,j.name,j.slug,j.enabled,j.model,j.effort,j.execution_config->>'agentKind' agent_kind,
          j.execution_config->>'executionType' execution_type,j.concurrency_limit,j.created_at,j.updated_at
        FROM app.jobs j WHERE ${clauses.join(" AND ")}
      ), ${summaryPages}
      SELECT p.* FROM page p ORDER BY ${sort === "active" ? `p.active DESC, p.name COLLATE "en-US-x-icu" ASC, p.id ASC` : sort === "running" ? `p.running_count ${direction.toUpperCase()}, p.name COLLATE "en-US-x-icu" ASC, p.id ASC` : sort === "title" ? `p.name COLLATE "en-US-x-icu" ${direction.toUpperCase()}, p.id ASC` : sort === "updated" ? "p.updated_at DESC,p.id DESC" : "p.id DESC"}`, values);
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1);
    const nextCursor = result.rows.length <= input.limit || !last ? null : sort === "active"
      ? encodeCursor([sort, direction, last.active, last.name, last.id])
      : sort === "running"
        ? encodeCursor([sort, direction, Number(last.running_count), last.name, last.id])
        : sort === "title"
          ? encodeCursor([sort, direction, last.name, last.id])
          : sort === "updated"
            ? last.id
            : last.id;
    return {
      items: rows.map(row => ({ id: row.id, projectId: row.project_id, name: row.name, slug: row.slug, enabled: row.enabled,
        ...(selector ? {} : { model: row.model, effort: row.effort, agentKind: row.agent_kind, executionType: row.execution_type ?? "agent",
          concurrencyLimit: row.concurrency_limit, runningCount: Number(row.running_count ?? 0), lastRunState: row.last_run_state ?? null,
          createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }) })),
      nextCursor,
    };
  }
}

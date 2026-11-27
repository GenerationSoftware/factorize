import type { Database } from "../../postgres/database";

export async function readEnrichmentRuns(database: Database, tenantId: string, id: string) {
    const { rows } = await database.pool.query<{id:string;trigger_id:string;created_at:Date;state:string;stage:string|null;reason:string|null;steps:unknown;normalized_input:unknown}>(
      `SELECT id,trigger_id,created_at,steps,normalized_input,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'failed' ELSE state END AS state,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'evaluation' ELSE stage END AS stage,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'interrupted_no_retry' ELSE reason END AS reason
       FROM app.event_enrichment_runs
       WHERE tenant_id=$1 AND definition_id=$2 ORDER BY created_at DESC,id LIMIT 50`,[tenantId,id]);
    return rows;
}

export async function readOccurrenceStates(database: Database, tenantId: string, eventIds: string[]) {
    const result = await database.pool.query<{definition_id:string;id:string}>(`SELECT DISTINCT ON (definition_id) definition_id,id FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=ANY($2::uuid[]) ORDER BY definition_id,occurred_at DESC,id DESC`, [tenantId,eventIds]);
    return result.rows;
}

import { lockJobQueue, requireQueueCapacity } from "./queue-admission";
import type { Invocation, JobRun } from "../job-domain";
import type { Database, DatabaseClient } from "./database";

export interface PersistedInvocation { invocation: Invocation; run: JobRun }

interface InvocationRow {
  invocation_id: string;
  job_id: string;
  source: Invocation["source"];
  claim_key: string;
  trigger_id: string;
  context: Record<string, unknown>;
  occurrence: Invocation["occurrence"] | null;
  invocation_created_at: Date;
  run_id: string;
  run_state: JobRun["state"];
  encrypted_prompt: string;
  run_name: string;
  run_created_at: Date;
  run_updated_at: Date;
  started_at: Date | null;
}

const SELECT_INVOCATION = `
  SELECT i.id invocation_id,i.job_id,i.source,i.claim_key,i.trigger_id,i.context,i.occurrence,
         i.created_at invocation_created_at,r.id run_id,r.state run_state,r.encrypted_prompt,
         r.run_name,r.created_at run_created_at,r.updated_at run_updated_at,r.started_at
  FROM app.invocations i
  JOIN app.job_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id
  WHERE i.tenant_id=$1 AND i.job_id=$2 AND i.claim_key=$3`;

function mapped(row: InvocationRow): PersistedInvocation {
  return {
    invocation: {
      id: row.invocation_id, jobId: row.job_id, source: row.source, claimKey: row.claim_key,
      triggerId: row.trigger_id, context: row.context, ...(row.occurrence ? { occurrence: row.occurrence } : {}),
      createdAt: row.invocation_created_at.toISOString(),
    },
    run: {
      id: row.run_id, jobId: row.job_id, invocationId: row.invocation_id, state: row.run_state,
      encryptedPrompt: row.encrypted_prompt, ...(row.run_name ? { runName: row.run_name } : {}),
      createdAt: row.run_created_at.toISOString(), updatedAt: row.run_updated_at.toISOString(),
      ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}),
    } as JobRun,
  };
}

/** All methods require tenant identity; no query in this repository is tenant-global. */
export class InvocationRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async find(jobId: string, claimKey: string, client: DatabaseClient = this.database.pool): Promise<PersistedInvocation | null> {
    const result = await client.query<InvocationRow>(SELECT_INVOCATION, [this.tenantId, jobId, claimKey]);
    return result.rows[0] ? mapped(result.rows[0]) : null;
  }

  async create(invocation: Invocation, run: JobRun, wakeAt = new Date()): Promise<PersistedInvocation & { duplicate: boolean }> {
    return this.database.transaction(async (client) => {
      await lockJobQueue(client, this.tenantId, invocation.jobId);
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context,occurrence,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (tenant_id,job_id,claim_key) DO NOTHING RETURNING id`,
      [this.tenantId, invocation.id, invocation.jobId, invocation.source, invocation.claimKey, invocation.triggerId, invocation.context, invocation.occurrence ?? null, invocation.createdAt]);

      if (inserted.rowCount) {
        await requireQueueCapacity(client, this.tenantId, invocation.jobId);
        await client.query(`
          INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,run_name,created_at,updated_at,started_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [this.tenantId, run.id, run.jobId, run.invocationId, run.state, run.encryptedPrompt, (run as JobRun & { runName?: string }).runName ?? "", run.createdAt, run.updatedAt, run.startedAt ?? null]);
        await client.query(`
          INSERT INTO app.wake_hints(key,not_before,updated_at) VALUES ('global',$1,now())
          ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before),updated_at=now()`, [wakeAt]);
      }

      const persisted = await this.find(invocation.jobId, invocation.claimKey, client);
      if (!persisted) throw new Error("Invocation transaction completed without a canonical record");
      return { ...persisted, duplicate: !inserted.rowCount };
    });
  }
}

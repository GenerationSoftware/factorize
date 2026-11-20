import { lockTriggerQueue, reserveExecutionSlot } from "./queue-admission";
import type { Invocation, TriggerRun } from "../job-domain";
import type { Database, DatabaseClient } from "./database";

export interface PersistedInvocation { invocation: Invocation; run: TriggerRun }

interface InvocationRow {
  invocation_id: string;
  trigger_id: string;
  source: Invocation["source"];
  claim_key: string;
  event_id: string;
  context: Record<string, unknown>;
  occurrence: Invocation["occurrence"] | null;
  invocation_created_at: Date;
  run_id: string;
  run_state: TriggerRun["state"];
  encrypted_prompt: string;
  run_name: string;
  run_created_at: Date;
  run_updated_at: Date;
  started_at: Date | null;
}

const SELECT_INVOCATION = `
  SELECT i.id invocation_id,i.trigger_id,i.source,i.claim_key,i.event_id,i.context,i.occurrence,
         i.created_at invocation_created_at,r.id run_id,r.state run_state,r.encrypted_prompt,
         r.run_name,r.created_at run_created_at,r.updated_at run_updated_at,r.started_at
  FROM app.invocations i
  JOIN app.trigger_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id
  WHERE i.tenant_id=$1 AND i.trigger_id=$2 AND i.claim_key=$3`;

function mapped(row: InvocationRow): PersistedInvocation {
  return {
    invocation: {
      id: row.invocation_id, triggerId: row.trigger_id, source: row.source, claimKey: row.claim_key,
      eventId: row.event_id, context: row.context, ...(row.occurrence ? { occurrence: row.occurrence } : {}),
      createdAt: row.invocation_created_at.toISOString(),
    },
    run: {
      id: row.run_id, triggerId: row.trigger_id, invocationId: row.invocation_id, state: row.run_state,
      encryptedPrompt: row.encrypted_prompt, ...(row.run_name ? { runName: row.run_name } : {}),
      createdAt: row.run_created_at.toISOString(), updatedAt: row.run_updated_at.toISOString(),
      ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}),
    } as TriggerRun,
  };
}

/** All methods require tenant identity; no query in this repository is tenant-global. */
export class InvocationRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async find(triggerId: string, claimKey: string, client: DatabaseClient = this.database.pool): Promise<PersistedInvocation | null> {
    const result = await client.query<InvocationRow>(SELECT_INVOCATION, [this.tenantId, triggerId, claimKey]);
    return result.rows[0] ? mapped(result.rows[0]) : null;
  }

  async create(invocation: Invocation, run: TriggerRun, wakeAt = new Date()): Promise<PersistedInvocation & { duplicate: boolean }> {
    return this.database.transaction(async (client) => {
      const concurrencyLimit = await lockTriggerQueue(client, this.tenantId, invocation.triggerId);
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context,occurrence,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (tenant_id,trigger_id,claim_key) DO NOTHING RETURNING id`,
      [this.tenantId, invocation.id, invocation.triggerId, invocation.source, invocation.claimKey, invocation.eventId, invocation.context, invocation.occurrence ?? null, invocation.createdAt]);

      if (inserted.rowCount) {
        await reserveExecutionSlot(client, this.tenantId, invocation.triggerId, run, concurrencyLimit);
        await client.query(`
          INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt,run_name,created_at,updated_at,started_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [this.tenantId, run.id, run.triggerId, run.invocationId, run.state, run.encryptedPrompt, (run as TriggerRun & { runName?: string }).runName ?? "", run.createdAt, run.updatedAt, run.startedAt ?? null]);
        await client.query(`
          INSERT INTO app.wake_hints(key,not_before,updated_at) VALUES ('global',$1,now())
          ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before),updated_at=now()`, [wakeAt]);
      }

      const persisted = await this.find(invocation.triggerId, invocation.claimKey, client);
      if (!persisted) throw new Error("Invocation transaction completed without a canonical record");
      return { ...persisted, duplicate: !inserted.rowCount };
    });
  }
}

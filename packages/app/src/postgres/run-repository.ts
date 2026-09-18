import type { ExecutionState, RunHandle } from "../execution";
import type { Database, DatabaseClient } from "./database";

export interface PersistedRun {
  tenantId: string; id: string; jobId: string; invocationId: string; state: ExecutionState;
  encryptedPrompt: string; executionTarget: Record<string, any>; executionHandle: RunHandle | null;
  backendKind: string; capabilities: string[]; artifactState: string; createdAt: string; updatedAt: string;
}

interface RunRow {
  tenant_id: string; id: string; job_id: string; invocation_id: string; state: ExecutionState; encrypted_prompt: string;
  execution_target: Record<string, any>; execution_handle: RunHandle | null; execution_backend_kind: string;
  execution_capabilities: string[]; artifact_state: string; created_at: Date; updated_at: Date;
}
const mapped = (row: RunRow): PersistedRun => ({ tenantId: row.tenant_id, id: row.id, jobId: row.job_id, invocationId: row.invocation_id, state: row.state, encryptedPrompt: row.encrypted_prompt, executionTarget: row.execution_target, executionHandle: row.execution_handle, backendKind: row.execution_backend_kind, capabilities: row.execution_capabilities, artifactState: row.artifact_state, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

export class RunRepository {
  constructor(private database: Database) {}

  async claimNext(): Promise<PersistedRun | null> {
    return this.database.transaction(async client => {
      const result = await client.query<RunRow>(`WITH candidate AS (
          SELECT r.tenant_id,r.id FROM app.job_runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id
          WHERE r.state='queued' AND j.enabled
            AND (SELECT count(*) FROM app.job_runs active WHERE active.tenant_id=r.tenant_id AND active.job_id=r.job_id AND active.state IN ('starting','running','blocked','stopping')) < j.concurrency_limit
          ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
        ), claimed AS (
          UPDATE app.job_runs r SET state='starting',launch_lease_expires_at=now()+interval '5 minutes',updated_at=now()
          FROM candidate c WHERE r.tenant_id=c.tenant_id AND r.id=c.id RETURNING r.*
        ) SELECT c.tenant_id,c.id,c.job_id,c.invocation_id,c.state,c.encrypted_prompt,j.execution_target || jsonb_build_object('model',j.model,'effort',j.effort) execution_target,x.execution_handle,x.execution_backend_kind,x.execution_capabilities,x.artifact_state,c.created_at,c.updated_at
          FROM claimed c JOIN app.jobs j ON j.tenant_id=c.tenant_id AND j.id=c.job_id JOIN app.runs x ON x.tenant_id=c.tenant_id AND x.id=c.id`, []);
      const row = result.rows[0];
      if (!row) return null;
      await client.query("UPDATE app.runs SET state='starting',updated_at=now() WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id]);
      return mapped(row);
    });
  }

  async dueForPoll(limit = 40): Promise<PersistedRun[]> {
    const result = await this.database.pool.query<RunRow>(`SELECT r.tenant_id,r.id,r.job_id,r.invocation_id,r.state,r.encrypted_prompt,j.execution_target || jsonb_build_object('model',j.model,'effort',j.effort) execution_target,x.execution_handle,x.execution_backend_kind,x.execution_capabilities,x.artifact_state,r.created_at,r.updated_at
      FROM app.job_runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id JOIN app.runs x ON x.tenant_id=r.tenant_id AND x.id=r.id
      WHERE r.state IN ('running','blocked','stopping') AND (r.next_poll_at IS NULL OR r.next_poll_at<=now()) ORDER BY r.next_poll_at NULLS FIRST,r.updated_at LIMIT $1`, [limit]);
    return result.rows.map(mapped);
  }

  async markLaunched(run: PersistedRun, handle: RunHandle, destinationUrl: string, capabilities: readonly string[]): Promise<void> {
    await this.database.transaction(async client => {
      await client.query("UPDATE app.job_runs SET state='running',started_at=COALESCE(started_at,now()),launch_lease_expires_at=NULL,next_poll_at=now()+interval '3 seconds',updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id]);
      await client.query("UPDATE app.runs SET state='running',execution_handle=$3,execution_backend_kind=$4,execution_capabilities=$5,destination_url=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, handle, handle.backendKind, JSON.stringify(capabilities), destinationUrl]);
    });
  }

  async schedulePoll(run: PersistedRun, state: Extract<ExecutionState, "running" | "blocked" | "stopping">, seconds = 3): Promise<void> {
    await this.database.transaction(async client => {
      await client.query("UPDATE app.job_runs SET state=$3,next_poll_at=now()+make_interval(secs=>$4),updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state, seconds]);
      await client.query("UPDATE app.runs SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state]);
    });
  }

  async terminal(run: PersistedRun, state: "succeeded" | "failed" | "stopped", artifactState: "stored" | "partial" | "failed", error?: string): Promise<void> {
    await this.database.transaction(async client => {
      await client.query("UPDATE app.job_runs SET state=$3,next_poll_at=NULL,launch_lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state]);
      await client.query("UPDATE app.runs SET state=$3,artifact_state=$4,artifact_error=$5,claim_released=true,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state, artifactState, error ?? null]);
      await client.query("DELETE FROM app.active_claims WHERE tenant_id=$1 AND run_id=$2", [run.tenantId, run.id]);
    });
  }

  async retryFinalization(run: PersistedRun, artifactState: "pending" | "collecting" | "stored" | "partial" | "failed", error: string): Promise<void> {
    await this.database.transaction(async client => {
      const attempt = (await client.query<{ vm_cleanup_attempt: number }>("UPDATE app.runs SET artifact_state=$3,artifact_error=$4,vm_cleanup_attempt=vm_cleanup_attempt+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING vm_cleanup_attempt", [run.tenantId, run.id, artifactState, error])).rows[0]?.vm_cleanup_attempt ?? 1;
      const seconds = Math.min(60, 2 ** Math.min(attempt, 6));
      await client.query("UPDATE app.job_runs SET state='running',next_poll_at=now()+make_interval(secs=>$3),updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, seconds]);
      await client.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'finalization_retry',$4)", [run.tenantId, crypto.randomUUID(), run.id, `Attempt ${attempt}: ${error}`]);
    });
  }

  async requeueExpiredStarts(): Promise<number> {
    return this.database.transaction(async client => {
      const expired = await client.query<{ tenant_id: string; id: string }>("UPDATE app.job_runs SET state='queued',launch_lease_expires_at=NULL,updated_at=now() WHERE state='starting' AND launch_lease_expires_at<now() RETURNING tenant_id,id");
      for (const row of expired.rows) await client.query("UPDATE app.runs SET state='queued',execution_handle=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id]);
      return expired.rowCount ?? 0;
    });
  }

  async nextWakeAt(client: DatabaseClient = this.database.pool): Promise<Date | null> { return (await client.query<{ wake: Date | null }>("SELECT app.next_wake_at() wake")).rows[0]?.wake ?? null; }
  async consumeWakeHint(): Promise<void> { await this.database.pool.query("DELETE FROM app.wake_hints WHERE key='global'"); }
}

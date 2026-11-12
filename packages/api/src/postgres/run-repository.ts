import type { TraceSources } from "../trace-source";
import { terminalDiagnostics, safeDiagnosticText, type ExecutionDiagnostics } from "../harness-diagnostics";
import type { ExecutionObservation } from "../execution";
import type { ExecutionState, RunHandle } from "../execution";
import type { Database, DatabaseClient } from "./database";
import type { JobResult } from "../job-result";

export interface PersistedRun {
  tenantId: string; id: string; jobId: string; invocationId: string; state: ExecutionState;
  encryptedPrompt: string; executionConfig: Record<string, any>; executionHandle: RunHandle | null;
  traceSources?: TraceSources | null; executionDiagnostics?: ExecutionDiagnostics | null; finalizationAttempt?: number;
  failureCode?: string | null; failureReason?: string | null;
  backendKind: string; capabilities: string[]; artifactState: string; resultProtocolVersion: number; createdAt: string; updatedAt: string;
}
export interface RunFailure { source: "run" | "system"; code: string; reason: string }

interface RunRow {
  tenant_id: string; id: string; job_id: string; invocation_id: string; state: ExecutionState; encrypted_prompt: string;
  execution_config: Record<string, any>; execution_handle: RunHandle | null; execution_backend_kind: string;
  failure_code?: string | null; failure_reason?: string | null;
  trace_sources: TraceSources | null; execution_diagnostics: ExecutionDiagnostics | null; vm_cleanup_attempt: number;
  execution_capabilities: string[]; artifact_state: string; result_protocol_version: number; created_at: Date; updated_at: Date;
}
const mapped = (row: RunRow): PersistedRun => ({ tenantId: row.tenant_id, id: row.id, jobId: row.job_id, invocationId: row.invocation_id, state: row.state, encryptedPrompt: row.encrypted_prompt, executionConfig: row.execution_config, traceSources: row.trace_sources, executionHandle: row.execution_handle, executionDiagnostics: row.execution_diagnostics, finalizationAttempt: row.vm_cleanup_attempt, failureCode: row.failure_code, failureReason: row.failure_reason, backendKind: row.execution_backend_kind, capabilities: row.execution_capabilities, artifactState: row.artifact_state, resultProtocolVersion: row.result_protocol_version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

export class RunRepository {
  constructor(private database: Database) {}

  async claimNext(): Promise<PersistedRun | null> {
    return this.database.transaction(async client => {
      // Retry expired launches in their existing active slot. Requeuing them
      // would compete with the single waiting run and could overflow the queue.
      const result = await client.query<RunRow>(`WITH candidate AS (
          SELECT r.tenant_id,r.id FROM app.job_runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id
          WHERE j.enabled AND ((r.state='starting' AND r.launch_lease_expires_at<now())
            OR r.state='reserved'
            OR (r.state='queued' AND (SELECT count(*) FROM app.job_runs active WHERE active.tenant_id=r.tenant_id AND active.job_id=r.job_id AND active.state IN ('reserved','starting','running','blocked','stopping')) < j.concurrency_limit))
          ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
        ), claimed AS (
          UPDATE app.job_runs r SET state='starting',launch_lease_expires_at=now()+interval '5 minutes',updated_at=now()
          FROM candidate c WHERE r.tenant_id=c.tenant_id AND r.id=c.id RETURNING r.*
        ) SELECT c.tenant_id,c.id,c.job_id,c.invocation_id,c.state,c.encrypted_prompt,x.execution_config,x.trace_sources,x.execution_handle,x.execution_backend_kind,x.execution_capabilities,x.execution_diagnostics,x.failure_code,x.failure_reason,x.vm_cleanup_attempt,x.artifact_state,x.result_protocol_version,c.created_at,c.updated_at
          FROM claimed c JOIN app.jobs j ON j.tenant_id=c.tenant_id AND j.id=c.job_id JOIN app.runs x ON x.tenant_id=c.tenant_id AND x.id=c.id`, []);
      const row = result.rows[0];
      if (!row) return null;
      await client.query("UPDATE app.runs SET state='starting',updated_at=now() WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id]);
      return mapped(row);
    });
  }

  async dueForPoll(limit = 40): Promise<PersistedRun[]> {
    const result = await this.database.pool.query<RunRow>(`SELECT r.tenant_id,r.id,r.job_id,r.invocation_id,r.state,r.encrypted_prompt,x.execution_config,x.trace_sources,x.execution_handle,x.execution_backend_kind,x.execution_capabilities,x.execution_diagnostics,x.failure_code,x.failure_reason,x.vm_cleanup_attempt,x.artifact_state,x.result_protocol_version,r.created_at,r.updated_at
      FROM app.job_runs r JOIN app.jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id JOIN app.runs x ON x.tenant_id=r.tenant_id AND x.id=r.id
      WHERE r.state IN ('running','blocked','stopping') AND x.execution_handle IS NOT NULL AND (r.next_poll_at IS NULL OR r.next_poll_at<=now()) ORDER BY r.next_poll_at NULLS FIRST,r.updated_at LIMIT $1`, [limit]);
    return result.rows.map(mapped);
  }

  /** Persist a pre-provisioning gate without creating a VM or releasing the run's queue slot. */
  async blockLaunch(run: PersistedRun, reason: string): Promise<void> {
    const safeReason = reason.slice(0, 500);
    await this.database.transaction(async client => {
      const changed = await client.query(`UPDATE app.job_runs SET state='blocked',launch_lease_expires_at=NULL,next_poll_at=NULL,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND state='starting' RETURNING id`, [run.tenantId, run.id]);
      if (!changed.rowCount) return;
      await client.query(`UPDATE app.runs SET state='blocked',failure_source='system',failure_code='proxy_launch_blocked',failure_reason=$3,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND execution_handle IS NULL`, [run.tenantId, run.id, safeReason]);
      await client.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'launch_blocked',$4)", [run.tenantId, crypto.randomUUID(), run.id, safeReason]);
    });
  }

  /** A blocked pre-launch run resumes only after an explicit owner retry. */
  async retryBlockedLaunch(tenantId: string, runId: string): Promise<boolean> {
    return this.database.transaction(async client => {
      const changed = await client.query(`UPDATE app.job_runs r SET state='reserved',launch_lease_expires_at=NULL,next_poll_at=NULL,updated_at=now()
        FROM app.runs x WHERE r.tenant_id=$1 AND r.id=$2 AND r.tenant_id=x.tenant_id AND r.id=x.id
          AND r.state='blocked' AND x.execution_handle IS NULL AND x.failure_code='proxy_launch_blocked' RETURNING r.id`, [tenantId, runId]);
      if (!changed.rowCount) return false;
      await client.query("UPDATE app.runs SET state='reserved',failure_source=NULL,failure_code=NULL,failure_reason=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId, runId]);
      await client.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'launch_retry_requested','Owner requested a manual retry')", [tenantId, crypto.randomUUID(), runId]);
      await client.query("INSERT INTO app.wake_hints(key,not_before) VALUES ('global',now()) ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before),updated_at=now()");
      return true;
    });
  }

  /** Claim a bounded batch of terminal records whose provider cleanup is incomplete. */
  async claimProviderCleanup(limit = 20): Promise<Array<{ tenantId: string; id: string; executionConfig: Record<string, any>; executionHandle: RunHandle | null; backendKind: string; startedAt: Date | null; attempt: number }>> {
    return this.database.transaction(async client => {
      const result = await client.query<{ tenant_id: string; id: string; execution_config: Record<string, any>; execution_handle: RunHandle | null; execution_backend_kind: string; provider_cleanup_attempt: number; started_at: Date | null }>(`
        WITH candidates AS (
          SELECT x.tenant_id,x.id FROM app.runs x
          JOIN app.job_runs jr ON jr.tenant_id=x.tenant_id AND jr.id=x.id
          WHERE x.state IN ('succeeded','failed','stopped') AND jr.state=x.state
            AND NOT x.vm_cleanup_complete
            AND (x.provider_cleanup_next_at IS NULL OR x.provider_cleanup_next_at <= now())
          ORDER BY x.created_at,x.tenant_id,x.id
          LIMIT $1 FOR UPDATE OF x SKIP LOCKED
        )
        UPDATE app.runs x
        SET provider_cleanup_attempt=x.provider_cleanup_attempt+1,
            provider_cleanup_next_at=now()+interval '10 minutes',updated_at=now()
        FROM candidates c WHERE x.tenant_id=c.tenant_id AND x.id=c.id
        RETURNING x.tenant_id,x.id,x.execution_config,x.execution_handle,x.execution_backend_kind,x.provider_cleanup_attempt,
          (SELECT jr.started_at FROM app.job_runs jr WHERE jr.tenant_id=x.tenant_id AND jr.id=x.id) started_at`, [limit]);
      return result.rows.map(row => ({ tenantId: row.tenant_id, id: row.id, executionConfig: row.execution_config, executionHandle: row.execution_handle, backendKind: row.execution_backend_kind, startedAt: row.started_at, attempt: row.provider_cleanup_attempt }));
    });
  }

  async completeProviderCleanup(tenantId: string, runId: string): Promise<void> {
    await this.database.pool.query(`UPDATE app.runs SET vm_cleanup_complete=true,provider_cleanup_next_at=NULL,provider_cleanup_error=NULL,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND state IN ('succeeded','failed','stopped')`, [tenantId, runId]);
  }

  async retryProviderCleanup(tenantId: string, runId: string, attempt: number, error: unknown): Promise<void> {
    const seconds = Math.min(6 * 60 * 60, 60 * 2 ** Math.min(Math.max(attempt - 1, 0), 8));
    await this.database.pool.query(`UPDATE app.runs SET provider_cleanup_next_at=now()+make_interval(secs=>$3),provider_cleanup_error=$4,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND state IN ('succeeded','failed','stopped') AND NOT vm_cleanup_complete`,
    [tenantId, runId, seconds, safeDiagnosticText(error instanceof Error ? error.message : "Execution provider cleanup failed")]);
  }

  /** Claim provider cleanup whose source job/run has already been deleted. */
  async claimDeletedJobProviderCleanup(limit = 20): Promise<Array<{ tenantId: string; id: string; executionConfig: Record<string, any>; executionHandle: RunHandle | null; backendKind: string; startedAt: Date | null; attempt: number }>> {
    return this.database.transaction(async client => {
      const result = await client.query<{ tenant_id: string; run_id: string; execution_config: Record<string, any>; execution_handle: RunHandle | null; execution_backend_kind: string; started_at: Date | null; attempts: number }>(`
        WITH candidates AS (
          SELECT tenant_id,run_id FROM app.deleted_job_provider_cleanup
          WHERE next_attempt_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY next_attempt_at,tenant_id,run_id LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        UPDATE app.deleted_job_provider_cleanup q
        SET attempts=q.attempts+1,lease_expires_at=now()+interval '10 minutes',next_attempt_at=now()+interval '10 minutes'
        FROM candidates c WHERE q.tenant_id=c.tenant_id AND q.run_id=c.run_id
        RETURNING q.tenant_id,q.run_id,q.execution_config,q.execution_handle,q.execution_backend_kind,q.started_at,q.attempts`, [limit]);
      return result.rows.map(row => ({ tenantId: row.tenant_id, id: row.run_id, executionConfig: row.execution_config, executionHandle: row.execution_handle, backendKind: row.execution_backend_kind, startedAt: row.started_at, attempt: row.attempts }));
    });
  }

  async completeDeletedJobProviderCleanup(tenantId: string, runId: string): Promise<void> {
    await this.database.pool.query("DELETE FROM app.deleted_job_provider_cleanup WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId]);
  }

  async retryDeletedJobProviderCleanup(tenantId: string, runId: string, attempt: number, error: unknown): Promise<void> {
    const seconds = Math.min(6 * 60 * 60, 60 * 2 ** Math.min(Math.max(attempt - 1, 0), 8));
    await this.database.pool.query(`UPDATE app.deleted_job_provider_cleanup SET next_attempt_at=now()+make_interval(secs=>$3),lease_expires_at=NULL,last_error=$4
      WHERE tenant_id=$1 AND run_id=$2`, [tenantId, runId, seconds, safeDiagnosticText(error instanceof Error ? error.message : "Execution provider cleanup failed")]);
  }

  /** Persist cleanup ownership before provisioning any external resources. */
  async recordLaunchHandle(run: PersistedRun, handle: RunHandle): Promise<void> {
    const result = await this.database.pool.query(`UPDATE app.runs x SET execution_handle=$3,updated_at=now()
      WHERE x.tenant_id=$1 AND x.id=$2 AND EXISTS (
        SELECT 1 FROM app.job_runs r WHERE r.tenant_id=x.tenant_id AND r.id=x.id AND r.state IN ('starting','stopping')
      ) RETURNING x.id`, [run.tenantId, run.id, handle]);
    if (!result.rowCount) throw new Error("The run is no longer eligible for provisioning");
    run.executionHandle = handle;
  }

  async markLaunched(run: PersistedRun, handle: RunHandle, destinationUrl: string, capabilities: readonly string[], traceSources?: TraceSources): Promise<void> {
    await this.database.transaction(async client => {
      const result = await client.query<{ state: ExecutionState }>("UPDATE app.job_runs SET state=CASE WHEN state='stopping' THEN 'stopping' ELSE 'running' END,started_at=COALESCE(started_at,now()),launch_lease_expires_at=NULL,next_poll_at=now()+interval '3 seconds',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','stopping') RETURNING state", [run.tenantId, run.id]);
      const state = result.rows[0]?.state;
      if (!state) return;
      await client.query("UPDATE app.runs SET state=$3,execution_handle=$4,execution_backend_kind=$5,execution_capabilities=$6,destination_url=$7,trace_sources=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state, handle, handle.backendKind, JSON.stringify(capabilities), destinationUrl, traceSources ? JSON.stringify(traceSources) : null]);
    });
    run.traceSources = traceSources ?? null;
  }

  async schedulePoll(run: PersistedRun, state: Extract<ExecutionState, "running" | "blocked" | "stopping">, seconds = 3): Promise<void> {
    await this.database.transaction(async client => {
      const result = await client.query<{ state: ExecutionState }>("UPDATE app.job_runs SET state=CASE WHEN state='stopping' THEN 'stopping' ELSE $3 END,next_poll_at=now()+make_interval(secs=>$4),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('running','blocked','stopping') RETURNING state", [run.tenantId, run.id, state, seconds]);
      if (result.rows[0]) await client.query("UPDATE app.runs SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, result.rows[0].state]);
    });
  }

  async recordObservation(run: PersistedRun, observation: ExecutionObservation): Promise<ExecutionDiagnostics> {
    const diagnostics = terminalDiagnostics(observation);
    const result = await this.database.pool.query<{ execution_diagnostics: ExecutionDiagnostics }>(
      "UPDATE app.runs SET execution_diagnostics=COALESCE(execution_diagnostics,$3::jsonb),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING execution_diagnostics",
      [run.tenantId, run.id, JSON.stringify(diagnostics)]);
    return result.rows[0].execution_diagnostics;
  }

  async recordJobResult(run: PersistedRun, result: JobResult): Promise<void> {
    await this.database.pool.query("UPDATE app.runs SET job_result=COALESCE(job_result,$3::jsonb),updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, JSON.stringify(result)]);
  }

  async recordFailureOutcome(run: PersistedRun, failure: RunFailure): Promise<void> {
    const result = await this.database.pool.query<{ failure_code: string; failure_reason: string }>(
      "UPDATE app.runs SET failure_code=COALESCE(failure_code,$3),failure_reason=COALESCE(failure_reason,$4),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING failure_code,failure_reason",
      [run.tenantId, run.id, failure.code, safeDiagnosticText(failure.reason)]);
    run.failureCode = result.rows[0]?.failure_code ?? failure.code; run.failureReason = result.rows[0]?.failure_reason ?? failure.reason;
  }

  async recordStopAttempt(run: PersistedRun): Promise<void> {
    await this.database.pool.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'stop_attempt','Scheduler attempted agent termination')", [run.tenantId, crypto.randomUUID(), run.id]);
  }

  async reportAgentError(input: { tenantId: string; runId: string; reason: string; userId: string; reporterKind: string; reporterId: string }): Promise<"missing" | "terminal" | "conflict" | "reported" | "identical"> {
    return this.database.transaction(async client => {
      // Keep the lifecycle lock order used by terminal(), stop(), and rename().
      const jobRun = (await client.query<{ state: ExecutionState }>("SELECT state FROM app.job_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [input.tenantId, input.runId])).rows[0];
      if (!jobRun) return "missing";
      const run = (await client.query<{ agent_error_reason: string | null }>("SELECT agent_error_reason FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [input.tenantId, input.runId])).rows[0];
      if (!run) return "missing";
      if (!["reserved", "starting", "running", "blocked", "stopping"].includes(jobRun.state)) return "terminal";
      if (run.agent_error_reason !== null) return run.agent_error_reason === input.reason ? "identical" : "conflict";
      await client.query(`UPDATE app.runs SET agent_error_reason=$3,agent_error_reported_at=now(),agent_error_reporter_user_id=$4,
        agent_error_reporter_kind=$5,agent_error_reporter_id=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, input.runId, input.reason, input.userId, input.reporterKind, input.reporterId]);
      await client.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'agent_error_reported',$4)", [input.tenantId, crypto.randomUUID(), input.runId, input.reason]);
      return "reported";
    });
  }

  async terminal(run: PersistedRun, state: "succeeded" | "failed" | "stopped", artifactState: "stored" | "partial" | "failed", error?: string, cleanupComplete = false, failure?: RunFailure): Promise<void> {
    await this.database.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [run.tenantId]);
      const current = (await client.query<{ state: ExecutionState }>("SELECT state FROM app.job_runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked','stopping') FOR UPDATE", [run.tenantId, run.id])).rows[0];
      if (!current) return;
      const saved = (await client.query<{ agent_error_reason: string | null }>("SELECT agent_error_reason FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [run.tenantId, run.id])).rows[0];
      const terminalState = current.state === "stopping" ? "stopped" : state === "succeeded" && saved?.agent_error_reason ? "failed" : state;
      const savedResult = (await client.query<{ job_result: { status?: string; reason?: string } | null; agent_error_reason: string | null; failure_source: string | null; failure_code: string | null; failure_reason: string | null }>("SELECT job_result,agent_error_reason,failure_source,failure_code,failure_reason FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [run.tenantId, run.id])).rows[0];
      const explicitReport = savedResult?.agent_error_reason;
      const outcome = terminalState !== "failed" ? null : savedResult?.failure_code && savedResult.failure_reason ? { source: failure?.source ?? (savedResult.failure_source === "agent" ? "run" as const : "system" as const), code: savedResult.failure_code, reason: savedResult.failure_reason } : failure ?? (state === "succeeded" && explicitReport
        ? { source: "run" as const, code: "task_reported_failure", reason: explicitReport }
        : state === "failed" && savedResult?.job_result?.status === "failed"
          ? { source: "run" as const, code: "task_reported_failure", reason: savedResult.job_result.reason ?? "The task reported failure" }
          : state === "failed" && explicitReport ? { source: "run" as const, code: "task_reported_failure", reason: explicitReport } : null);
      const failureSource = outcome ? outcome.source === "run" ? "agent" : "system" : null;
      await client.query("UPDATE app.job_runs SET state=$3,next_poll_at=NULL,launch_lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, terminalState]);
      await client.query("UPDATE app.runs SET state=$3,failure_source=$4,failure_code=$5,failure_reason=$6,artifact_state=$7,artifact_error=$8,claim_released=true,vm_cleanup_complete=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, terminalState, failureSource, outcome?.code ?? null, outcome ? safeDiagnosticText(outcome.reason) : null, artifactState, error ? safeDiagnosticText(error) : null, cleanupComplete]);
      await client.query("DELETE FROM app.active_claims WHERE tenant_id=$1 AND run_id=$2", [run.tenantId, run.id]);
      // Automation runs before polling, so terminal events need another pass.
      await client.query("INSERT INTO app.wake_hints(key,not_before) VALUES ('global',now()) ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before),updated_at=now()");
    });
  }

  async retryFinalization(run: PersistedRun, artifactState: "pending" | "collecting" | "stored" | "partial" | "failed", error: string): Promise<void> {
    await this.database.transaction(async client => {
      const attempt = (await client.query<{ vm_cleanup_attempt: number }>("UPDATE app.runs SET artifact_state=$3,artifact_error=$4,vm_cleanup_attempt=vm_cleanup_attempt+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING vm_cleanup_attempt", [run.tenantId, run.id, artifactState, safeDiagnosticText(error)])).rows[0]?.vm_cleanup_attempt ?? 1;
      const seconds = Math.min(60, 2 ** Math.min(attempt, 6));
      const state = (await client.query<{ state: ExecutionState }>("UPDATE app.job_runs SET state=CASE WHEN state='stopping' THEN 'stopping' ELSE 'running' END,next_poll_at=now()+make_interval(secs=>$3),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked','stopping') RETURNING state", [run.tenantId, run.id, seconds])).rows[0]?.state;
      if (state) await client.query("UPDATE app.runs SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [run.tenantId, run.id, state]);
      await client.query("INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail) VALUES ($1,$2,$3,'finalization_retry',$4)", [run.tenantId, crypto.randomUUID(), run.id, `Attempt ${attempt}: ${safeDiagnosticText(error)}`]);
    });
  }

  async nextWakeAt(client: DatabaseClient = this.database.pool): Promise<Date | null> { return (await client.query<{ wake: Date | null }>("SELECT app.next_wake_at() wake")).rows[0]?.wake ?? null; }
  async consumeWakeHint(): Promise<void> { await this.database.pool.query("DELETE FROM app.wake_hints WHERE key='global'"); }
}

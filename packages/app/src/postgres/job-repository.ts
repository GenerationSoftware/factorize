import type { Invocation, Job, JobRepository, JobRun, Trigger } from "../job-domain";
import type { Database, DatabaseClient } from "./database";
import { nextOccurrence, validateScheduleConfig } from "../schedule";

type Crypt = (value: string) => Promise<string>;
interface JobRow { id: string; name: string; slug: string; encrypted_prompt_template: string; encrypted_run_name_template: string; execution_target: Job["executionTarget"]; model: string; effort: string; concurrency_limit: number; enabled: boolean; created_at: Date; updated_at: Date; }
interface TriggerRow { id: string; job_id: string; kind: Trigger["kind"]; slug: string; enabled: boolean; config: Record<string, unknown>; created_at: Date; updated_at: Date; }

export class PostgresJobRepository implements JobRepository {
  constructor(private database: Database, private tenantId: string, private encrypt: Crypt, private decrypt: Crypt) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  private trigger(row: TriggerRow): Trigger { return { id: row.id, jobId: row.job_id, kind: row.kind, slug: row.slug, enabled: row.enabled, config: row.config, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
  private async mapped(row: JobRow, client: DatabaseClient = this.database.pool): Promise<Job> {
    const triggers = await client.query<TriggerRow>("SELECT id,job_id,kind,slug,enabled,config,created_at,updated_at FROM app.triggers WHERE tenant_id=$1 AND job_id=$2 ORDER BY position,created_at,id", [this.tenantId, row.id]);
    return { id: row.id, name: row.name, slug: row.slug, promptTemplate: await this.decrypt(row.encrypted_prompt_template), runNameTemplate: row.encrypted_run_name_template ? await this.decrypt(row.encrypted_run_name_template) : "", model: row.model, ...(row.effort ? { effort: row.effort } : {}), executionTarget: row.execution_target, concurrencyLimit: row.concurrency_limit, enabled: row.enabled, triggers: triggers.rows.map(value => this.trigger(value)), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async getJob(id: string): Promise<Job | null> {
    const row = (await this.database.pool.query<JobRow>("SELECT * FROM app.jobs WHERE tenant_id=$1 AND id=$2", [this.tenantId, id])).rows[0];
    return row ? this.mapped(row) : null;
  }

  async list(): Promise<Job[]> {
    const rows = (await this.database.pool.query<JobRow>("SELECT * FROM app.jobs WHERE tenant_id=$1 ORDER BY created_at DESC", [this.tenantId])).rows;
    return Promise.all(rows.map(row => this.mapped(row)));
  }

  async save(job: Job): Promise<Job> {
    return this.database.transaction(async client => {
      await client.query(`INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,encrypted_run_name_template,execution_target,model,effort,concurrency_limit,enabled,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (tenant_id,id) DO UPDATE SET name=excluded.name,slug=excluded.slug,encrypted_prompt_template=excluded.encrypted_prompt_template,encrypted_run_name_template=excluded.encrypted_run_name_template,execution_target=excluded.execution_target,model=excluded.model,effort=excluded.effort,concurrency_limit=excluded.concurrency_limit,enabled=excluded.enabled,updated_at=excluded.updated_at`,
      [this.tenantId, job.id, job.name, job.slug, await this.encrypt(job.promptTemplate), job.runNameTemplate ? await this.encrypt(job.runNameTemplate) : "", job.executionTarget, job.model, job.effort ?? "", job.concurrencyLimit, job.enabled, job.createdAt, job.updatedAt]);
      await client.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND job_id=$2", [this.tenantId, job.id]);
      for (const [position, trigger] of job.triggers.entries()) await client.query(`INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug,enabled,config,position,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [this.tenantId, trigger.id, job.id, trigger.kind, trigger.slug, trigger.enabled, trigger.config, position, trigger.createdAt, trigger.updatedAt]);
      for (const trigger of job.triggers.filter(value => value.kind === "schedule")) {
        const next = job.enabled && trigger.enabled ? nextOccurrence(validateScheduleConfig(trigger.config), new Date()) : null;
        await client.query("INSERT INTO app.schedule_state(tenant_id,trigger_id,job_id,next_run_at) VALUES ($1,$2,$3,$4)", [this.tenantId, trigger.id, job.id, next]);
      }
      const row = (await client.query<JobRow>("SELECT * FROM app.jobs WHERE tenant_id=$1 AND id=$2", [this.tenantId, job.id])).rows[0]!;
      return this.mapped(row, client);
    });
  }

  async delete(id: string): Promise<boolean> { return Boolean((await this.database.pool.query("DELETE FROM app.jobs WHERE tenant_id=$1 AND id=$2", [this.tenantId, id])).rowCount); }
  async findInvocation(jobId: string, claimKey: string) {
    const result = await this.database.pool.query<any>(`SELECT i.id invocation_id,i.job_id,i.source,i.claim_key,i.trigger_id,i.context,i.occurrence,i.created_at invocation_created_at,r.id run_id,r.state run_state,r.encrypted_prompt,r.created_at run_created_at,r.updated_at run_updated_at,r.started_at
      FROM app.invocations i JOIN app.job_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id WHERE i.tenant_id=$1 AND i.job_id=$2 AND i.claim_key=$3`, [this.tenantId, jobId, claimKey]);
    const row = result.rows[0]; if (!row) return null;
    return { invocation: { id: row.invocation_id, jobId: row.job_id, source: row.source, claimKey: row.claim_key, triggerId: row.trigger_id, context: row.context, ...(row.occurrence ? { occurrence: row.occurrence } : {}), createdAt: row.invocation_created_at.toISOString() } as Invocation, run: { id: row.run_id, jobId: row.job_id, invocationId: row.invocation_id, state: row.run_state, encryptedPrompt: row.encrypted_prompt, createdAt: row.run_created_at.toISOString(), updatedAt: row.run_updated_at.toISOString(), ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}) } as JobRun };
  }
  async insertInvocationAndRun(invocation: Invocation, run: JobRun): Promise<boolean> {
    return this.database.transaction(async client => {
      const inserted = await client.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context,occurrence,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,job_id,claim_key) DO NOTHING", [this.tenantId, invocation.id, invocation.jobId, invocation.source, invocation.claimKey, invocation.triggerId, invocation.context, invocation.occurrence ?? null, invocation.createdAt]);
      if (!inserted.rowCount) return false;
      await client.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [this.tenantId, run.id, run.jobId, run.invocationId, run.state, run.encryptedPrompt, run.createdAt, run.updatedAt]);
      await client.query(`INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,run_name,agent_name,workspace_name,agent_kind,state,execution_backend_kind,execution_capabilities,created_at,updated_at)
        SELECT $1,$2,$3,$4,$5,$6,'','',j.slug,j.execution_target->>'agentKind',$7,
          CASE WHEN j.execution_target->>'agentKind'='Amp' THEN 'amp' ELSE 'exe-vm' END,
          CASE WHEN j.execution_target->>'agentKind'='Amp' THEN '["stop"]'::jsonb ELSE '["recovery","stop"]'::jsonb END,$8,$9
        FROM app.jobs j WHERE j.tenant_id=$1 AND j.id=$3`, [this.tenantId, run.id, run.jobId, run.invocationId, invocation.source, invocation.claimKey, run.state, run.createdAt, run.updatedAt]);
      await client.query("INSERT INTO app.wake_hints(key,not_before) VALUES ('global',now()) ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before),updated_at=now()");
      return true;
    });
  }
  async countActiveRuns(jobId: string): Promise<number> { return Number((await this.database.pool.query<{ count: string }>("SELECT count(*)::text count FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state IN ('starting','running','blocked','stopping')", [this.tenantId, jobId])).rows[0]?.count ?? 0); }
  async markRunRunning(runId: string, startedAt: string): Promise<JobRun> {
    const row = (await this.database.pool.query<any>("UPDATE app.job_runs SET state='running',started_at=$3,updated_at=$3 WHERE tenant_id=$1 AND id=$2 AND state='queued' RETURNING *", [this.tenantId, runId, startedAt])).rows[0];
    if (!row) throw new Error("Run is no longer queued");
    return { id: row.id, jobId: row.job_id, invocationId: row.invocation_id, state: row.state, encryptedPrompt: row.encrypted_prompt, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), startedAt: row.started_at.toISOString() };
  }
}

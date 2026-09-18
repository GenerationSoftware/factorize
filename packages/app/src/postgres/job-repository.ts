import type { Invocation, Job, JobRepository, JobRun, Trigger } from "../job-domain";
import type { Database, DatabaseClient } from "./database";
import { nextOccurrence, validateScheduleConfig } from "../schedule";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invocations, jobs, lifecycleDeliveries, pendingVerifications, scheduleState, triggers } from "./schema";

type Crypt = (value: string) => Promise<string>;
type JobRow = typeof jobs.$inferSelect;
type TriggerRow = typeof triggers.$inferSelect;

export class PostgresJobRepository implements JobRepository {
  constructor(private database: Database, private tenantId: string, private encrypt: Crypt, private decrypt: Crypt) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  private trigger(row: TriggerRow): Trigger { return { id: row.id, jobId: row.jobId, kind: row.kind, slug: row.slug, enabled: row.enabled, config: row.config, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
  private async mapped(row: JobRow, db: any = this.database.orm): Promise<Job> {
    const triggerRows: TriggerRow[] = await db.select().from(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.jobId, row.id), isNull(triggers.removedAt))).orderBy(triggers.position, triggers.createdAt, triggers.id);
    return { id: row.id, name: row.name, slug: row.slug, promptTemplate: await this.decrypt(row.encryptedPromptTemplate), runNameTemplate: row.encryptedRunNameTemplate ? await this.decrypt(row.encryptedRunNameTemplate) : "", model: row.model, ...(row.effort ? { effort: row.effort } : {}), executionTarget: row.executionTarget, concurrencyLimit: row.concurrencyLimit, enabled: row.enabled, triggers: triggerRows.map(value => this.trigger(value)), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async getJob(id: string): Promise<Job | null> {
    const row = (await this.database.orm.select().from(jobs).where(and(eq(jobs.tenantId, this.tenantId), eq(jobs.id, id))).limit(1))[0];
    return row ? this.mapped(row) : null;
  }

  async list(): Promise<Job[]> {
    const rows = await this.database.orm.select().from(jobs).where(eq(jobs.tenantId, this.tenantId)).orderBy(sql`${jobs.createdAt} desc`);
    return Promise.all(rows.map(row => this.mapped(row)));
  }

  async create(job: Job): Promise<Job> {
    return this.database.orm.transaction(async tx => {
      const [row] = await tx.insert(jobs).values({ tenantId: this.tenantId, id: job.id, name: job.name, slug: job.slug, encryptedPromptTemplate: await this.encrypt(job.promptTemplate), encryptedRunNameTemplate: job.runNameTemplate ? await this.encrypt(job.runNameTemplate) : "", executionTarget: job.executionTarget, model: job.model, effort: job.effort ?? "", concurrencyLimit: job.concurrencyLimit, enabled: job.enabled, createdAt: new Date(job.createdAt), updatedAt: new Date(job.updatedAt) }).returning();
      await this.reconcileTriggers(tx, job, []);
      return this.mapped(row!, tx);
    });
  }

  async update(job: Job): Promise<Job> {
    return this.database.orm.transaction(async tx => {
      const [current] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, this.tenantId), eq(jobs.id, job.id))).for("update").limit(1);
      if (!current) throw new Error("Job not found");
      const existing: TriggerRow[] = await tx.select().from(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.jobId, job.id), isNull(triggers.removedAt))).orderBy(triggers.position);
      const [row] = await tx.update(jobs).set({ name: job.name, slug: job.slug, encryptedPromptTemplate: await this.encrypt(job.promptTemplate), encryptedRunNameTemplate: job.runNameTemplate ? await this.encrypt(job.runNameTemplate) : "", executionTarget: job.executionTarget, model: job.model, effort: job.effort ?? "", concurrencyLimit: job.concurrencyLimit, enabled: job.enabled, updatedAt: new Date(job.updatedAt) }).where(and(eq(jobs.tenantId, this.tenantId), eq(jobs.id, job.id))).returning();
      await this.reconcileTriggers(tx, job, existing);
      return this.mapped(row!, tx);
    });
  }

  async setEnabled(id: string, enabled: boolean, changedAt: string): Promise<boolean> {
    return this.database.orm.transaction(async tx => {
      const [job] = await tx.update(jobs).set({ enabled, updatedAt: new Date(changedAt) }).where(and(eq(jobs.tenantId, this.tenantId), eq(jobs.id, id))).returning();
      if (!job) return false;
      const schedules: TriggerRow[] = await tx.select().from(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.jobId, id), eq(triggers.kind, "schedule"), isNull(triggers.removedAt)));
      for (const trigger of schedules) await tx.update(scheduleState).set({ nextRunAt: enabled && trigger.enabled ? nextOccurrence(validateScheduleConfig(trigger.config), new Date()) : null }).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.triggerId, trigger.id)));
      return true;
    });
  }

  private async reconcileTriggers(tx: any, job: Job, existing: TriggerRow[]): Promise<void> {
    const desiredIds = new Set(job.triggers.map(trigger => trigger.id));
    for (const old of existing.filter(trigger => !desiredIds.has(trigger.id))) {
      const referenced = await tx.select({ value: sql<number>`1` }).from(invocations).where(and(eq(invocations.tenantId, this.tenantId), eq(invocations.triggerId, old.id))).limit(1)
        .then((rows: unknown[]) => rows.length > 0) || await tx.select({ value: sql<number>`1` }).from(lifecycleDeliveries).where(and(eq(lifecycleDeliveries.tenantId, this.tenantId), eq(lifecycleDeliveries.triggerId, old.id))).limit(1).then((rows: unknown[]) => rows.length > 0)
        || await tx.select({ value: sql<number>`1` }).from(pendingVerifications).where(and(eq(pendingVerifications.tenantId, this.tenantId), eq(pendingVerifications.triggerId, old.id))).limit(1).then((rows: unknown[]) => rows.length > 0);
      if (referenced) await tx.update(triggers).set({ enabled: false, removedAt: new Date(job.updatedAt), updatedAt: new Date(job.updatedAt) }).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, old.id)));
      else await tx.delete(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, old.id)));
      await tx.delete(scheduleState).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.triggerId, old.id)));
    }
    const existingById = new Map(existing.map(trigger => [trigger.id, trigger]));
    for (const [position, trigger] of job.triggers.entries()) {
      const old = existingById.get(trigger.id);
      if (old && old.kind !== trigger.kind) throw new Error("Trigger kind is immutable; replace the trigger with a new id");
      if (old) await tx.update(triggers).set({ slug: trigger.slug, enabled: trigger.enabled, config: trigger.config, position, updatedAt: new Date(trigger.updatedAt) }).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, trigger.id)));
      else await tx.insert(triggers).values({ tenantId: this.tenantId, id: trigger.id, jobId: job.id, kind: trigger.kind, slug: trigger.slug, enabled: trigger.enabled, config: trigger.config, position, createdAt: new Date(trigger.createdAt), updatedAt: new Date(trigger.updatedAt) });
      if (trigger.kind === "schedule") {
        const next = job.enabled && trigger.enabled ? nextOccurrence(validateScheduleConfig(trigger.config), new Date()) : null;
        await tx.insert(scheduleState).values({ tenantId: this.tenantId, triggerId: trigger.id, jobId: job.id, nextRunAt: next }).onConflictDoUpdate({ target: [scheduleState.tenantId, scheduleState.triggerId], set: { nextRunAt: next } });
      } else await tx.delete(scheduleState).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.triggerId, trigger.id)));
    }
  }

  async delete(id: string): Promise<boolean> { return Boolean((await this.database.orm.delete(jobs).where(and(eq(jobs.tenantId, this.tenantId), eq(jobs.id, id))).returning({ id: jobs.id })).length); }
  async findInvocation(jobId: string, claimKey: string) {
    const result = await this.database.pool.query<any>(`SELECT i.id invocation_id,i.job_id,i.source,i.claim_key,i.trigger_id,i.context,i.occurrence,i.created_at invocation_created_at,r.id run_id,r.state run_state,r.encrypted_prompt,r.run_name,r.created_at run_created_at,r.updated_at run_updated_at,r.started_at
      FROM app.invocations i JOIN app.job_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id WHERE i.tenant_id=$1 AND i.job_id=$2 AND i.claim_key=$3`, [this.tenantId, jobId, claimKey]);
    const row = result.rows[0]; if (!row) return null;
    return { invocation: { id: row.invocation_id, jobId: row.job_id, source: row.source, claimKey: row.claim_key, triggerId: row.trigger_id, context: row.context, ...(row.occurrence ? { occurrence: row.occurrence } : {}), createdAt: row.invocation_created_at.toISOString() } as Invocation, run: { id: row.run_id, jobId: row.job_id, invocationId: row.invocation_id, state: row.run_state, encryptedPrompt: row.encrypted_prompt, ...(row.run_name ? { runName: row.run_name } : {}), createdAt: row.run_created_at.toISOString(), updatedAt: row.run_updated_at.toISOString(), ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}) } as JobRun };
  }
  async insertInvocationAndRun(invocation: Invocation, run: JobRun): Promise<boolean> {
    return this.database.transaction(async client => {
      const inserted = await client.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context,occurrence,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,job_id,claim_key) DO NOTHING", [this.tenantId, invocation.id, invocation.jobId, invocation.source, invocation.claimKey, invocation.triggerId, invocation.context, invocation.occurrence ?? null, invocation.createdAt]);
      if (!inserted.rowCount) return false;
      await client.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,run_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [this.tenantId, run.id, run.jobId, run.invocationId, run.state, run.encryptedPrompt, run.runName ?? "", run.createdAt, run.updatedAt]);
      await client.query(`INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,run_name,agent_name,workspace_name,agent_kind,state,execution_backend_kind,execution_capabilities,created_at,updated_at)
        SELECT $1,$2,$3,$4,$5,$6,$8,'',j.slug,j.execution_target->>'agentKind',$7,
          CASE WHEN j.execution_target->>'agentKind'='Amp' THEN 'amp' ELSE 'exe-vm' END,
          CASE WHEN j.execution_target->>'agentKind'='Amp' THEN '["stop"]'::jsonb ELSE '["recovery","stop"]'::jsonb END,$9,$10
        FROM app.jobs j WHERE j.tenant_id=$1 AND j.id=$3`, [this.tenantId, run.id, run.jobId, run.invocationId, invocation.source, invocation.claimKey, run.state, run.runName ?? "", run.createdAt, run.updatedAt]);
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

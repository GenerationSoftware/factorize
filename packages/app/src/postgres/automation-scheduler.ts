import { decrypt, encrypt } from "../crypto";
import { InvocationService } from "../job-domain";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig } from "../schedule";
import type { Env } from "../types";
import type { Database } from "./database";
import { PostgresJobRepository } from "./job-repository";

/** Claims durable automatic signals in PostgreSQL. The alarm DO is only its clock. */
export class AutomationScheduler {
  constructor(private database: Database, private env: Env) {}
  async process(): Promise<void> { await this.schedules(); await this.lifecycle(); }
  private repository(tenantId: string) { return new PostgresJobRepository(this.database, tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }
  private async schedules() {
    for (let count = 0; count < 50; count++) {
      const due = await this.database.transaction(async client => {
        const row = (await client.query<any>(`SELECT s.tenant_id,s.trigger_id,s.job_id,s.next_run_at,t.slug,t.config FROM app.schedule_state s JOIN app.triggers t ON t.tenant_id=s.tenant_id AND t.id=s.trigger_id JOIN app.jobs j ON j.tenant_id=s.tenant_id AND j.id=s.job_id WHERE s.next_run_at<=now() AND t.enabled AND j.enabled ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 1`)).rows[0];
        if (!row) return null;
        const config = validateScheduleConfig(row.config), occurrence = catchUpOccurrence(config, row.next_run_at, new Date());
        if (!occurrence) return null;
        await client.query("UPDATE app.schedule_state SET last_triggered_at=$3,next_run_at=$4 WHERE tenant_id=$1 AND trigger_id=$2", [row.tenant_id, row.trigger_id, occurrence.occurredAt, occurrence.nextRunAt]);
        return { ...row, occurrence };
      });
      if (!due) break;
      const service = new InvocationService(this.repository(due.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
      const occurredAt = due.occurrence.occurredAt.toISOString(), occurrence = { occurredAt, externalId: occurredAt, metadata: { timezone: due.config.timezone } };
      await service.invoke(due.job_id, { source: "schedule", triggerId: due.trigger_id, claimKey: `schedule:${due.trigger_id}:${occurredAt}`, context: { [due.slug]: occurrence }, occurrence });
    }
  }
  private async lifecycle() {
    const rows = await this.database.pool.query<any>(`SELECT t.tenant_id,t.id trigger_id,t.job_id,t.slug,t.config,r.id source_run_id,r.job_id source_job_id,r.state,r.updated_at FROM app.triggers t JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id JOIN app.runs r ON r.tenant_id=t.tenant_id AND r.job_id=(t.config->>'sourceJobId')::uuid LEFT JOIN app.lifecycle_deliveries d ON d.tenant_id=t.tenant_id AND d.trigger_id=t.id AND d.source_run_id=r.id AND d.terminal_state=r.state WHERE t.kind='jobLifecycle' AND t.enabled AND j.enabled AND r.state IN ('succeeded','failed','stopped') AND d.source_run_id IS NULL ORDER BY r.updated_at LIMIT 100`);
    for (const row of rows.rows) {
      const states: string[] = row.config.states ?? row.config.terminalStates ?? ["succeeded", "failed", "stopped"]; if (!states.includes(row.state)) continue;
      const inserted = await this.database.pool.query("INSERT INTO app.lifecycle_deliveries(tenant_id,trigger_id,source_run_id,terminal_state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.tenant_id, row.trigger_id, row.source_run_id, row.state]); if (!inserted.rowCount) continue;
      const context = { sourceRunId: row.source_run_id, sourceJobId: row.source_job_id, state: row.state, completedAt: row.updated_at.toISOString() }, occurrence = { occurredAt: context.completedAt, externalId: `${row.source_run_id}:${row.state}`, metadata: context };
      await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.job_id, { source: "jobLifecycle", triggerId: row.trigger_id, claimKey: `lifecycle:${row.trigger_id}:${row.source_run_id}:${row.state}`, context: { [row.slug]: context }, occurrence });
    }
  }
}

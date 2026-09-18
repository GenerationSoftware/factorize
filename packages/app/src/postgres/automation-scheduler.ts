import { decrypt, encrypt } from "../crypto";
import { InvocationService } from "../job-domain";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig } from "../schedule";
import type { Env } from "../types";
import type { Database } from "./database";
import { PostgresJobRepository } from "./job-repository";
import { githubHeaders, installationToken } from "../github";
import { adaptWebhook, type WebhookTriggerConfig } from "../webhook-trigger";
import { invokeCustomHandler } from "../custom-handler";

/** Claims durable automatic signals in PostgreSQL. The alarm DO is only its clock. */
export class AutomationScheduler {
  constructor(private database: Database, private env: Env) {}
  async process(): Promise<void> { await this.githubVerifications(); await this.schedules(); await this.lifecycle(); }
  private repository(tenantId: string) { return new PostgresJobRepository(this.database, tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }
  private async schedules() {
    for (let count = 0; count < 50; count++) {
      const due = await this.database.transaction(async client => {
        const row = (await client.query<any>(`SELECT s.tenant_id,s.trigger_id,s.job_id,s.next_run_at,t.slug,t.config FROM app.schedule_state s JOIN app.triggers t ON t.tenant_id=s.tenant_id AND t.id=s.trigger_id JOIN app.jobs j ON j.tenant_id=s.tenant_id AND j.id=s.job_id WHERE s.next_run_at<=now() AND t.enabled AND t.removed_at IS NULL AND j.enabled ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 1`)).rows[0];
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
    const rows = await this.database.pool.query<any>(`SELECT t.tenant_id,t.id trigger_id,t.job_id,t.slug,t.config,r.id source_run_id,r.job_id source_job_id,r.state,r.updated_at FROM app.triggers t JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id JOIN app.runs r ON r.tenant_id=t.tenant_id AND r.job_id=(t.config->>'sourceJobId')::uuid LEFT JOIN app.lifecycle_deliveries d ON d.tenant_id=t.tenant_id AND d.trigger_id=t.id AND d.source_run_id=r.id AND d.terminal_state=r.state WHERE t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled AND r.state IN ('succeeded','failed','stopped') AND d.source_run_id IS NULL ORDER BY r.updated_at LIMIT 100`);
    for (const row of rows.rows) {
      const states: string[] = row.config.states ?? row.config.terminalStates ?? ["succeeded", "failed", "stopped"]; if (!states.includes(row.state)) continue;
      const inserted = await this.database.pool.query("INSERT INTO app.lifecycle_deliveries(tenant_id,trigger_id,source_run_id,terminal_state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.tenant_id, row.trigger_id, row.source_run_id, row.state]); if (!inserted.rowCount) continue;
      const context = { sourceRunId: row.source_run_id, sourceJobId: row.source_job_id, state: row.state, completedAt: row.updated_at.toISOString() }, occurrence = { occurredAt: context.completedAt, externalId: `${row.source_run_id}:${row.state}`, metadata: context };
      await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.job_id, { source: "jobLifecycle", triggerId: row.trigger_id, claimKey: `lifecycle:${row.trigger_id}:${row.source_run_id}:${row.state}`, context: { [row.slug]: context }, occurrence });
    }
  }

  private async githubVerifications() {
    const pending = await this.database.pool.query<any>(`SELECT p.*,t.slug trigger_slug,t.config trigger_config,g.state installation_state FROM app.pending_verifications p JOIN app.triggers t ON t.tenant_id=p.tenant_id AND t.id=p.trigger_id LEFT JOIN app.github_installations g ON g.tenant_id=p.tenant_id AND g.installation_id=p.installation_id WHERE p.next_attempt_at<=now() ORDER BY p.next_attempt_at LIMIT 20`);
    for (const row of pending.rows) {
      const finish = async (outcome: string, detail: string) => {
        await this.database.transaction(async client => {
          await client.query("DELETE FROM app.pending_verifications WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id]);
          await client.query("INSERT INTO app.job_events(tenant_id,id,job_id,provider,delivery_id,outcome,detail) VALUES ($1,$2,$3,'github',$4,$5,$6)", [row.tenant_id, crypto.randomUUID(), row.job_id, row.delivery_id, outcome, detail]);
          const delivery = (await client.query<any>("SELECT id FROM app.webhook_deliveries WHERE tenant_id=$1 AND provider='github' AND delivery_id=$2", [row.tenant_id, row.delivery_id])).rows[0];
          if (delivery) { await client.query("INSERT INTO app.webhook_delivery_events(tenant_id,id,delivery_id,job_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6)", [row.tenant_id, crypto.randomUUID(), delivery.id, row.job_id, outcome, detail]); await client.query("UPDATE app.webhook_deliveries SET outcome=$3,detail=$4 WHERE tenant_id=$1 AND id=$2", [row.tenant_id, delivery.id, outcome, detail]); }
        });
      };
      if (row.installation_state !== "active") { await finish("verification_failed", "GitHub installation is disconnected."); continue; }
      try {
        const token = await installationToken(this.env, Number(row.installation_id)), response = await fetch(`https://api.github.com/repos/${encodeURIComponent(row.repository_owner)}/${encodeURIComponent(row.repository_name)}/pulls/${row.pull_number}`, { headers: githubHeaders(token) });
        if (!response.ok) throw new Error(`GitHub verification failed (${response.status})`);
        const pull = await response.json() as any;
        if (pull.state !== "open" || pull.base?.ref !== "main" || pull.mergeable === true) { await finish("ignored", pull.mergeable === true ? "GitHub reports that the pull request is mergeable." : "Pull request is closed or no longer targets main."); continue; }
        if (pull.mergeable === null) { const attempt = Number(row.attempt) + 1; if (attempt >= 8) await finish("verification_failed", "GitHub did not finish calculating mergeability."); else await this.database.pool.query("UPDATE app.pending_verifications SET attempt=$3,next_attempt_at=now()+make_interval(secs=>least(60,5*$3)) WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, attempt]); continue; }
        const config = row.trigger_config as WebhookTriggerConfig, invocation = adaptWebhook(config, "github", row.delivery_id, row.payload, "pull_request");
        if (!invocation) { await finish("ignored", "Verified pull request no longer matches the trigger."); continue; }
        let context: Record<string, unknown> = { ...invocation.payload, pull_request: { ...invocation.payload.pull_request as any, mergeable: false, mergeable_state: pull.mergeable_state } };
        if (config.handlerCode) {
          if (!this.env.CUSTOM_HANDLER_LOADER) { await finish("platform_error", "Webhook handler platform is unavailable; no run was created."); continue; }
          const decision = await invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, { handlerCode: config.handlerCode }, context);
          if (!decision.ok) { await finish(decision.category, "Webhook handler failed closed; no run was created."); continue; }
          if (decision.decision === false) { await finish("rejected", "Handler returned false; no run was created."); continue; }
          if (decision.decision !== true) context = decision.decision;
        }
        const result = await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.job_id, { source: "webhook", triggerId: row.trigger_id, claimKey: `webhook:${row.trigger_id}:${invocation.claimKey}`, context: { [row.trigger_slug]: context }, occurrence: { ...invocation.occurrence, metadata: { ...invocation.occurrence.metadata, triggerId: row.trigger_id, mergeable: false } } });
        await finish(result.duplicate ? "duplicate" : "accepted", result.duplicate ? "Verified occurrence was already claimed." : "Merge-conflicted pull request queued through canonical job invocation.");
      } catch (error) {
        const attempt = Number(row.attempt) + 1, detail = error instanceof Error ? error.message : "GitHub verification failed";
        if (attempt >= 8) await finish("verification_failed", detail); else await this.database.pool.query("UPDATE app.pending_verifications SET attempt=$3,next_attempt_at=now()+make_interval(secs=>least(60,5*$3)) WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, attempt]);
      }
    }
  }
}

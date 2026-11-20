import { SkillContent } from "../skill-content";
import { decrypt, encrypt } from "../crypto";
import { InvocationError, InvocationService } from "../job-domain";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig } from "../schedule";
import type { Env } from "../types";
import type { Database } from "./database";
import { PostgresTriggerRepository } from "./job-repository";
import { githubHeaders, installationToken } from "../github";
import { adaptWebhook, type WebhookEventConfig } from "../webhook-trigger";
import { evaluateWebhookConditions } from "../webhook-conditions";

function skipFullQueue(error: unknown): void {
  if (!(error instanceof InvocationError) || error.code !== "queue_full") throw error;
}

const DEFAULT_LIFECYCLE_BATCH_SIZE = 100;

/** Claims durable automatic signals in PostgreSQL. The alarm DO is only its clock. */
export class AutomationScheduler {
  constructor(private database: Database, private env: Env, private lifecycleBatchSize = DEFAULT_LIFECYCLE_BATCH_SIZE) {
    if (!Number.isSafeInteger(lifecycleBatchSize) || lifecycleBatchSize < 1) throw new RangeError("Lifecycle batch size must be a positive integer");
  }
  async process(): Promise<void> { await this.githubVerifications(); await this.schedules(); await this.triggerEdits(); await this.lifecycle(); await this.triggerIdle(); }
  private repository(tenantId: string) { return new PostgresTriggerRepository(this.database, tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), new SkillContent(this.env.SKILL_ARTIFACTS)); }
  private async schedules() {
    for (let count = 0; count < 50; count++) {
      const due = await this.database.transaction(async client => {
        const row = (await client.query<any>(`SELECT s.tenant_id,s.event_id,s.trigger_id,s.next_run_at,t.slug,t.config FROM app.schedule_state s JOIN app.events t ON t.tenant_id=s.tenant_id AND t.id=s.event_id JOIN app.triggers j ON j.tenant_id=s.tenant_id AND j.id=s.trigger_id WHERE s.next_run_at<=now() AND t.enabled AND t.removed_at IS NULL AND j.enabled ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 1`)).rows[0];
        if (!row) return null;
        const config = validateScheduleConfig(row.config), occurrence = catchUpOccurrence(config, row.next_run_at, new Date());
        if (!occurrence) return null;
        await client.query("UPDATE app.schedule_state SET last_fired_at=$3,next_run_at=$4 WHERE tenant_id=$1 AND event_id=$2", [row.tenant_id, row.event_id, occurrence.occurredAt, occurrence.nextRunAt]);
        return { ...row, occurrence };
      });
      if (!due) break;
      const service = new InvocationService(this.repository(due.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
      const occurredAt = due.occurrence.occurredAt.toISOString(), occurrence = { occurredAt, externalId: occurredAt, metadata: { timezone: due.config.timezone } };
      await service.invoke(due.trigger_id, { source: "schedule", eventId: due.event_id, claimKey: `schedule:${due.event_id}:${occurredAt}`, context: { [due.slug]: occurrence }, occurrence }).catch(skipFullQueue);
    }
  }
  private async triggerEdits() {
    const pending = await this.database.pool.query<any>(`SELECT d.*,t.trigger_id,t.slug FROM app.trigger_edit_deliveries d
      JOIN app.events t ON t.tenant_id=d.tenant_id AND t.id=d.event_id
      JOIN app.triggers j ON j.tenant_id=t.tenant_id AND j.id=t.trigger_id
      WHERE t.enabled AND t.removed_at IS NULL AND j.enabled
        AND t.config->'sourceTriggerIds' ? d.source_trigger_id::text AND t.config->'states' ? 'edited'
      ORDER BY d.edited_at,d.delivery_id LIMIT 100`);
    for (const row of pending.rows) {
      const context = { source_trigger_id: row.source_trigger_id, event: "edited", edited_at: row.edited_at.toISOString() };
      // Acknowledge only after invocation succeeds. Retrying after a crash uses
      // the same claim key and returns the existing run.
      await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.trigger_id, {
        source: "triggerLifecycle", eventId: row.event_id, claimKey: `trigger-edited:${row.event_id}:${row.delivery_id}`,
        context: { [row.slug]: context }, occurrence: { occurredAt: context.edited_at, externalId: row.delivery_id, metadata: context },
      });
      await this.database.pool.query("DELETE FROM app.trigger_edit_deliveries WHERE tenant_id=$1 AND delivery_id=$2 AND event_id=$3", [row.tenant_id, row.delivery_id, row.event_id]);
    }
  }

  private async lifecycle() {
    // Drain the backlog before checking idle events. The idle query below
    // also guards against eligible unacknowledged deliveries so concurrent
    // scheduler passes cannot cross this ordering boundary.
    for (;;) {
      const rows = await this.database.pool.query<any>(`SELECT t.tenant_id,t.id event_id,t.trigger_id,t.slug,e.source_run_id,r.trigger_id source_trigger_id,e.terminal_state state,e.occurred_at,r.trigger_result
      FROM app.events t
      JOIN app.triggers j ON j.tenant_id=t.tenant_id AND j.id=t.trigger_id
      JOIN app.lifecycle_events e ON e.tenant_id=t.tenant_id AND e.event_id=t.id
      JOIN app.runs r ON r.tenant_id=e.tenant_id AND r.id=e.source_run_id
      LEFT JOIN app.lifecycle_deliveries d ON d.tenant_id=e.tenant_id AND d.event_id=e.event_id AND d.source_run_id=e.source_run_id AND d.terminal_state=e.terminal_state
      WHERE t.kind='triggerLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
        AND d.source_run_id IS NULL ORDER BY e.delivery_id LIMIT $1`, [this.lifecycleBatchSize]);
      if (!rows.rows.length) break;
      for (const row of rows.rows) {
        const context = { sourceRunId: row.source_run_id, sourceTriggerId: row.source_trigger_id, state: row.state, completedAt: row.occurred_at.toISOString(), outputs: row.trigger_result?.outputs ?? null }, occurrence = { occurredAt: context.completedAt, externalId: `${row.source_run_id}:${row.state}`, metadata: context };
        // Acknowledge after invocation so transient failures remain retryable.
        // Queue-full is an intentional terminal outcome: no run is queued, so
        // acknowledging it permits idle events to proceed.
        // The stable claim key deduplicates retries after an invocation commits
        // but its delivery acknowledgement fails.
        await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.trigger_id, { source: "triggerLifecycle", eventId: row.event_id, claimKey: `lifecycle:${row.event_id}:${row.source_run_id}:${row.state}`, context: { [row.slug]: context }, occurrence }).catch(skipFullQueue);
        await this.database.pool.query("INSERT INTO app.lifecycle_deliveries(tenant_id,event_id,source_run_id,terminal_state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.tenant_id, row.event_id, row.source_run_id, row.state]);
      }
    }
  }

  private async triggerIdle() {
    const rows = await this.database.pool.query<any>(`SELECT t.tenant_id,t.id event_id,t.trigger_id,t.slug,r.id source_run_id,r.trigger_id source_trigger_id,r.updated_at
      FROM app.events t JOIN app.triggers j ON j.tenant_id=t.tenant_id AND j.id=t.trigger_id
      CROSS JOIN LATERAL jsonb_array_elements_text(t.config->'sourceTriggerIds') source_trigger(value)
      JOIN LATERAL (SELECT id,trigger_id,updated_at FROM app.runs WHERE tenant_id=t.tenant_id AND trigger_id=source_trigger.value::uuid AND state IN ('succeeded','failed','stopped') ORDER BY updated_at DESC,id DESC LIMIT 1) r ON true
      WHERE t.kind='triggerIdle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
        AND r.updated_at > t.updated_at
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(t.config->'sourceTriggerIds') watched(value)
          JOIN app.runs active ON active.tenant_id=t.tenant_id AND active.trigger_id=watched.value::uuid
          WHERE active.state IN ('queued','reserved','starting','running','blocked','stopping')
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(t.config->'sourceTriggerIds') watched(value)
          JOIN app.runs newer ON newer.tenant_id=t.tenant_id AND newer.trigger_id=watched.value::uuid
          WHERE newer.state IN ('succeeded','failed','stopped')
            AND (newer.updated_at,newer.id) > (r.updated_at,r.id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(t.config->'sourceTriggerIds') watched(value)
          JOIN app.runs pending_source ON pending_source.tenant_id=t.tenant_id
            AND pending_source.trigger_id=watched.value::uuid
            AND pending_source.state IN ('succeeded','failed','stopped')
          JOIN app.events lifecycle_event ON lifecycle_event.tenant_id=pending_source.tenant_id
            AND lifecycle_event.kind='triggerLifecycle' AND lifecycle_event.enabled
            AND lifecycle_event.removed_at IS NULL
          JOIN app.triggers lifecycle_trigger ON lifecycle_trigger.tenant_id=lifecycle_event.tenant_id
            AND lifecycle_trigger.id=lifecycle_event.trigger_id AND lifecycle_trigger.enabled
          WHERE EXISTS (
            SELECT 1 FROM app.lifecycle_events pending_event
            WHERE pending_event.tenant_id=lifecycle_event.tenant_id AND pending_event.event_id=lifecycle_event.id
              AND pending_event.source_run_id=pending_source.id AND pending_event.terminal_state=pending_source.state
              AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries pending_delivery
                WHERE pending_delivery.tenant_id=pending_event.tenant_id AND pending_delivery.event_id=pending_event.event_id
                  AND pending_delivery.source_run_id=pending_event.source_run_id AND pending_delivery.terminal_state=pending_event.terminal_state)
          )
        )
        AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d WHERE d.tenant_id=t.tenant_id AND d.event_id=t.id AND d.source_run_id=r.id AND d.terminal_state='runsZero')
        ORDER BY r.updated_at LIMIT 100`);
    for (const row of rows.rows) {
      const completedAt = row.updated_at.toISOString(), context = { source_trigger_id: row.source_trigger_id, event: "runsZero", completed_at: completedAt };
      await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.trigger_id, { source: "triggerIdle", eventId: row.event_id, claimKey: `trigger-idle:${row.event_id}:${row.source_run_id}`, context: { [row.slug]: context }, occurrence: { occurredAt: completedAt, externalId: row.source_run_id, metadata: context } }).catch(skipFullQueue);
      await this.database.pool.query("INSERT INTO app.lifecycle_deliveries(tenant_id,event_id,source_run_id,terminal_state) VALUES ($1,$2,$3,'runsZero') ON CONFLICT DO NOTHING", [row.tenant_id, row.event_id, row.source_run_id]);
    }
  }

  private async githubVerifications() {
    const pending = await this.database.pool.query<any>(`SELECT p.*,t.slug event_slug,t.config event_config,t.enabled event_enabled,t.removed_at,j.enabled trigger_enabled,g.state installation_state FROM app.pending_verifications p JOIN app.events t ON t.tenant_id=p.tenant_id AND t.id=p.event_id JOIN app.triggers j ON j.tenant_id=p.tenant_id AND j.id=p.trigger_id LEFT JOIN app.github_installations g ON g.tenant_id=p.tenant_id AND g.installation_id=p.installation_id WHERE p.next_attempt_at<=now() ORDER BY p.next_attempt_at LIMIT 20`);
    for (const row of pending.rows) {
      const finish = async (outcome: string, detail: string) => {
        await this.database.transaction(async client => {
          await client.query("DELETE FROM app.pending_verifications WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id]);
          await client.query("INSERT INTO app.trigger_events(tenant_id,id,trigger_id,provider,delivery_id,outcome,detail) VALUES ($1,$2,$3,'github',$4,$5,$6)", [row.tenant_id, crypto.randomUUID(), row.trigger_id, row.delivery_id, outcome, detail]);
          const delivery = (await client.query<any>("SELECT id FROM app.webhook_deliveries WHERE tenant_id=$1 AND provider='github' AND delivery_id=$2", [row.tenant_id, row.delivery_id])).rows[0];
          if (delivery) { await client.query("INSERT INTO app.webhook_delivery_events(tenant_id,id,delivery_id,trigger_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6)", [row.tenant_id, crypto.randomUUID(), delivery.id, row.trigger_id, outcome, detail]); await client.query("UPDATE app.webhook_deliveries SET outcome=$3,detail=$4 WHERE tenant_id=$1 AND id=$2", [row.tenant_id, delivery.id, outcome, detail]); }
        });
      };
      if (!row.event_enabled || row.removed_at || !row.trigger_enabled) { await finish("disabled", "Event or trigger is disabled or removed."); continue; }
      if (row.installation_state !== "active") { await finish("verification_failed", "GitHub installation is disconnected."); continue; }
      try {
        const token = await installationToken(this.env, Number(row.installation_id)), response = await fetch(`https://api.github.com/repos/${encodeURIComponent(row.repository_owner)}/${encodeURIComponent(row.repository_name)}/pulls/${row.pull_number}`, { headers: githubHeaders(token) });
        if (!response.ok) throw new Error(`GitHub verification failed (${response.status})`);
        const pull = await response.json() as any;
        if (pull.state !== "open" || pull.base?.ref !== "main" || pull.mergeable === true) { await finish("ignored", pull.mergeable === true ? "GitHub reports that the pull request is mergeable." : "Pull request is closed or no longer targets main."); continue; }
        if (pull.mergeable !== false) { const attempt = Number(row.attempt) + 1; if (attempt >= 8) await finish("verification_failed", "GitHub did not finish calculating mergeability."); else await this.database.pool.query("UPDATE app.pending_verifications SET attempt=$3,next_attempt_at=now()+make_interval(secs=>least(60,5*$3)) WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, attempt]); continue; }
        const config = row.event_config as WebhookEventConfig, invocation = adaptWebhook(config, "github", row.delivery_id, row.payload, "pull_request");
        if (!invocation) { await finish("ignored", "Verified pull request no longer matches the event."); continue; }
        let context: Record<string, unknown> = { ...invocation.payload, pull_request: { ...invocation.payload.pull_request as any, mergeable: false, mergeable_state: pull.mergeable_state } };
        const decision = await evaluateWebhookConditions(config.conditions, context);
        if (decision.decision !== "match") {
          await finish(decision.decision === "error" ? "conditions_error" : "excluded", decision.decision === "error" ? "Webhook conditions failed; no run was created." : "Webhook conditions did not match; no run was created.");
          continue;
        }
        const result = await new InvocationService(this.repository(row.tenant_id), value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(row.trigger_id, { source: "webhook", eventId: row.event_id, claimKey: `webhook:${row.event_id}:${invocation.claimKey}`, context: { [row.event_slug]: context }, occurrence: { ...invocation.occurrence, metadata: { ...invocation.occurrence.metadata, eventId: row.event_id, mergeable: false } } });
        await finish(result.duplicate ? "duplicate" : "accepted", result.duplicate ? "Verified occurrence was already claimed." : "Merge-conflicted pull request queued through canonical trigger invocation.");
      } catch (error) {
        if (error instanceof InvocationError && error.code === "queue_full") { await finish("queue_full", "Trigger has no free execution slot and already has a waiting run; occurrence skipped."); continue; }
        const attempt = Number(row.attempt) + 1, detail = error instanceof Error ? error.message : "GitHub verification failed";
        if (attempt >= 8) await finish("verification_failed", detail); else await this.database.pool.query("UPDATE app.pending_verifications SET attempt=$3,next_attempt_at=now()+make_interval(secs=>least(60,5*$3)) WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, attempt]);
      }
    }
  }
}

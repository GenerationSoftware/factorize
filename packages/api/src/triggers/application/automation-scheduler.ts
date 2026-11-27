import { EnrichmentBudget } from "../../events/application/event-enrichment";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig } from "../domain/schedule";
import type { Env } from "../../types";
import type { Database } from "../../postgres/database";
import { githubHeaders, installationToken } from "../../github";
import { adaptWebhook, type WebhookEventConfig } from "../domain/webhook-trigger";
import { evaluateWebhookConditions } from "../domain/webhook-conditions";
import { EventMatchRepository } from "../../events/storage/event-match-repository";

/** Turns scheduled and verified provider input into durable event occurrences. */
export class AutomationScheduler {
  private enrichmentBudget = new EnrichmentBudget();
  constructor(private database: Database, private env: Env) {}
  async process(): Promise<void> { await this.githubVerifications(); await this.schedules(); }
  private async schedules() {
    for (let count = 0; count < 50; count++) {
      const due = await this.database.transaction(async client => {
        const row = (await client.query<any>(`SELECT s.tenant_id,s.event_id,s.trigger_id,s.next_run_at,t.slug,t.config,j.revision trigger_revision FROM app.schedule_state s JOIN app.events t ON t.tenant_id=s.tenant_id AND t.id=s.event_id JOIN app.triggers j ON j.tenant_id=s.tenant_id AND j.id=s.trigger_id WHERE s.next_run_at<=now() AND t.enabled AND t.removed_at IS NULL AND j.enabled ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 1`)).rows[0];
        if (!row) return null;
        const config = validateScheduleConfig(row.config), occurrence = catchUpOccurrence(config, row.next_run_at, new Date());
        if (!occurrence) return null;
        await client.query("UPDATE app.schedule_state SET last_fired_at=$3,next_run_at=$4 WHERE tenant_id=$1 AND event_id=$2", [row.tenant_id, row.event_id, occurrence.occurredAt, occurrence.nextRunAt]);
        return { ...row, occurrence };
      });
      if (!due) break;
      const occurredAt = due.occurrence.occurredAt.toISOString();
      await new EventMatchRepository(this.database, undefined, this.env, this.enrichmentBudget).match({ tenantId: due.tenant_id, triggerId: due.trigger_id, triggerRevision: due.trigger_revision ?? 1, sourceIdentity: `schedule:${due.event_id}`, deduplicationKey: occurredAt, evidence: { occurredAt, timezone: due.config.timezone }, decision: "matched", occurredAt });
    }
  }

  private async githubVerifications() {
    const pending = await this.database.pool.query<any>(`SELECT p.*,t.slug event_slug,t.config event_config,t.enabled event_enabled,t.removed_at,j.enabled trigger_enabled,j.revision trigger_revision,g.state installation_state FROM app.pending_verifications p JOIN app.events t ON t.tenant_id=p.tenant_id AND t.id=p.event_id JOIN app.triggers j ON j.tenant_id=p.tenant_id AND j.id=p.trigger_id LEFT JOIN app.github_installations g ON g.tenant_id=p.tenant_id AND g.installation_id=p.installation_id WHERE p.next_attempt_at<=now() ORDER BY p.next_attempt_at LIMIT 20`);
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
        const config = row.event_config as WebhookEventConfig, match = adaptWebhook(config, "github", row.delivery_id, row.payload, "pull_request");
        if (!match) { await finish("ignored", "Verified pull request no longer matches the Trigger."); continue; }
        let context: Record<string, unknown> = { ...match.payload, pull_request: { ...match.payload.pull_request as any, mergeable: false, mergeable_state: pull.mergeable_state } };
        const decision = await evaluateWebhookConditions(config.conditions, context);
        if (decision.decision !== "match") {
          await finish(decision.decision === "error" ? "conditions_error" : "excluded", decision.decision === "error" ? "Webhook conditions failed; no occurrence was recorded." : "Webhook conditions did not match; no occurrence was recorded.");
          continue;
        }
        const result = await new EventMatchRepository(this.database, undefined, this.env, this.enrichmentBudget).match({ tenantId: row.tenant_id, triggerId: row.trigger_id, triggerRevision: row.trigger_revision, sourceIdentity: `github:${row.event_id}:${match.deduplicationKey}`, deduplicationKey: match.deduplicationKey, evidence: context, decision: "matched" });
        await finish(result.duplicate ? "duplicate" : "accepted", result.duplicate ? "Verified occurrence was already recorded." : "Verified Event occurrence recorded.");
      } catch (error) {
        const attempt = Number(row.attempt) + 1, detail = error instanceof Error ? error.message : "GitHub verification failed";
        if (attempt >= 8) await finish("verification_failed", detail); else await this.database.pool.query("UPDATE app.pending_verifications SET attempt=$3,next_attempt_at=now()+make_interval(secs=>least(60,5*$3)) WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, attempt]);
      }
    }
  }
}

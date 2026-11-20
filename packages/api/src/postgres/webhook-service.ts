import { PostgresSkillContentCache } from "./skill-content-cache";
import { SkillContent } from "../skill-content";
import { clickUpJson, matchingClickUpTask } from "../clickup";
import { verifyTailDelivery, sanitizeTailEvent, suppressTailEvent } from "../cloudflare-tail";
import { decrypt, equalHmac, encrypt } from "../crypto";
import { InvocationError, InvocationService, type Trigger } from "../job-domain";
import { evaluateWebhookConditions } from "../webhook-conditions";
import type { Env } from "../types";
import { adaptWebhook, type WebhookProvider, type WebhookEventConfig } from "../webhook-trigger";
import { ConnectionRepository } from "./connection-repository";
import type { Database } from "./database";
import { PostgresTriggerRepository } from "./job-repository";

export class WebhookService {
  private connections: ConnectionRepository;
  private triggers: PostgresTriggerRepository;
  constructor(private database: Database, private env: Env, private tenantId: string) {
    this.connections = new ConnectionRepository(database, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
    this.triggers = new PostgresTriggerRepository(database, tenantId, value => encrypt(value, env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, env.CREDENTIAL_ENCRYPTION_KEY), new SkillContent(env.SKILL_ARTIFACTS,new PostgresSkillContentCache(database,tenantId,env.CREDENTIAL_ENCRYPTION_KEY)),env);
  }
  private async candidates(provider: WebhookProvider): Promise<Array<{ trigger: Trigger; eventId: string; eventSlug: string; config: WebhookEventConfig }>> {
    const rows = await this.database.pool.query<any>(`SELECT j.*,t.id event_id,t.slug event_slug,t.config event_config FROM app.triggers j JOIN app.events t ON t.tenant_id=j.tenant_id AND t.trigger_id=j.id WHERE j.tenant_id=$1 AND j.enabled AND t.enabled AND t.removed_at IS NULL AND t.kind='webhook' AND t.config->>'provider'=$2`, [this.tenantId, provider]);
    return rows.rows.map(row => ({ trigger: { id: row.id, name: row.name, slug: row.slug, prompt: "", runNameTemplate: "", model: row.model, effort: row.effort, executionConfig: row.execution_config, concurrencyLimit: row.concurrency_limit, enabled: row.enabled, events: [], createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }, eventId: row.event_id, eventSlug: row.event_slug, config: row.event_config }));
  }
  private async ensure(provider: string, deliveryId: string, type: unknown, action: unknown) {
    const id = crypto.randomUUID();
    const result = await this.database.pool.query<any>(`INSERT INTO app.webhook_deliveries(tenant_id,id,provider,delivery_id,event_type,event_action,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6,'received','Delivery received; processing is in progress.') ON CONFLICT (tenant_id,provider,delivery_id) DO UPDATE SET delivery_id=EXCLUDED.delivery_id RETURNING id`, [this.tenantId, id, provider, deliveryId, String(type || "unknown"), String(action || "unknown")]);
    return result.rows[0].id;
  }
  private async event(deliveryPk: string, triggerId: string, provider: string, deliveryId: string, outcome: string, detail: string) {
    await this.database.transaction(async client => {
      await client.query("INSERT INTO app.trigger_events(tenant_id,id,trigger_id,provider,delivery_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)", [this.tenantId, crypto.randomUUID(), triggerId, provider, deliveryId, outcome, detail]);
      await client.query("INSERT INTO app.webhook_delivery_events(tenant_id,id,delivery_id,trigger_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6)", [this.tenantId, crypto.randomUUID(), deliveryPk, triggerId, outcome, detail]);
      await client.query("UPDATE app.webhook_deliveries SET outcome=$4,detail=$5 WHERE tenant_id=$1 AND id=$2 AND delivery_id=$3", [this.tenantId, deliveryPk, deliveryId, outcome, detail]);
    });
  }
  private async invoke(provider: WebhookProvider, deliveryId: string, source: Record<string, any> | ((config: WebhookEventConfig) => Record<string, any>), eventName?: string) {
    const base = typeof source === "function" ? {} : source;
    const deliveryPk = await this.ensure(provider, deliveryId, eventName ?? base.type, base.action);
    for (const candidate of await this.candidates(provider)) {
      const payload = typeof source === "function" ? source(candidate.config) : source;
      const invocation = adaptWebhook(candidate.config, provider, deliveryId, payload, eventName);
      if (!invocation) { await this.event(deliveryPk, candidate.trigger.id, provider, deliveryId, "ignored", "Webhook did not match this trigger event."); continue; }
      let context: Record<string, unknown> = invocation.payload;
      const decision = await evaluateWebhookConditions(candidate.config.conditions, context);
      if (decision.decision !== "match") {
        await this.event(deliveryPk, candidate.trigger.id, provider, deliveryId, decision.decision === "error" ? "conditions_error" : "excluded", decision.decision === "error" ? "Webhook conditions failed; no run was created." : "Webhook conditions did not match; no run was created.");
        continue;
      }
      const service = new InvocationService(this.triggers, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
      try {
        const result = await service.invoke(candidate.trigger.id, { source: "webhook", eventId: candidate.eventId, claimKey: `webhook:${candidate.eventId}:${invocation.claimKey}`, context: { [candidate.eventSlug]: context }, occurrence: { ...invocation.occurrence, metadata: { ...invocation.occurrence?.metadata, eventId: candidate.eventId } } });
        await this.event(deliveryPk, candidate.trigger.id, provider, deliveryId, result.duplicate ? "duplicate" : "accepted", result.duplicate ? "Webhook occurrence was already claimed." : "Webhook occurrence queued through canonical trigger invocation.");
      } catch (error) {
        if(error instanceof InvocationError && error.code==="trigger_disabled"){await this.event(deliveryPk,candidate.trigger.id,provider,deliveryId,"ignored","Skill is disabled; occurrence skipped.");continue;}
        if (!(error instanceof InvocationError) || error.code !== "queue_full") throw error;
        await this.event(deliveryPk, candidate.trigger.id, provider, deliveryId, "queue_full", "Trigger has no free execution slot and already has a waiting run; occurrence skipped.");
      }
    }
    await this.database.pool.query("UPDATE app.webhook_deliveries SET outcome='ignored',detail='Delivery was received but did not match an enabled event.' WHERE tenant_id=$1 AND id=$2 AND outcome='received'", [this.tenantId, deliveryPk]);
    await this.wake();
  }
  private async wake() { if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" }); }
  async linear(inputEvent: Record<string, any>, deliveryId: string) { await this.invoke("linear", deliveryId, inputEvent); }
  async clickup(raw: string, signature: string) {
    const connection = await this.connections.get<any>("clickup");
    if (!connection || !signature || !await equalHmac(raw, signature, connection.webhookSecret)) throw new Error("invalid_signature");
    const inputEvent = JSON.parse(raw); if (!inputEvent.task_id || String(inputEvent.webhook_id) !== connection.webhookId) return;
    const relevant = inputEvent.event === "taskCreated" || ["taskStatusUpdated", "taskAssigneeUpdated", "taskTagUpdated", "taskMoved"].includes(String(inputEvent.event)) || (inputEvent.event === "taskUpdated" && (inputEvent.history_items ?? []).some((item: any) => ["status", "assignee", "tags", "list_id", "creator"].includes(String(item.field))));
    if (!relevant) return;
    const task = await clickUpJson(connection.accessToken, `/task/${encodeURIComponent(String(inputEvent.task_id))}`), deliveryId = `clickup:${inputEvent.webhook_id}:${inputEvent.event}:${inputEvent.history_items?.[0]?.date ?? inputEvent.task_id}`;
    await this.invoke("clickup", deliveryId, config => ({ ...inputEvent, task, matches: matchingClickUpTask(task, String(config.listId), config.matchRules ?? []) }), inputEvent.event);
  }
  async github(inputEvent: Record<string, any>, deliveryId: string, eventName: string) {
    if (eventName !== "pull_request" || inputEvent.action !== "dequeued") { await this.invoke("github", deliveryId, inputEvent, eventName); return; }
    const deliveryPk = await this.ensure("github", deliveryId, eventName, inputEvent.action), installationId = inputEvent.installation?.id, repositoryId = inputEvent.repository?.id, pull = inputEvent.pull_request;
    if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || !Number.isSafeInteger(pull?.number)) return;
    let matched = false;
    for (const candidate of await this.candidates("github")) {
      if (!adaptWebhook(candidate.config, "github", deliveryId, inputEvent, eventName) || pull.state !== "open" || pull.base?.ref !== "main") continue;
      matched = true;
      await this.database.pool.query(`INSERT INTO app.pending_verifications(tenant_id,id,trigger_id,event_id,delivery_id,installation_id,repository_id,repository_owner,repository_name,pull_number,next_attempt_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)`, [this.tenantId, crypto.randomUUID(), candidate.trigger.id, candidate.eventId, deliveryId, installationId, repositoryId, inputEvent.repository.owner?.login ?? "", inputEvent.repository.name ?? "", pull.number, inputEvent]);
      await this.event(deliveryPk, candidate.trigger.id, "github", deliveryId, "candidate", "Candidate received; waiting for GitHub mergeability verification.");
    }
    if (!matched) await this.database.pool.query("UPDATE app.webhook_deliveries SET outcome='ignored',detail='Delivery was received but did not match an enabled event.' WHERE tenant_id=$1 AND id=$2", [this.tenantId, deliveryPk]);
    await this.wake();
  }
  async tail(triggerId: string, raw: string, headers: Headers) {
    const candidate = (await this.candidates("cloudflareTail")).find(value => value.trigger.id === triggerId); if (!candidate?.config.integrationId) throw new Error("not_found");
    const connection = await this.connections.get<any>(`cloudflare-tail:${candidate.config.integrationId}`), timestamp = headers.get("x-factorize-timestamp") ?? "", delivery = headers.get("x-factorize-delivery") ?? "", signature = headers.get("x-factorize-signature") ?? "";
    if (!connection?.signingSecret || await verifyTailDelivery(connection.signingSecret, timestamp, delivery, raw, signature) !== "valid") throw new Error("invalid_signature");
    const payload = sanitizeTailEvent(JSON.parse(raw)) as Record<string, any>; if (!suppressTailEvent(payload)) await this.invoke("cloudflareTail", delivery, payload, "tail");
  }
}

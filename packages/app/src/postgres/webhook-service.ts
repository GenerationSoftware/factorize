import { clickUpJson, matchingClickUpTask } from "../clickup";
import { verifyTailDelivery, sanitizeTailEvent, suppressTailEvent } from "../cloudflare-tail";
import { decrypt, equalHmac, encrypt } from "../crypto";
import { InvocationService, type Job } from "../job-domain";
import type { Env } from "../types";
import { adaptWebhook, type WebhookProvider, type WebhookTriggerConfig } from "../webhook-trigger";
import { ConnectionRepository } from "./connection-repository";
import type { Database } from "./database";
import { PostgresJobRepository } from "./job-repository";

export class WebhookService {
  private connections: ConnectionRepository;
  private jobs: PostgresJobRepository;
  constructor(private database: Database, private env: Env, private tenantId: string) {
    this.connections = new ConnectionRepository(database, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
    this.jobs = new PostgresJobRepository(database, tenantId, value => encrypt(value, env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, env.CREDENTIAL_ENCRYPTION_KEY));
  }
  private async candidates(provider: WebhookProvider): Promise<Array<{ job: Job; triggerId: string; triggerSlug: string; config: WebhookTriggerConfig }>> {
    const rows = await this.database.pool.query<any>(`SELECT j.*,t.id trigger_id,t.slug trigger_slug,t.config trigger_config FROM app.jobs j JOIN app.triggers t ON t.tenant_id=j.tenant_id AND t.job_id=j.id WHERE j.tenant_id=$1 AND j.enabled AND t.enabled AND t.kind='webhook' AND t.config->>'provider'=$2`, [this.tenantId, provider]);
    return rows.rows.map(row => ({ job: { id: row.id, name: row.name, slug: row.slug, promptTemplate: "", runNameTemplate: "", model: row.model, effort: row.effort, executionTarget: row.execution_target, concurrencyLimit: row.concurrency_limit, enabled: row.enabled, triggers: [], createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }, triggerId: row.trigger_id, triggerSlug: row.trigger_slug, config: row.trigger_config }));
  }
  private async ensure(provider: string, deliveryId: string, type: unknown, action: unknown) {
    const id = crypto.randomUUID();
    const result = await this.database.pool.query<any>(`INSERT INTO app.webhook_deliveries(tenant_id,id,provider,delivery_id,event_type,event_action,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6,'received','Delivery received; processing is in progress.') ON CONFLICT (tenant_id,provider,delivery_id) DO NOTHING RETURNING id`, [this.tenantId, id, provider, deliveryId, String(type || "unknown"), String(action || "unknown")]);
    return result.rows[0]?.id ?? (await this.database.pool.query<any>("SELECT id FROM app.webhook_deliveries WHERE tenant_id=$1 AND provider=$2 AND delivery_id=$3", [this.tenantId, provider, deliveryId])).rows[0].id;
  }
  private async event(deliveryPk: string, jobId: string, provider: string, deliveryId: string, outcome: string, detail: string) {
    await this.database.pool.query("INSERT INTO app.job_events(tenant_id,id,job_id,provider,delivery_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)", [this.tenantId, crypto.randomUUID(), jobId, provider, deliveryId, outcome, detail]);
    await this.database.pool.query("INSERT INTO app.webhook_delivery_events(tenant_id,id,delivery_id,job_id,outcome,detail) VALUES ($1,$2,$3,$4,$5,$6)", [this.tenantId, crypto.randomUUID(), deliveryPk, jobId, outcome, detail]);
    await this.database.pool.query("UPDATE app.webhook_deliveries SET outcome=$4,detail=$5 WHERE tenant_id=$1 AND id=$2 AND delivery_id=$3", [this.tenantId, deliveryPk, deliveryId, outcome, detail]);
  }
  private async invoke(provider: WebhookProvider, deliveryId: string, payload: Record<string, any>, eventName?: string) {
    const deliveryPk = await this.ensure(provider, deliveryId, eventName ?? payload.type, payload.action);
    for (const candidate of await this.candidates(provider)) {
      const invocation = adaptWebhook(candidate.config, provider, deliveryId, payload, eventName);
      if (!invocation) { await this.event(deliveryPk, candidate.job.id, provider, deliveryId, "ignored", "Webhook did not match this job trigger."); continue; }
      const service = new InvocationService(this.jobs, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
      const result = await service.invoke(candidate.job.id, { source: "webhook", triggerId: candidate.triggerId, claimKey: `webhook:${candidate.triggerId}:${invocation.claimKey}`, context: { [candidate.triggerSlug]: invocation.payload }, occurrence: { ...invocation.occurrence, metadata: { ...invocation.occurrence?.metadata, triggerId: candidate.triggerId } } });
      await this.event(deliveryPk, candidate.job.id, provider, deliveryId, result.duplicate ? "duplicate" : "accepted", result.duplicate ? "Webhook occurrence was already claimed." : "Webhook occurrence queued through canonical job invocation.");
    }
    await this.database.pool.query("UPDATE app.webhook_deliveries SET outcome='ignored',detail='Delivery was received but did not match an enabled trigger.' WHERE tenant_id=$1 AND id=$2 AND outcome='received'", [this.tenantId, deliveryPk]);
    await this.wake();
  }
  private async wake() { if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" }); }
  async linear(event: Record<string, any>, deliveryId: string) { await this.invoke("linear", deliveryId, event); }
  async clickup(raw: string, signature: string) {
    const connection = await this.connections.get<any>("clickup");
    if (!connection || !signature || !await equalHmac(raw, signature, connection.webhookSecret)) throw new Error("invalid_signature");
    const event = JSON.parse(raw); if (!event.task_id || String(event.webhook_id) !== connection.webhookId) return;
    const relevant = event.event === "taskCreated" || ["taskStatusUpdated", "taskAssigneeUpdated", "taskTagUpdated", "taskMoved"].includes(String(event.event)) || (event.event === "taskUpdated" && (event.history_items ?? []).some((item: any) => ["status", "assignee", "tags", "list_id", "creator"].includes(String(item.field))));
    if (!relevant) return;
    const task = await clickUpJson(connection.accessToken, `/task/${encodeURIComponent(String(event.task_id))}`), deliveryId = `clickup:${event.webhook_id}:${event.event}:${event.history_items?.[0]?.date ?? event.task_id}`;
    for (const candidate of await this.candidates("clickup")) { const payload = { ...event, task, matches: matchingClickUpTask(task, String(candidate.config.listId), candidate.config.matchRules ?? []) }; await this.invoke("clickup", deliveryId, payload, event.event); break; }
  }
  async github(event: Record<string, any>, deliveryId: string, eventName: string) { await this.invoke("github", deliveryId, event, eventName); }
  async tail(jobId: string, raw: string, headers: Headers) {
    const candidate = (await this.candidates("cloudflareTail")).find(value => value.job.id === jobId); if (!candidate?.config.integrationId) throw new Error("not_found");
    const connection = await this.connections.get<any>(`cloudflare-tail:${candidate.config.integrationId}`), timestamp = headers.get("x-factorize-timestamp") ?? "", delivery = headers.get("x-factorize-delivery") ?? "", signature = headers.get("x-factorize-signature") ?? "";
    if (!connection?.signingSecret || await verifyTailDelivery(connection.signingSecret, timestamp, delivery, raw, signature) !== "valid") throw new Error("invalid_signature");
    const payload = sanitizeTailEvent(JSON.parse(raw)) as Record<string, any>; if (!suppressTailEvent(payload)) await this.invoke("cloudflareTail", delivery, payload, "tail");
  }
}

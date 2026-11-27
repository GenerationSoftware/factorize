import type { Env, OAuthProps } from "../../types";
import type { AGENT_SCOPES } from "../../access-tokens";
import { authorizeEnrichment } from "../../events/application/event-enrichment";

import { eventContextCatalog } from "../domain/trigger-context";

import { type TriggerInput, type FireTriggerInput, triggerConditionsTestSchema } from "../api/trigger-schemas";
import { nextOccurrence, validateScheduleConfig } from "../domain/schedule";
import { databaseFor } from "../../postgres/database";

import { triggerResponse } from "../api/trigger-contracts";
import { PostgresTriggerRepository, StaleTriggerEdit } from "../storage/trigger-repository";
import { ConnectionRepository } from "../../postgres/connection-repository";

import { decrypt, encrypt } from "../../crypto";
import { type Trigger, type TriggerSource } from "../domain/trigger-domain";
import { GitHubRepository } from "../../postgres/github-repository";

import { OperationsRepository } from "../../postgres/operations-repository";
import { installedEventAvailability } from "../domain/trigger-availability";
import { evaluateWebhookConditions } from "../domain/webhook-conditions";

import { EventMatchRepository, wakeMcpDeliveries } from "../../events/storage/event-match-repository";
import { EventDefinitionRepository } from "../../events/storage/event-definition-repository";

import { ServiceError, publicValue } from "../../service-contract";

export class TriggersService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}
  private eventDefinitions() { return new EventDefinitionRepository(databaseFor(this.env), this.auth.tenantId); }
  private connections() { return new ConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private triggers() { return new PostgresTriggerRepository(databaseFor(this.env), this.auth.tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }

  private normalizedSources(input: TriggerInput["sources"], existing: TriggerSource[] = []): TriggerSource[] {
    const sources = input.some(source => source.kind === "manual") ? input : [{ kind: "manual" as const, enabled: true, config: {} }, ...input];
    const prior = new Map(existing.map(source => [source.id, source])), used = new Set(existing.map(source => source.slug));
    let next = 1, timestamp = new Date().toISOString();
    return sources.map(source => {
      // A source's kind is part of its identity. Changing kind is a removal
      // plus an insertion, never an in-place mutation of historical identity.
      const candidate = source.id ? prior.get(source.id) : undefined;
      const old = candidate?.kind === source.kind ? candidate : undefined;
      if (source.kind === "webhook" && source.config.provider === "cloudflareTail") {
        if (!old || old.config.provider !== "cloudflareTail" || old.config.integrationId !== source.config.integrationId) {
          throw new ServiceError(400, "invalid_request", "Cloudflare Tail is retired. Remove this source or choose a different provider.");
        }
        // Retain historical configuration unchanged when editing other fields.
        return { ...old, enabled: false };
      }
      while (used.has(`source-${next}`)) next++;
      const slug = old?.slug ?? source.slug ?? `source-${next++}`; used.add(slug);
      return { id: old?.id ?? crypto.randomUUID(), triggerId: old?.triggerId ?? "", kind: source.kind, slug, enabled: source.enabled !== false, config: source.config, template:source.template, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp };
    });
  }

  private async presentTrigger(trigger: Trigger) {
    return publicValue(triggerResponse, { ...trigger, eventId: trigger.eventId ?? null, sources: trigger.sources.map(source => ({ ...source, enabled: source.kind === "webhook" && source.config.provider === "cloudflareTail" ? false : source.enabled, config: source.kind === "webhook" ? { ...source.config, ...(source.config.signingSecret || source.config.secret ? { secretConfigured: true } : {}) } : source.config })) });
  }

  private async wakeScheduler() {
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
  }

  async eventContextMetadata() { await this.authorize("triggers:read"); return eventContextCatalog; }

  async listTriggers() { await this.authorize("triggers:read"); return Promise.all((await this.triggers().list()).map(trigger => this.presentTrigger(trigger))); }

  async getTrigger(triggerId: string) { await this.authorize("triggers:read"); const trigger = await this.triggers().getTrigger(triggerId); if (!trigger) throw new ServiceError(404, "not_found", "Trigger not found"); return this.presentTrigger(trigger); }

  async listTriggerEvents(triggerId: string, limit = 50) { await this.authorize("triggers:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).triggerEvents(triggerId, limit); }

  async listWebhookDeliveries(query: URLSearchParams) { await this.authorize("triggers:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).deliveries(query); }

  async getWebhookDelivery(deliveryId: string) { await this.authorize("triggers:read"); const value = await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).delivery(deliveryId); if (!value) throw new ServiceError(404,"not_found","Webhook delivery not found"); return value; }

  async testTriggerConditions(input: unknown) { await this.authorize("triggers:write"); const parsed = triggerConditionsTestSchema.parse(input); return evaluateWebhookConditions(parsed.conditions, parsed.webhook); }

  async createTrigger(request: TriggerInput) {
    await this.authorize("triggers:write");
    const event = await this.eventDefinitions().get(request.eventId);
    if (!event) throw new ServiceError(404, "not_found", "Event not found");
    if (event.enrichment) await authorizeEnrichment(this.env, this.auth, event.enrichment);
    const id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const sources = this.normalizedSources(request.sources).map(source => ({ ...source, triggerId: id }));
    const trigger: Trigger = { id, eventId: request.eventId, name: request.name, description: "", slug: request.name, revision: 1, enabled: true, sources, ...(request.inputMapping ? {inputMapping: request.inputMapping} : {}), createdAt: timestamp, updatedAt: timestamp };
    try { const saved = await this.triggers().create(trigger); await this.wakeScheduler(); return this.presentTrigger(saved); }
    catch (error: any) { if ((error?.code ?? error?.cause?.code) === "23505") throw new ServiceError(409, "conflict", "Trigger name is already in use"); throw error; }
  }

  async updateTrigger(triggerId: string, request: TriggerInput & { expectedUpdatedAt?: string }) {
    await this.authorize("triggers:write");
    const repository = this.triggers(), current = await repository.getTrigger(triggerId);
    if (!current) throw new ServiceError(404, "not_found", "Trigger not found");
    const eventId = request.eventId;
    const event = await this.eventDefinitions().get(eventId);
    if (!event) throw new ServiceError(404, "not_found", "Event not found");
    if (event.enrichment) await authorizeEnrichment(this.env, this.auth, event.enrichment);
    const sources = this.normalizedSources(request.sources, current.sources).map(source => ({ ...source, triggerId }));
    try { const saved = await repository.update({ ...current, eventId, name: request.name, slug: request.name, sources, inputMapping: request.inputMapping === null ? undefined : request.inputMapping ?? current.inputMapping, updatedAt: new Date().toISOString() }, request.expectedUpdatedAt); await this.wakeScheduler(); return this.presentTrigger(saved); }
    catch (error) { if ((error as any)?.code === "23505") throw new ServiceError(409, "conflict", "Trigger name is already in use"); if (error instanceof StaleTriggerEdit) throw new ServiceError(409, "stale_trigger", "This Trigger changed. Reload it before saving."); throw error; }
  }

  async deleteTrigger(triggerId: string) {
    await this.authorize("triggers:write");
    if (!(await this.triggers().delete(triggerId))) throw new ServiceError(404, "not_found", "Trigger not found");
    return { id: triggerId, deleted: true };
  }

  async setTriggerEnabled(triggerId: string, enabled: boolean) { await this.authorize("triggers:write"); if (!await this.triggers().setEnabled(triggerId, enabled, new Date().toISOString())) throw new ServiceError(404, "not_found", "Trigger not found"); await this.wakeScheduler(); return { id: triggerId, enabled }; }

  async fireTrigger(triggerId: string, input: FireTriggerInput) {
    await this.authorize("triggers:write"); const trigger = await this.triggers().getTrigger(triggerId); if (!trigger) throw new ServiceError(404, "not_found", "Trigger not found");
    const source = trigger.sources.find(value => value.kind === "manual" && value.enabled); if (!source) throw new ServiceError(409, "operation_failed", "The manual Trigger source is disabled");
    const deduplicationKey = input.idempotencyKey ?? crypto.randomUUID();
    const result = await new EventMatchRepository(databaseFor(this.env), () => wakeMcpDeliveries(this.env), this.env).match({ tenantId: this.auth.tenantId, triggerId, triggerRevision: trigger.revision, sourceIdentity: `manual:${source.id}`, deduplicationKey, evidence: input.data ?? {}, decision: "matched" });
    return { occurrenceId: result.occurrence?.id ?? null, duplicate: result.duplicate, ...(result.evaluationId ? {evaluationId:result.evaluationId} : {}) };
  }

  async listTriggerEventAvailability() { await this.authorize("triggers:read"); const [kinds, installations] = await Promise.all([this.connections().kinds(), new GitHubRepository(databaseFor(this.env),this.auth.tenantId).installations()]), states=installations.map((x:any)=>x.state); return installedEventAvailability(kinds.includes("linear"),kinds.includes("clickup"),states); }

  async previewSchedule(input: unknown) {
    await this.authorize("triggers:read");
    try {
      const config = validateScheduleConfig(input);
      return { nextRunAt: nextOccurrence(config, new Date()).toISOString() };
    } catch (error) {
      throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid schedule");
    }
  }
}

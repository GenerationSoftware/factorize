import { IntegrationRemoval } from "./postgres/integration-removal";
import { lockIntegrationTopology } from "./postgres/integration-removal-topology";
import { integrationRemovalConfirmation, integrationRemovalTarget } from "./integration-removal-contracts";
import { authorizeEnrichment } from "./event-enrichment";
import { enrichmentRun } from "./event-enrichment-contracts";
import { readOccurrenceSummaries } from "./postgres/occurrence-summary-repository";
import { eventOccurrenceSummaryPage, subscriptionOccurrenceSummaryPage, parseOccurrenceSummaryCursor } from "./event-contracts";
import { cloudflareState, startCloudflare } from "./cloudflare-oauth";
import { integrationForScope, lockOAuthPolicy } from "./oauth-reconnect";
import { installationScopes, listLegacyOAuthGrants, listOAuthInstallations, materializeLegacyOAuthInstallation } from "./oauth-installations";
import { deleteMcpGrantSubscriptions, lockMcpEventGrant } from "./postgres/mcp-event-outbox";
import { eventPayloadSchema, occurrenceEventName, occurrenceInputSchema, type ReadEventOccurrencesInput, type subscribeEventInput, type unsubscribeEventInput, type setProcessingAcknowledgmentsInput, type acknowledgeEventsInput } from "./mcp-event-contracts";
import { subscribeMcpEvent, unsubscribeMcpEvent, getProcessingAcknowledgments, setProcessingAcknowledgments, acknowledgeEvents, replayUnacknowledgedEvents } from "./mcp-event-subscriptions";
import { vmGrantInput, vmGrantList, vmGrantResult, vmRevokeResult } from "./vm-grant-contracts";
import { VmGrantRepository, vmGrantActor, type VmGrant } from "./postgres/vm-grant-repository";
import { provisionVmGrant } from "./vm-enrollment";
import { vmGrantAudience } from "./vm-grant-provider";
import { writeVmPermissionSnapshot } from "./vm-permissions";
import { activeVmAuthorization } from "./vm-auth";
import { BuiltinSkillError, builtinSkillDocuments, builtinSkillEntry, builtinSkill, builtinSkillResource } from "./builtin-skills";
import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import { TeamRepository } from "./postgres/team-repository";
import type { DatabaseClient } from "./postgres/database";

import { decideOidcConsent, inspectOidcConsent, oidcConsentInput, oidcConsentPreview } from "./oidc-provider";
import { AppsRepository } from "./postgres/apps-repository";
import { appRegistrationInput, appRegistrationUpdate, appSecret, connectedApp, registeredApp } from "./apps-contracts";
import { AgentApiError, AgentApiService, listAgentPolicies } from "./agent-api";
import {ProxyPayloads,createPayloadInput,appendPayloadInput,finalizePayloadInput,attachmentInput} from "./proxy-payloads";
import {ProxyOperations,operationRef,operationRead} from "./proxy-operations";
import {queryApiResponseInput} from "./agent-api-contracts";
import { apiPolicyInput, integrationRef, requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { integrationStatus, exeConnection, accessToken, createdAccessToken, clientPermissionsUpdate, clientNameInput, authorizedClient } from "./settings-contracts";
import { namedOption, providerOptions, githubRepository, githubInstallation, tailIntegration } from "./editor-contracts";
import { z } from "zod";
import { teamPermissionList, teamPermissionUpdate } from "./settings-contracts";
import { permissionKey, standardPermissions, teamPermissionPreferences } from "./team-permission-defaults";
import { eventContextCatalog } from "./trigger-context";
import type { Env, OAuthProps } from "./types";
import { type TriggerInput, type FireTriggerInput, triggerConditionsTestSchema } from "./trigger-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./postgres/access-token-repository";
import { triggerResponse } from "./trigger-contracts";
import { PostgresTriggerRepository, StaleTriggerEdit } from "./postgres/trigger-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { CredentialRepository, IntegrationIdempotencyConflictError, IntegrationValidationError, StaleIntegrationRevisionError } from "./postgres/credential-repository";
import { XConnectionRepository } from "./postgres/x-connection-repository";
import { createXPKCE, signXOAuthState, validateXOAuthScopes, type XOAuthScope } from "./x-oauth";
import { decrypt, encrypt } from "./crypto";
import { type Trigger, type TriggerSource } from "./trigger-domain";
import { GitHubRepository } from "./postgres/github-repository";
import { IntegrationService } from "./postgres/integration-service";
import { OperationsRepository } from "./postgres/operations-repository";
import { installedEventAvailability } from "./trigger-availability";
import { evaluateWebhookConditions } from "./webhook-conditions";

import { ProviderCatalog } from "./postgres/provider-catalog";
import { ACCESS_SCOPES, AGENT_SCOPES, accessTokenDigest, issueAccessToken, normalizeScopes } from "./access-tokens";

import { EventMatchRepository, wakeMcpDeliveries } from "./postgres/event-match-repository";
import { EventDefinitionRepository, EventDefinitionConflict } from "./postgres/event-definition-repository";
import { readEventSubscriptions } from "./postgres/event-subscription-repository";
import { eventSubscription, eventSubscriptionList, parseOccurrenceCursor, eventDefinitionInput, eventDefinitionUpdate, eventDefinitionResponse, eventDefinitionList, eventOccurrencePage } from "./event-contracts";
import { createFlyAccountClient, FlyAccountError, flyConnectionInput } from "./fly-account-client";
import { FlyConnectionRepository } from "./postgres/fly-connection-repository";



export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Response validation failures are server defects, never malformed client input. */
export function publicValue<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(JSON.stringify({ event: "public_contract_failure", issues: result.error.issues.map(issue => ({ path: issue.path, code: issue.code })) }));
    throw new ServiceError(500, "internal_error", "Factorize returned an invalid resource.");
  }
  return result.data;
}

type Scope = (typeof AGENT_SCOPES)[number];

export class ApiService {
  authorizationDuration = 0;
  constructor(private env: Env, private auth: OAuthProps, private ctx?: ExecutionContext) {}

  private handleFlyAccountError(error: unknown): never {
    if (!(error instanceof FlyAccountError)) throw error;
    throw new ServiceError(error.kind === "auth" ? 401 : error.kind === "organization" ? 403 : 502, "fly_account_error", error.message);
  }

  private triggers() { return new PostgresTriggerRepository(databaseFor(this.env), this.auth.tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }
  private connections() { return new ConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private flyConnections() { return new FlyConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }

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
  async mcpListSkills(cursor?:string) {
    await this.authorizeIdentity();
    if(cursor)throw new BuiltinSkillError("The built-in catalog has no further pages.");
    return {resultType:"complete" as const,skills:builtinSkillDocuments.map(builtinSkillEntry),ttlMs:3_600_000,cacheScope:"private" as const};
  }
  async mcpGetSkill(uri:string) {
    await this.authorizeIdentity();
    return {resultType:"complete" as const,skill:builtinSkillEntry(builtinSkill(uri)),ttlMs:3_600_000,cacheScope:"private" as const};
  }
  async mcpReadSkill(uri:string) {
    await this.authorizeIdentity();
    return {contents:[builtinSkillResource(uri)],ttlMs:3_600_000,cacheScope:"private" as const};
  }

  private async authorize(scope: Scope): Promise<void> {
    if (this.auth.authMethod === "vm") {
      const current = await this.authorizeVmIdentity();
      if (!current.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
      return;
    }
    if (!(this.auth.oauthGrantId ? this.auth.scopes : normalizeScopes(this.auth.scopes)).includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    await this.authorizeIdentity();
  }
  private async authorizeVmIdentity() {
    const current = await activeVmAuthorization(this.env, this.auth);
    if (!current) throw new ServiceError(401, "invalid_token", "The VM authorization is no longer active.");
    return current;
  }
  private async authorizeIdentity(): Promise<void> {
    if (this.auth.authMethod === "vm") {
      await this.authorizeVmIdentity();
      return;
    }
    const started = performance.now();
    try {
      const database = databaseFor(this.env);
      const member = await new IdentityRepository(database, this.auth.tenantId).member(this.auth.userId);
      const tokenActive = !this.auth.accessTokenId || await new AccessTokenRepository(database, this.auth.tenantId).active(this.auth.accessTokenId);
      if (member?.role !== "owner" || member.sessionVersion !== this.auth.sessionVersion || !tokenActive) throw new ServiceError(401, "invalid_token", "The request is not authorized.");
    } finally { this.authorizationDuration += performance.now() - started; }
  }
  private async authorizeOwnerSession(scope: Scope): Promise<void> { await this.authorize(scope); if (this.auth.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required."); }

  agentApi() { return new AgentApiService(this.env, this.auth); }
  async getApiReflection() { return this.agentApi().reflection(); }
  async createProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).create(createPayloadInput.parse(input));}
  async getProxyPayload(id:string){return new ProxyPayloads(this.env,this.auth).get(id);}
  async uploadProxyPayload(id:string,request:Request){return new ProxyPayloads(this.env,this.auth).upload(id,request);}
  async appendProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).append(appendPayloadInput.parse(input));}
  async finalizeProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).finalize(finalizePayloadInput.parse(input));}
  async importProxyAttachment(input:unknown){return new ProxyPayloads(this.env,this.auth).importAttachment(attachmentInput.parse(input));}
  async fetchProxyPayload(input:{integration:string;path:string;name?:string;mediaType?:string}){return new ProxyPayloads(this.env,this.auth).importIntegration(input);}
  async requestApiMcp(input:unknown,signal?:AbortSignal){
    const parsed=requestApiInput.parse(input);
    return parsed.execution==="async" || parsed.execution!=="sync" && this.auth.authMethod==="oauth" ? this.startApiOperation(parsed) : this.requestApi(parsed,signal);
  }
  async startApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).start(requestApiInput.parse(input));}
  async getApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).get(operationRef.parse(input).operationId);}
  async cancelApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).cancel(operationRef.parse(input).operationId);}
  async readApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).read(operationRead.parse(input));}
  async requestApi(input: unknown, signal?: AbortSignal) { return this.agentApi().request(requestApiInput.parse(input), signal); }
  async queryApiResponse(input:unknown){return this.agentApi().query(queryApiResponseInput.parse(input));}
  async readApiResponse(input: unknown) { return this.agentApi().read(readApiResponseInput.parse(input)); }
  async listApiPolicies() { await this.authorizeOwnerSession("integrations:read"); return listAgentPolicies(this.env, this.auth.tenantId); }
  async updateApiPolicy(id: string, input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    integrationRef.parse(id); const parsed = apiPolicyInput.parse(input);
    const updated = await databaseFor(this.env).pool.query("UPDATE app.agent_integrations SET policy=$3 WHERE tenant_id=$1 AND id=$2 AND revision=$4 RETURNING id", [this.auth.tenantId,id,parsed.policy,parsed.expectedRevision]);
    if (!updated.rowCount) throw new ServiceError(409,"stale_policy","Integration policy changed or is unavailable. Reload before updating.");
    return this.listApiPolicies();
  }


  async listExeConnections() { await this.authorize("integrations:read"); return publicValue(z.array(exeConnection), (await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).status()).exeConnections); }
  async getFlyConnection() { await this.authorizeOwnerSession("integrations:read"); return { connection: await this.flyConnections().get() }; }
  async validateFlyConnection(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    const parsed = flyConnectionInput.parse(input);
    try { return { valid: true, connection: await createFlyAccountClient().validate(parsed.token, parsed.organizationSlug) }; }
    catch (error) { this.handleFlyAccountError(error); }
  }
  async saveFlyConnection(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    const parsed = flyConnectionInput.parse(input);
    try {
      const metadata = await createFlyAccountClient().validate(parsed.token, parsed.organizationSlug);
      return { connection: await this.flyConnections().save(metadata, parsed.token) };
    } catch (error) { this.handleFlyAccountError(error); }
  }
  async removeFlyConnection() {
    await this.authorizeOwnerSession("integrations:write");
    try { return {deleted:(await this.removal().confirm({kind:"fly",id:"fly"})).deleted}; }
    catch (error) { if (error instanceof AgentApiError && error.status===404) return {deleted:false}; throw error; }
  }
  async listGitHubInstallations() { await this.authorize("integrations:read"); return publicValue(z.array(githubInstallation), JSON.parse(JSON.stringify(await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).installations()))); }
  async listTailIntegrations() { await this.authorize("integrations:read"); return publicValue(z.array(tailIntegration), await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).tails()); }
  async eventContextMetadata() { await this.authorize("triggers:read"); return eventContextCatalog; }
  private eventDefinitions() { return new EventDefinitionRepository(databaseFor(this.env), this.auth.tenantId); }
  async listEvents() { await this.authorize("triggers:read"); return publicValue(eventDefinitionList, await this.eventDefinitions().list()); }
  async listDashboardEventSubscriptions() {
    await this.authorizeOwnerSession("triggers:read");
    return publicValue(eventSubscriptionList, await readEventSubscriptions(databaseFor(this.env), this.auth.tenantId, this.auth.userId));
  }
  async getDashboardEventSubscription(id: string) {
    await this.authorizeOwnerSession("triggers:read");
    const [result] = await readEventSubscriptions(databaseFor(this.env), this.auth.tenantId, this.auth.userId, id);
    if (!result) throw new ServiceError(404, "not_found", "Event subscription not found");
    return publicValue(eventSubscription, result);
  }
  async getEvent(id: string) { await this.authorize("triggers:read"); const event = await this.eventDefinitions().get(id); if (!event) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, event); }
  async createEvent(input: unknown) { await this.authorize("triggers:write"); const parsed = eventDefinitionInput.parse(input); return publicValue(eventDefinitionResponse, await this.eventDefinitions().create({ ...parsed, evaluatorAuthority: parsed.enrichment ? await authorizeEnrichment(this.env,this.auth,parsed.enrichment) : undefined })); }
  async updateEvent(id: string, input: unknown) { await this.authorize("triggers:write"); const parsed = eventDefinitionUpdate.parse(input); try { const result = await this.eventDefinitions().update(id, { ...parsed, evaluatorAuthority: parsed.enrichment ? await authorizeEnrichment(this.env,this.auth,parsed.enrichment) : undefined }, parsed.expectedRevision); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, result); } catch (error) { if (error instanceof EventDefinitionConflict) throw new ServiceError(409, "stale_event", "Event changed since it was loaded."); throw error; } }
  async listEnrichmentRuns(id: string) {
    await this.authorize("triggers:read");
    if (!await this.eventDefinitions().get(id)) throw new ServiceError(404,"not_found","Event not found");
    const { rows } = await databaseFor(this.env).pool.query<{id:string;trigger_id:string;created_at:Date;state:string;stage:string|null;reason:string|null;steps:unknown;normalized_input:unknown}>(
      `SELECT id,trigger_id,created_at,steps,normalized_input,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'failed' ELSE state END AS state,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'evaluation' ELSE stage END AS stage,
         CASE WHEN state='running' AND created_at<now()-interval '30 seconds' THEN 'interrupted_no_retry' ELSE reason END AS reason
       FROM app.event_enrichment_runs
       WHERE tenant_id=$1 AND definition_id=$2 ORDER BY created_at DESC,id LIMIT 50`,[this.auth.tenantId,id]);
    return publicValue(z.array(enrichmentRun),rows.map(row=>({id:row.id,triggerId:row.trigger_id,createdAt:row.created_at.toISOString(),
      state:row.state,stage:row.stage,reason:row.reason,steps:row.steps,input:row.normalized_input})));
  }
  async deleteEvent(id: string) { await this.authorize("triggers:write"); if (!await this.eventDefinitions().delete(id)) throw new ServiceError(404, "not_found", "Event not found"); return { id, deleted: true as const }; }
  private occurrenceSummaryBoundary(id: string, cursor?: string) {
    if (cursor === undefined) return undefined;
    const boundary = parseOccurrenceSummaryCursor(cursor, id);
    if (!boundary) throw new ServiceError(400, "invalid_request", "Cursor does not match this occurrence history.");
    return boundary;
  }
  async listEventOccurrenceSummaries(id: string, limit: number, cursor?: string) {
    await this.authorize("triggers:read");
    id = id.toLowerCase();
    const result = await readOccurrenceSummaries(databaseFor(this.env), this.auth.tenantId,
      { kind: "event", id }, limit, this.occurrenceSummaryBoundary(id, cursor));
    if (!result) throw new ServiceError(404, "not_found", "Event not found");
    return publicValue(eventOccurrenceSummaryPage, result);
  }
  async listSubscriptionOccurrences(id: string, limit: number, cursor?: string) {
    await this.authorizeOwnerSession("triggers:read");
    const result = await readOccurrenceSummaries(databaseFor(this.env), this.auth.tenantId,
      { kind: "subscription", id, userId: this.auth.userId }, limit, this.occurrenceSummaryBoundary(id, cursor));
    if (!result) throw new ServiceError(404, "not_found", "Event subscription not found");
    return publicValue(subscriptionOccurrenceSummaryPage, result);
  }
  async listEventOccurrences(id: string, limit: number, cursor?: string) { await this.authorize("triggers:read"); const result = await this.eventDefinitions().occurrences(id, limit, cursor); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventOccurrencePage, result); }
  async mcpEventCatalog() {
    await this.authorize("triggers:read");
    return {
      events: [{
        name: occurrenceEventName,
        title: "Factorize occurrence",
        description: "A wake for the selected Factorize Event UUID. HTTP 2xx confirms callback acceptance, not processing. Optional subscription acknowledgments use exact original data.occurrenceId, never UUID ordering; recovery wakes may have a fresh eventId.",
        delivery: ["webhook"],
        inputSchema: occurrenceInputSchema,
        payloadSchema: eventPayloadSchema,
      }],
    };
  }
  async mcpSubscribeEvent(input: z.infer<typeof subscribeEventInput>) {
    await this.authorize("triggers:read");
    return subscribeMcpEvent(this.env, this.auth, input);
  }
  async mcpUnsubscribeEvent(input: z.infer<typeof unsubscribeEventInput>) {
    await this.authorize("triggers:read");
    return unsubscribeMcpEvent(this.env, this.auth, input);
  }
  async getEventProcessing(subscriptionId: string) {
    await this.authorize("triggers:read");
    return getProcessingAcknowledgments(this.env, this.auth, subscriptionId);
  }
  async setEventProcessing(input: z.infer<typeof setProcessingAcknowledgmentsInput>) {
    await this.authorize("triggers:read");
    return setProcessingAcknowledgments(this.env, this.auth, input);
  }
  async acknowledgeEventProcessing(input: z.infer<typeof acknowledgeEventsInput>) {
    await this.authorize("triggers:read");
    return acknowledgeEvents(this.env, this.auth, input);
  }
  async replayEventProcessing(subscriptionId: string, ids: string[]) {
    await this.authorize("triggers:read");
    return replayUnacknowledgedEvents(this.env, this.auth, subscriptionId, ids);
  }
  async readEventOccurrences(input: ReadEventOccurrencesInput) {
    await this.authorize("triggers:read");
    const repository = this.eventDefinitions();
    if ("occurrenceId" in input) {
      const occurrence = await repository.occurrence(input.occurrenceId);
      if (!occurrence) throw new ServiceError(404, "not_found", "Event occurrence not found.");
      return { items: [occurrence], nextCursor: null };
    }

    const definitionId = input.definitionId.toLowerCase();
    const cursor = input.cursor ? parseOccurrenceCursor(input.cursor, definitionId, input.since) : null;
    if (input.cursor !== undefined && !cursor) throw new ServiceError(400, "invalid_request", "Cursor does not match the Event definition and since time.");
    if (!await repository.get(definitionId)) throw new ServiceError(404, "not_found", "Event not found.");
    return repository.recordedOccurrences(definitionId, input.since, input.limit, cursor ? [cursor[2], cursor[3]] : undefined);
  }
  async readEventDeliveryDiagnostics(occurrenceId: string) {
    if (this.auth.authMethod === "vm") throw new ServiceError(403, "owner_required", "An owner credential is required.");
    await this.authorize("triggers:read");
    const result = await this.eventDefinitions().deliveryDiagnostics(occurrenceId);
    if (!result) throw new ServiceError(404, "not_found", "Event occurrence not found.");
    return result;
  }
  async mcpReadEvent(uri: string) {
    let parsed: URL; try { parsed = new URL(uri); } catch { throw new ServiceError(400, "invalid_resource", "Expected a Factorize Event resource URI."); }
    if (parsed.protocol !== "factorize:" || parsed.hostname !== "events" || !/^\/[0-9a-f-]{36}\/occurrences$/.test(parsed.pathname)) throw new ServiceError(400, "invalid_resource", "Expected a Factorize Event occurrence URI.");
    const eventId = parsed.pathname.split("/")[1];
    const page = await this.listEventOccurrences(eventId, 100);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(page) }] };
  }
  async eventOccurrenceStates(eventIds: string[]) {
    await this.authorize("triggers:read");
    if (!eventIds.length) return [];
    const result = await databaseFor(this.env).pool.query<{definition_id:string;id:string}>(`SELECT DISTINCT ON (definition_id) definition_id,id FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=ANY($2::uuid[]) ORDER BY definition_id,occurred_at DESC,id DESC`, [this.auth.tenantId,eventIds]);
    return result.rows;
  }
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
  private async wakeScheduler() {
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
  }
  async setTriggerEnabled(triggerId: string, enabled: boolean) { await this.authorize("triggers:write"); if (!await this.triggers().setEnabled(triggerId, enabled, new Date().toISOString())) throw new ServiceError(404, "not_found", "Trigger not found"); await this.wakeScheduler(); return { id: triggerId, enabled }; }
  async getTeam() { await this.authorize("team:read"); const team = await new TeamRepository(databaseFor(this.env), this.auth.tenantId).get(); if (!team) throw new ServiceError(404, "not_found", "Team not found"); return team; }
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

  private integrations() { return new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private providers() { return new ProviderCatalog(databaseFor(this.env), this.env, this.auth.tenantId); }

  async cloudflareState() {
    await this.authorizeOwnerSession("integrations:read");
    return cloudflareState(this.env, this.auth);
  }
  async startCloudflare() {
    await this.authorizeOwnerSession("integrations:write");
    return startCloudflare(this.env, this.auth);
  }
  async disconnectCloudflare(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    try { await this.removal().confirm({kind:"cloudflare",id}); }
    catch (error) {
      if (!(error instanceof AgentApiError) || error.status!==404 || !(await databaseFor(this.env).pool.query(
        "SELECT 1 FROM app.cloudflare_connections WHERE tenant_id=$1 AND id=$2 AND encrypted_credentials IS NULL",[this.auth.tenantId,id])).rowCount) throw error;
    }
    return {ok:true as const};
  }
  async integrationStatus() { await this.authorize("integrations:read"); return publicValue(integrationStatus, await this.integrations().status()); }
  async saveExeIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveExe(input); }
  private removal() { return new IntegrationRemoval(databaseFor(this.env),this.auth,this.env.SESSION_SIGNING_SECRET,this.env.CREDENTIAL_ENCRYPTION_KEY); }
  async previewIntegrationRemoval(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    return this.removal().preview(integrationRemovalTarget.parse(input));
  }
  async confirmIntegrationRemoval(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    const {kind,id,...confirmation} = integrationRemovalConfirmation.parse(input);
    const result = await this.removal().confirm({kind,id},confirmation);
    return {deleted:result.deleted};
  }
  async removeIntegration(kind: "exe" | "amp", id: string) {
    await this.authorize("integrations:write");
    await this.removal().confirm({kind,id});
    return {id,deleted:true};
  }
  async saveAmpIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveAmp(input); }
  async saveTailIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveTail(input); }
  async testTailIntegration(id: string) { await this.authorize("integrations:write"); const result = await this.integrations().testTail(id); if (!result) throw new ServiceError(404, "not_found", "Integration not found"); return result; }
  private credentials() { return new CredentialRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private xConnections() { return new XConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  async listXConnections() {
    await this.authorizeOwnerSession("integrations:read");
    return { connections: await this.xConnections().list() };
  }
  async createXConnection(input: { id: string; name: string; clientId: string; clientSecret: string; scopes: string[] }) {
    await this.authorizeOwnerSession("integrations:write");
    let scopes: XOAuthScope[];
    try { scopes = validateXOAuthScopes(input.scopes); }
    catch (error) { throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid X scopes."); }
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.clientId)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth 2.0 client ID.");
    if (!input.clientSecret.trim() || input.clientSecret.length > 4096 || /[\r\n]/.test(input.clientSecret)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth client secret.");
    if ((await this.xConnections().get(input.id)) !== null) throw new ServiceError(409, "conflict", "X connection already exists.");
    try { return await this.xConnections().create({ ...input, name: input.name.trim(), clientId: input.clientId.trim(), scopes }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") throw new ServiceError(409, "conflict", "An X connection with this name already exists.");
      throw error;
    }
  }
  async deleteXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    const credentials = await this.xConnections().disconnect(id);
    if (!credentials) throw new ServiceError(404, "not_found", "X connection not found.");
    // Local revocation is committed before contacting X. Upstream availability
    // must never keep stale proxy access usable.
    for (const token of [credentials.refreshToken, credentials.accessToken].filter((value): value is string => Boolean(value))) {
      try {
        await fetch("https://api.x.com/2/oauth2/revoke", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
          headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, token_type_hint: token === credentials.refreshToken ? "refresh_token" : "access_token" }),
        });
      } catch { /* Best effort after local access has already been revoked. */ }
    }
    return { id, deleted: true as const };
  }
  async testXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:read");
    const repository = this.xConnections(), connection = await repository.get(id);
    if (!connection || connection.status === "revoked") throw new ServiceError(404, "not_found", "X connection not found.");
    if (connection.status !== "connected") return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "Reconnect this X connection before testing it." };
    const credentials = await repository.clientCredentials(id);
    if (!credentials?.accessToken || !credentials.expiresAt || Date.parse(credentials.expiresAt) <= Date.now())
      return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "Reconnect this X connection before testing it." };
    try {
      const response = await fetch("https://api.x.com/2/users/me?user.fields=id%2Cusername", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
      });
      if (response.status === 401) return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "X rejected this authorization. Reconnect the connection." };
      if (!response.ok) return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X could not verify the connection. Try again later." };
      const me = await response.json() as { data?: { id?: unknown; username?: unknown } };
      if (me.data?.id !== connection.accountId || me.data?.username !== connection.accountHandle)
        return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X returned an account that does not match this connection." };
      return { status: "connected" as const, accountHandle: connection.accountHandle, message: "X connection verified." };
    } catch {
      return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X could not verify the connection. Try again later." };
    }
  }
  async replaceXConnectionCredentials(id: string, input: { clientId: string; clientSecret: string }) {
    await this.authorizeOwnerSession("integrations:write");
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.clientId)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth 2.0 client ID.");
    if (!input.clientSecret.trim() || input.clientSecret.length > 4096 || /[\r\n]/.test(input.clientSecret)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth client secret.");
    const updated = await this.xConnections().replaceClientCredentials(id, { clientId: input.clientId.trim(), clientSecret: input.clientSecret });
    if (!updated) throw new ServiceError(404, "not_found", "X connection not found.");
    return updated;
  }
  async authorizeXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    const repository = this.xConnections(), connection = await repository.get(id);
    if (connection?.status === "revoked") throw new ServiceError(404, "not_found", "X connection not found.");
    const credentials = await repository.clientCredentials(id);
    if (!connection || !credentials) throw new ServiceError(404, "not_found", "X connection not found.");
    const scopes = validateXOAuthScopes(connection.scopes);
    const pkce = await createXPKCE(), nonce = crypto.randomUUID(), expires = Math.floor(Date.now() / 1000) + 600;
    const state = await signXOAuthState({ tenantId: this.auth.tenantId, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, nonce, exp: expires }, this.env.SESSION_SIGNING_SECRET);
    const saved = await repository.createOAuthAttempt({ nonce, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, verifier: pkce.verifier, expiresAt: new Date(expires * 1000) });
    if (!saved) throw new ServiceError(404, "not_found", "X connection not found.");
    const redirectUri = `${this.env.APP_ORIGIN}/oauth/x/callback`, authorize = new URL("https://x.com/i/oauth2/authorize");
    authorize.search = new URLSearchParams({ response_type: "code", client_id: credentials.clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state, code_challenge: pkce.challenge, code_challenge_method: "S256" }).toString();
    return { authorizationUrl: authorize.toString(), stateCookie: state };
  }
  private async bearerWrite(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token?: string; operation: "upsert" | "delete" }) {
    try { return await this.credentials().write({ ...input, managedSecret: input.token, kind: "bearer" }); }
    catch (error) {
      if (error instanceof StaleIntegrationRevisionError) throw new ServiceError(409, "stale_revision", `The integration collection changed. Current revision is ${error.currentRevision}.`);
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different integration change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
      throw error;
    }
  }
  private validateBearerOrigin(origin: string) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new ServiceError(400, "invalid_request", "Integration origin must be an HTTPS origin."); }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) throw new ServiceError(400, "invalid_request", "Integration origin must be an HTTPS origin without credentials, path, query, or fragment.");
  }
  async listBearerIntegrations() {
    await this.authorizeOwnerSession("integrations:read");
    const [revision, records] = await Promise.all([this.credentials().revision(), this.credentials().metadata("bearer")]);
    // Secret values are only read by the server-side credential control path.
    return { revision, integrations: records };
  }
  async createBearerIntegration(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    if ((await this.credentials().metadata("bearer")).some(record => record.id === input.id)) throw new ServiceError(409, "conflict", "Integration already exists.");
    return this.bearerWrite({ ...input, operation: "upsert" });
  }
  async updateBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    const existing = (await this.credentials().metadata("bearer")).find(record => record.id === id);
    if (!existing) throw new ServiceError(404, "not_found", "Integration not found.");
    return this.bearerWrite({ ...input, id, operation: "upsert" });
  }
  async deleteBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string }) {
    await this.authorizeOwnerSession("integrations:write");
    try {
      const result = await this.removal().confirm({kind:"bearer",id},undefined,input);
      return {id,deleted:true as const,...result.journal!};
    } catch (error) {
      if (error instanceof StaleIntegrationRevisionError) throw new ServiceError(409,"stale_revision", `The integration collection changed. Current revision is ${error.currentRevision}.`);
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409,"conflict","The idempotency key was already used for a different integration change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400,"invalid_request",error.message);
      throw error;
    }
  }
  async removeTailIntegration(id: string) {
    await this.authorize("integrations:write");
    await this.removal().confirm({kind:"cloudflareTail",id});
    return {id,deleted:true};
  }
  async linearProjects() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().linearProjects()); }
  async linearOptions() { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().linearOptions()); }
  async clickUpLists() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().clickUpLists()); }
  async clickUpOptions(listId: string) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().clickUpOptions(listId)); }
  async githubRepositories(installationId: number) { await this.authorize("integrations:read"); return publicValue(z.array(githubRepository), await this.providers().githubRepositories(installationId)); }
  async githubIssueOptions(installationId: number, repositoryId: number) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().githubIssueOptions(installationId, repositoryId)); }
  async removeGitHubInstallation(id: number) { await this.authorize("integrations:write"); await this.removal().confirm({kind:"github",id:String(id)}); return { id, deleted: true }; }

  async inspectAppConsent(requestId: string) {
    await this.authorizeOwnerSession("team:read");
    const preview = await inspectOidcConsent(this.env, this.auth, requestId);
    if (!preview) throw new ServiceError(404, "not_found", "App sign-in request is unavailable.");
    return publicValue(oidcConsentPreview, preview);
  }
  async decideAppConsent(body: unknown) {
    await this.authorizeOwnerSession("team:read");
    const redirectTo = await decideOidcConsent(this.env, this.auth, oidcConsentInput.parse(body));
    if (!redirectTo) throw new ServiceError(404, "not_found", "App sign-in request is unavailable.");
    return { redirectTo };
  }

  private apps() { return new AppsRepository(databaseFor(this.env), this.auth.tenantId); }
  async listApps() {
    await this.authorize("apps:manage");
    return publicValue(z.array(registeredApp), await this.apps().list());
  }
  async getApp(id: string) {
    await this.authorize("apps:manage");
    const value = await this.apps().find(id);
    if (!value) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(registeredApp, value);
  }
  async createApp(body: unknown) {
    await this.authorize("apps:manage");
    return publicValue(registeredApp, await this.apps().create(appRegistrationInput.parse(body)));
  }
  async updateApp(id: string, body: unknown) {
    await this.authorize("apps:manage");
    const value = await this.apps().update(id, appRegistrationUpdate.parse(body));
    if (!value) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(registeredApp, value);
  }
  async rotateAppSecret(id: string) {
    await this.authorizeOwnerSession("apps:manage");
    const secret = await this.apps().rotateSecret(id);
    if (!secret) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(appSecret, secret);
  }
  async listConnectedApps() {
    await this.authorizeOwnerSession("team:read");
    return publicValue(z.array(connectedApp), await this.apps().connected(this.auth.userId));
  }
  async revokeConnectedApp(id: string) {
    await this.authorizeOwnerSession("team:write");
    if (!await this.apps().revoke(this.auth.userId, id)) throw new ServiceError(404, "not_found", "App connection not found.");
    return { ok: true };
  }

  private vmGrantView(row: VmGrant) {
    return {
      id: row.id, providerId: row.provider_id, provider: row.provider_kind === "fly" ? "fly.io" : "exe.dev",
      vm: row.vm, app: row.vm_app || null, scopes: row.scopes,
      revision: row.revision,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    };
  }

  async listVmGrants() {
    await this.authorize("vms:read");
    const repository = new VmGrantRepository(databaseFor(this.env).pool, this.auth.tenantId);
    return publicValue(vmGrantList, (await repository.list()).map(row => this.vmGrantView(row)));
  }

  async grantVmPermissions(value: unknown) {
    await this.authorize("vms:edit");
    const { target, permissions } = vmGrantInput.parse(value);
    const database = databaseFor(this.env);
    const row = target.kind === "machine"
      ? await provisionVmGrant(this.env, this.auth, { ...target, permissions })
      : await writeVmPermissionSnapshot(database, this.auth, permissions, async (db, snapshot) => {
        const repository = new VmGrantRepository(db, this.auth.tenantId);
        const updated = await repository.replace(target.grantId, target.expectedRevision, snapshot.scopes, snapshot.presetId, vmGrantActor(this.auth));
        if (updated) return updated;
        const current = await repository.get(target.grantId);
        if (!current?.activated_at || current.revoked_at) throw new ServiceError(404, "not_found", "Active VM grant not found.");
        throw new ServiceError(409, "stale_revision", "The VM grant changed. Refresh it and retry.");
      });
    return publicValue(vmGrantResult, {
      ...this.vmGrantView(row),
      authentication: { audience: vmGrantAudience(row.id), guestKeyPath: `.factorize-vm-grants/${row.id}.pem` },
    });
  }

  async revokeVmPermissions(id: string) {
    await this.authorize("vms:edit");
    const repository = new VmGrantRepository(databaseFor(this.env).pool, this.auth.tenantId);
    if (!await repository.revoke(id, vmGrantActor(this.auth))) {
      const row = await repository.get(id);
      if (!row?.revoked_at) throw new ServiceError(404, "not_found", "VM grant not found.");
    }
    return publicValue(vmRevokeResult, { id, revoked: true });
  }

  async renameMcpClient(input: unknown) {
    const { name } = clientNameInput.parse(input);
    if (this.auth.authMethod !== "oauth" || !this.auth.oauthGrantId) throw new ServiceError(403, "forbidden", "An OAuth connection is required.");
    await databaseFor(this.env).transaction(async sql => {
      const id = this.auth.oauthInstallationId ?? this.auth.oauthGrantId!;
      await lockIntegrationTopology(sql,this.auth.tenantId);
      await lockOAuthPolicy(sql, this.auth);
      await lockMcpEventGrant(sql, this.auth.tenantId, id);
      const connection = await materializeLegacyOAuthInstallation(this.env, sql, this.auth, id);
      if (!connection || connection.active_grant_id !== this.auth.oauthGrantId) throw new ServiceError(403, "forbidden", "An active OAuth connection is required.");
      await sql.query("UPDATE app.oauth_installations SET display_name=$4 WHERE tenant_id=$1 AND user_id=$2 AND id=$3", [this.auth.tenantId, this.auth.userId, id, name]);
    });
    return { name };
  }
  async renameAuthorizedClient(grantId: string, input: unknown) {
    await this.authorizeOwnerSession("triggers:write");
    const { name } = clientNameInput.parse(input);
    await databaseFor(this.env).transaction(async sql => {
      await lockIntegrationTopology(sql,this.auth.tenantId);
      await lockOAuthPolicy(sql, this.auth);
      await lockMcpEventGrant(sql, this.auth.tenantId, grantId);
      if (!await materializeLegacyOAuthInstallation(this.env, sql, this.auth, grantId)) throw new ServiceError(404, "not_found", "Authorization not found.");
      await sql.query("UPDATE app.oauth_installations SET display_name=$4 WHERE tenant_id=$1 AND user_id=$2 AND id=$3", [this.auth.tenantId, this.auth.userId, grantId, name]);
    });
    return { name };
  }
  async listTeamPermissions() {
    await this.authorizeOwnerSession("team:read");
    const tenant = this.auth.tenantId;
    const [preferences, { integrations }] = await Promise.all([
      teamPermissionPreferences(databaseFor(this.env).pool, tenant), listAgentPolicies(this.env, tenant),
    ]);
    const permission = (scope: string, name: string, available: boolean, integration?: {id:string;kind:string;credentialId:string}) => ({
      scope, name, integrationId: integration?.id ?? null, kind: integration?.kind ?? null,
      credentialId: integration?.credentialId ?? null, available, isDefault: preferences.get(permissionKey(scope)) === true,
      preferenceSet: !integration || preferences.has(permissionKey(scope)),
    });
    return publicValue(teamPermissionList, [
      ...standardPermissions.map(scope => permission(scope, scope, true)),
      ...integrations.map(row => permission(row.requiredScope, row.name, row.available && row.policy !== "disabled", row)),
    ]);
  }
  async updateTeamPermission(input: unknown) {
    await this.authorizeOwnerSession("team:write");
    const { scope, isDefault } = teamPermissionUpdate.parse(input);
    const tenant = this.auth.tenantId;
    await databaseFor(this.env).transaction(async sql => {
      await lockIntegrationTopology(sql,tenant);
      if (!standardPermissions.includes(scope)) {
        const { integrations } = await listAgentPolicies(this.env,tenant);
        if (!integrations.some(row => row.requiredScope === scope && row.available && row.policy !== "disabled")) {
          throw new ServiceError(409,"conflict","Integration availability changed. Reload permissions.");
        }
      }
      await sql.query(`INSERT INTO app.team_permission_defaults (tenant_id,permission,enabled)
        VALUES($1,$2,$3) ON CONFLICT (tenant_id,permission) DO UPDATE SET enabled=excluded.enabled`,[tenant,permissionKey(scope),isDefault]);
    });
    return {ok:true};
  }
  async updateClientPermissions(grantId: string, input: unknown) {
    await this.authorizeOwnerSession("triggers:write");
    const edit = clientPermissionsUpdate.parse(input);
    await databaseFor(this.env).transaction(async sql => {
      await lockIntegrationTopology(sql,this.auth.tenantId);
      const { integrations } = await listAgentPolicies(this.env,this.auth.tenantId);
      const available = new Set<string>([...AGENT_SCOPES, ...integrations.filter(row => row.available && row.policy !== "disabled").map(row => row.requiredScope)]);
      await lockOAuthPolicy(sql, this.auth);
      await lockMcpEventGrant(sql, this.auth.tenantId, grantId);
      const row = await materializeLegacyOAuthInstallation(this.env, sql, this.auth, grantId);
      if (!row) throw new ServiceError(404, "not_found", "Authorization not found.");
      if (edit.expectedRevision !== undefined && edit.expectedRevision !== row.policy_revision) throw new ServiceError(409, "conflict", "Connection permissions changed. Reload permissions.");
      let scopes = edit.scopes ?? row.selected_scopes.filter(scope => !edit.disabledScopes?.includes(scope as any));
      // Older clients can explicitly disable an integration; new clients submit only the checkbox snapshot.
      for (const [id, approval] of Object.entries(edit.integrationOverrides ?? {})) {
        const integration = integrations.find(value => value.id === id);
        if (!integration || (approval !== false && approval !== integration.requiredScope)) throw new ServiceError(409, "conflict", "Integration availability changed. Reload permissions.");
        scopes = approval === false ? scopes.filter(scope => integrationForScope(scope) !== id) : [...scopes, approval];
      }
      if (scopes.some(scope => !available.has(scope) && !row.selected_scopes.includes(scope))) throw new ServiceError(400, "invalid_request", "Scope is outside this authorization.");
      const selected = [...new Set(scopes)];
      // Remove scopes from the outstanding credential ceiling permanently. Rechecking
      // a box later only changes desired policy; a fresh credential is still needed.
      await sql.query(`UPDATE app.oauth_installations SET selected_scopes=$4,active_scopes=$5,legacy_implicit_scopes=$6,policy_revision=policy_revision+1
        WHERE tenant_id=$1 AND user_id=$2 AND id=$3`, [this.auth.tenantId, this.auth.userId, grantId, selected,
        row.active_scopes.filter(scope => selected.includes(scope)), row.legacy_implicit_scopes.filter(scope => selected.includes(scope))]);
    });
    return { ok: true };
  }
  async listAuthorizedClients() {
    await this.authorizeOwnerSession("triggers:read");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable");
    const db = databaseFor(this.env);
    const legacy = await listLegacyOAuthGrants(this.env, this.auth);
    // Materialize only exact old grants, never coalescing two installations of one OAuth client.
    if (legacy.length) await db.transaction(async sql => {
      await lockIntegrationTopology(sql,this.auth.tenantId);
      await lockOAuthPolicy(sql, this.auth);
      for (const grant of legacy) await materializeLegacyOAuthInstallation(this.env, sql, this.auth, grant.id, undefined, undefined, grant);
    });
    const [rows, owner, { integrations }] = await Promise.all([
      listOAuthInstallations(db.pool, this.auth.tenantId, this.auth.userId),
      db.pool.query<{ username: string }>("SELECT username FROM app.auth_users WHERE id=$1", [this.auth.userId]),
      listAgentPolicies(this.env, this.auth.tenantId),
    ]);
    const clientIds = [...new Set(rows.map(row => row.client_id))];
    const byId = new Map(await Promise.all(clientIds.map(async clientId => [clientId, await this.env.OAUTH_PROVIDER!.lookupClient(clientId)] as const)));
    const globallyAvailable = [...AGENT_SCOPES, ...integrations.filter(row => row.available && row.policy !== "disabled").map(row => row.requiredScope)];
    const scopeLabels = Object.fromEntries(integrations.map(row => [row.requiredScope, `${row.name} integration access`]));
    return publicValue(z.array(authorizedClient), rows.map(row => {
      const appName = byId.get(row.client_id)?.clientName ?? row.client_id;
      const inactive = (row.active_expires_at !== null && row.active_expires_at.getTime() <= Date.now()) || row.active_session_version !== this.auth.sessionVersion;
      const credentialScopes = inactive ? [] : installationScopes(row).filter(scope => !integrationForScope(scope) || globallyAvailable.includes(scope));
      const pendingScopes = row.selected_scopes.filter(scope => !credentialScopes.includes(scope));
      return { grantId: row.id, clientId: row.client_id, clientName: row.display_name ?? appName, appName,
        availableScopes: [...new Set([...globallyAvailable, ...row.selected_scopes])], scopeLabels, scopes: row.selected_scopes,
        credentialScopes, pendingScopes, revision: row.policy_revision, integrationOverrides: {}, ownerUsername: owner.rows[0]?.username,
        authorizationDate: row.created_at.toISOString(), expiresAt: row.active_expires_at?.toISOString() ?? null, lastUsedAt: null };
    }));
  }
  async revokeOAuthAuthorization(grantId: string) {
    await this.authorizeOwnerSession("triggers:write");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503,"operation_failed","OAuth management unavailable");
    const activeGrant = await databaseFor(this.env).transaction(async sql => {
      await lockIntegrationTopology(sql,this.auth.tenantId);
      await lockOAuthPolicy(sql, this.auth);
      await lockMcpEventGrant(sql, this.auth.tenantId, grantId);
      const row = await materializeLegacyOAuthInstallation(this.env, sql, this.auth, grantId);
      if (!row) throw new ServiceError(404,"not_found","Authorization not found");
      await sql.query("UPDATE app.oauth_installations SET revoked_at=now(),policy_revision=policy_revision+1 WHERE tenant_id=$1 AND user_id=$2 AND id=$3", [this.auth.tenantId,this.auth.userId,grantId]);
      await deleteMcpGrantSubscriptions(sql, { tenant_id: this.auth.tenantId, user_id: this.auth.userId, grant_id: grantId });
      return row.active_grant_id;
    });
    if (activeGrant) await this.env.OAUTH_PROVIDER.revokeGrant(activeGrant,this.auth.userId).catch(() => {
      // The committed installation tombstone already stops resource/refresh use.
      console.warn("factorize.oauth_provider_revocation_pending");
    });
    return {revoked:1};
  }
  async revokeAuthorizedClient(clientId: string) {
    await this.authorizeOwnerSession("triggers:write");
    const matching = (await this.listAuthorizedClients()).filter(row => row.clientId === clientId);
    if (matching.length !== 1) throw new ServiceError(matching.length ? 409 : 404, matching.length ? "conflict" : "not_found", "Choose the exact connection to revoke.");
    return this.revokeOAuthAuthorization(matching[0].grantId);
  }
  async listAccessTokens() { await this.authorizeOwnerSession("triggers:read"); return publicValue(z.array(accessToken), (await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).list()).map(token => ({ ...token, created_at: new Date(token.created_at).toISOString(), expires_at: new Date(token.expires_at).toISOString(), last_used_at: token.last_used_at ? new Date(token.last_used_at).toISOString() : null, revoked_at: token.revoked_at ? new Date(token.revoked_at).toISOString() : null, scopes: normalizeScopes(token.scopes) }))); }
  async createAccessToken(input: any) { await this.authorizeOwnerSession("triggers:write"); const name = typeof input?.name === "string" ? input.name.trim() : "", requested: string[] = Array.isArray(input?.scopes) ? [...new Set<string>(input.scopes.filter((scope: unknown): scope is string => typeof scope === "string"))] : [], scopes = normalizeScopes(requested), expiryDays = Number(input?.expiryDays); if (!name || name.length > 100 || !requested.length || requested.some(scope => !ACCESS_SCOPES.includes(scope as any)) || !scopes.length || ![7, 30, 90].includes(expiryDays)) throw new ServiceError(400, "invalid_request", "A name, supported scopes, and expiryDays of 7, 30, or 90 are required."); const token = issueAccessToken(this.auth.tenantId), expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString(); const metadata = await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).create({ name, scopes, expiresAt, digest: await accessTokenDigest(token), userId: this.auth.userId, sessionVersion: this.auth.sessionVersion }); if (!metadata) throw new ServiceError(401, "invalid_token", "The owner session is no longer active."); return publicValue(createdAccessToken, JSON.parse(JSON.stringify({ ...metadata, token }))); }
  async revokeAccessToken(id: string) { await this.authorizeOwnerSession("triggers:write"); if (!await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).revoke(id)) throw new ServiceError(404, "not_found", "Access token not found"); return { revoked: true }; }
}

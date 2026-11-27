import { ProxyService } from "./proxy/application/proxy-service";
import { AccessControlService } from "./access-control/application/access-control-service";
import { AppsService } from "./apps/application/apps-service";
import { signingConfig } from "./config/runtime";
import { IntegrationsService } from "./integrations/application/integrations-service";
import { VmGrantsService } from "./vm-grants/application/vm-grants-service";
import { SubscriptionsService } from "./subscriptions/application/subscriptions-service";
import { TriggersService } from "./triggers/application/triggers-service";
import type { EventsService } from "./events/application/events-service";
import { eventsFor } from "./events/event-module";

import { cloudflareState, startCloudflare } from "./integrations/providers/cloudflare-oauth";

import { activeVmAuthorization } from "./vm-grants/application/vm-auth";
import { BuiltinSkillError, builtinSkillDocuments, builtinSkillEntry, builtinSkill, builtinSkillResource } from "./builtin-skills";

import { integrationStatus, exeConnection } from "./settings-contracts";

import { z } from "zod";

import type { Env, OAuthProps } from "./types";

import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./access-control/storage/access-token-repository";

import { IntegrationService } from "./integrations/application/integration-service";

import { AGENT_SCOPES, normalizeScopes } from "./access-tokens";

export { ServiceError, publicValue } from "./service-contract";
import { ServiceError, publicValue } from "./service-contract";

type Scope = (typeof AGENT_SCOPES)[number];

export class ApiService {
  private get eventsService() {
    return eventsFor(this.env, this.auth, scope => this.authorize(scope));
  }
  private get triggersService() {
    return new TriggersService(this.env, this.auth, scope => this.authorize(scope));
  }
  private get subscriptionsService() {
    return new SubscriptionsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  private get vmGrantsService() {
    return new VmGrantsService(this.env, this.auth, scope => this.authorize(scope));
  }
  private get integrationsService() {
    return new IntegrationsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  private get appsService() {
    return new AppsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  private get accessControlService() {
    return new AccessControlService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  private get proxyService() {
    return new ProxyService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  authorizationDuration = 0;
  constructor(private env: Env, private auth: OAuthProps, private ctx?: ExecutionContext) {}

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

  agentApi(...args: Parameters<ProxyService["agentApi"]>) { return this.proxyService.agentApi(...args); }
  getApiReflection(...args: Parameters<ProxyService["getApiReflection"]>) { return this.proxyService.getApiReflection(...args); }
  createProxyPayload(...args: Parameters<ProxyService["createProxyPayload"]>) { return this.proxyService.createProxyPayload(...args); }
  getProxyPayload(...args: Parameters<ProxyService["getProxyPayload"]>) { return this.proxyService.getProxyPayload(...args); }
  uploadProxyPayload(...args: Parameters<ProxyService["uploadProxyPayload"]>) { return this.proxyService.uploadProxyPayload(...args); }
  appendProxyPayload(...args: Parameters<ProxyService["appendProxyPayload"]>) { return this.proxyService.appendProxyPayload(...args); }
  finalizeProxyPayload(...args: Parameters<ProxyService["finalizeProxyPayload"]>) { return this.proxyService.finalizeProxyPayload(...args); }
  importProxyAttachment(...args: Parameters<ProxyService["importProxyAttachment"]>) { return this.proxyService.importProxyAttachment(...args); }
  fetchProxyPayload(...args: Parameters<ProxyService["fetchProxyPayload"]>) { return this.proxyService.fetchProxyPayload(...args); }
  requestApiMcp(...args: Parameters<ProxyService["requestApiMcp"]>) { return this.proxyService.requestApiMcp(...args); }
  startApiOperation(...args: Parameters<ProxyService["startApiOperation"]>) { return this.proxyService.startApiOperation(...args); }
  getApiOperation(...args: Parameters<ProxyService["getApiOperation"]>) { return this.proxyService.getApiOperation(...args); }
  cancelApiOperation(...args: Parameters<ProxyService["cancelApiOperation"]>) { return this.proxyService.cancelApiOperation(...args); }
  readApiOperation(...args: Parameters<ProxyService["readApiOperation"]>) { return this.proxyService.readApiOperation(...args); }
  requestApi(...args: Parameters<ProxyService["requestApi"]>) { return this.proxyService.requestApi(...args); }
  queryApiResponse(...args: Parameters<ProxyService["queryApiResponse"]>) { return this.proxyService.queryApiResponse(...args); }
  readApiResponse(...args: Parameters<ProxyService["readApiResponse"]>) { return this.proxyService.readApiResponse(...args); }
  listApiPolicies(...args: Parameters<ProxyService["listApiPolicies"]>) { return this.proxyService.listApiPolicies(...args); }
  updateApiPolicy(...args: Parameters<ProxyService["updateApiPolicy"]>) { return this.proxyService.updateApiPolicy(...args); }

  async listExeConnections() { await this.authorize("integrations:read"); return publicValue(z.array(exeConnection), (await new IntegrationService(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey).status()).exeConnections); }
  getFlyConnection(...args: Parameters<IntegrationsService["getFlyConnection"]>) { return this.integrationsService.getFlyConnection(...args); }
  validateFlyConnection(...args: Parameters<IntegrationsService["validateFlyConnection"]>) { return this.integrationsService.validateFlyConnection(...args); }
  saveFlyConnection(...args: Parameters<IntegrationsService["saveFlyConnection"]>) { return this.integrationsService.saveFlyConnection(...args); }
  removeFlyConnection(...args: Parameters<IntegrationsService["removeFlyConnection"]>) { return this.integrationsService.removeFlyConnection(...args); }
  listGitHubInstallations(...args: Parameters<IntegrationsService["listGitHubInstallations"]>) { return this.integrationsService.listGitHubInstallations(...args); }
  listTailIntegrations(...args: Parameters<IntegrationsService["listTailIntegrations"]>) { return this.integrationsService.listTailIntegrations(...args); }
  eventContextMetadata(...args: Parameters<TriggersService["eventContextMetadata"]>) { return this.triggersService.eventContextMetadata(...args); }
  listEvents(...args: Parameters<EventsService["listEvents"]>) { return this.eventsService.listEvents(...args); }
  listDashboardEventSubscriptions(...args: Parameters<SubscriptionsService["listDashboardEventSubscriptions"]>) { return this.subscriptionsService.listDashboardEventSubscriptions(...args); }
  getDashboardEventSubscription(...args: Parameters<SubscriptionsService["getDashboardEventSubscription"]>) { return this.subscriptionsService.getDashboardEventSubscription(...args); }
  getEvent(...args: Parameters<EventsService["getEvent"]>) { return this.eventsService.getEvent(...args); }
  createEvent(...args: Parameters<EventsService["createEvent"]>) { return this.eventsService.createEvent(...args); }
  updateEvent(...args: Parameters<EventsService["updateEvent"]>) { return this.eventsService.updateEvent(...args); }
  listEnrichmentRuns(...args: Parameters<EventsService["listEnrichmentRuns"]>) { return this.eventsService.listEnrichmentRuns(...args); }
  deleteEvent(...args: Parameters<EventsService["deleteEvent"]>) { return this.eventsService.deleteEvent(...args); }

  listEventOccurrenceSummaries(...args: Parameters<EventsService["listEventOccurrenceSummaries"]>) { return this.eventsService.listEventOccurrenceSummaries(...args); }
  listSubscriptionOccurrences(...args: Parameters<SubscriptionsService["listSubscriptionOccurrences"]>) { return this.subscriptionsService.listSubscriptionOccurrences(...args); }
  listEventOccurrences(...args: Parameters<EventsService["listEventOccurrences"]>) { return this.eventsService.listEventOccurrences(...args); }
  mcpEventCatalog(...args: Parameters<SubscriptionsService["mcpEventCatalog"]>) { return this.subscriptionsService.mcpEventCatalog(...args); }
  mcpSubscribeEvent(...args: Parameters<SubscriptionsService["mcpSubscribeEvent"]>) { return this.subscriptionsService.mcpSubscribeEvent(...args); }
  mcpUnsubscribeEvent(...args: Parameters<SubscriptionsService["mcpUnsubscribeEvent"]>) { return this.subscriptionsService.mcpUnsubscribeEvent(...args); }
  getEventProcessing(...args: Parameters<SubscriptionsService["getEventProcessing"]>) { return this.subscriptionsService.getEventProcessing(...args); }
  setEventProcessing(...args: Parameters<SubscriptionsService["setEventProcessing"]>) { return this.subscriptionsService.setEventProcessing(...args); }
  acknowledgeEventProcessing(...args: Parameters<SubscriptionsService["acknowledgeEventProcessing"]>) { return this.subscriptionsService.acknowledgeEventProcessing(...args); }
  replayEventProcessing(...args: Parameters<SubscriptionsService["replayEventProcessing"]>) { return this.subscriptionsService.replayEventProcessing(...args); }
  readEventOccurrences(...args: Parameters<EventsService["readEventOccurrences"]>) { return this.eventsService.readEventOccurrences(...args); }
  readEventDeliveryDiagnostics(...args: Parameters<EventsService["readEventDeliveryDiagnostics"]>) { return this.eventsService.readEventDeliveryDiagnostics(...args); }
  mcpReadEvent(...args: Parameters<EventsService["mcpReadEvent"]>) { return this.eventsService.mcpReadEvent(...args); }
  eventOccurrenceStates(...args: Parameters<EventsService["eventOccurrenceStates"]>) { return this.eventsService.eventOccurrenceStates(...args); }
  listTriggers(...args: Parameters<TriggersService["listTriggers"]>) { return this.triggersService.listTriggers(...args); }
  getTrigger(...args: Parameters<TriggersService["getTrigger"]>) { return this.triggersService.getTrigger(...args); }
  listTriggerEvents(...args: Parameters<TriggersService["listTriggerEvents"]>) { return this.triggersService.listTriggerEvents(...args); }
  listWebhookDeliveries(...args: Parameters<TriggersService["listWebhookDeliveries"]>) { return this.triggersService.listWebhookDeliveries(...args); }
  getWebhookDelivery(...args: Parameters<TriggersService["getWebhookDelivery"]>) { return this.triggersService.getWebhookDelivery(...args); }
  testTriggerConditions(...args: Parameters<TriggersService["testTriggerConditions"]>) { return this.triggersService.testTriggerConditions(...args); }
  createTrigger(...args: Parameters<TriggersService["createTrigger"]>) { return this.triggersService.createTrigger(...args); }
  updateTrigger(...args: Parameters<TriggersService["updateTrigger"]>) { return this.triggersService.updateTrigger(...args); }

  deleteTrigger(...args: Parameters<TriggersService["deleteTrigger"]>) { return this.triggersService.deleteTrigger(...args); }

  setTriggerEnabled(...args: Parameters<TriggersService["setTriggerEnabled"]>) { return this.triggersService.setTriggerEnabled(...args); }
  getTeam(...args: Parameters<AccessControlService["getTeam"]>) { return this.accessControlService.getTeam(...args); }
  fireTrigger(...args: Parameters<TriggersService["fireTrigger"]>) { return this.triggersService.fireTrigger(...args); }
  listTriggerEventAvailability(...args: Parameters<TriggersService["listTriggerEventAvailability"]>) { return this.triggersService.listTriggerEventAvailability(...args); }
  previewSchedule(...args: Parameters<TriggersService["previewSchedule"]>) { return this.triggersService.previewSchedule(...args); }

  cloudflareState(...args: Parameters<IntegrationsService["cloudflareState"]>) { return this.integrationsService.cloudflareState(...args); }
  startCloudflare(...args: Parameters<IntegrationsService["startCloudflare"]>) { return this.integrationsService.startCloudflare(...args); }
  disconnectCloudflare(...args: Parameters<IntegrationsService["disconnectCloudflare"]>) { return this.integrationsService.disconnectCloudflare(...args); }
  integrationStatus(...args: Parameters<IntegrationsService["integrationStatus"]>) { return this.integrationsService.integrationStatus(...args); }
  saveExeIntegration(...args: Parameters<IntegrationsService["saveExeIntegration"]>) { return this.integrationsService.saveExeIntegration(...args); }

  previewIntegrationRemoval(...args: Parameters<IntegrationsService["previewIntegrationRemoval"]>) { return this.integrationsService.previewIntegrationRemoval(...args); }
  confirmIntegrationRemoval(...args: Parameters<IntegrationsService["confirmIntegrationRemoval"]>) { return this.integrationsService.confirmIntegrationRemoval(...args); }
  removeIntegration(...args: Parameters<IntegrationsService["removeIntegration"]>) { return this.integrationsService.removeIntegration(...args); }
  saveAmpIntegration(...args: Parameters<IntegrationsService["saveAmpIntegration"]>) { return this.integrationsService.saveAmpIntegration(...args); }
  saveTailIntegration(...args: Parameters<IntegrationsService["saveTailIntegration"]>) { return this.integrationsService.saveTailIntegration(...args); }
  testTailIntegration(...args: Parameters<IntegrationsService["testTailIntegration"]>) { return this.integrationsService.testTailIntegration(...args); }

  listXConnections(...args: Parameters<IntegrationsService["listXConnections"]>) { return this.integrationsService.listXConnections(...args); }
  createXConnection(...args: Parameters<IntegrationsService["createXConnection"]>) { return this.integrationsService.createXConnection(...args); }
  deleteXConnection(...args: Parameters<IntegrationsService["deleteXConnection"]>) { return this.integrationsService.deleteXConnection(...args); }
  testXConnection(...args: Parameters<IntegrationsService["testXConnection"]>) { return this.integrationsService.testXConnection(...args); }
  replaceXConnectionCredentials(...args: Parameters<IntegrationsService["replaceXConnectionCredentials"]>) { return this.integrationsService.replaceXConnectionCredentials(...args); }
  authorizeXConnection(...args: Parameters<IntegrationsService["authorizeXConnection"]>) { return this.integrationsService.authorizeXConnection(...args); }

  listBearerIntegrations(...args: Parameters<IntegrationsService["listBearerIntegrations"]>) { return this.integrationsService.listBearerIntegrations(...args); }
  createBearerIntegration(...args: Parameters<IntegrationsService["createBearerIntegration"]>) { return this.integrationsService.createBearerIntegration(...args); }
  updateBearerIntegration(...args: Parameters<IntegrationsService["updateBearerIntegration"]>) { return this.integrationsService.updateBearerIntegration(...args); }
  deleteBearerIntegration(...args: Parameters<IntegrationsService["deleteBearerIntegration"]>) { return this.integrationsService.deleteBearerIntegration(...args); }
  removeTailIntegration(...args: Parameters<IntegrationsService["removeTailIntegration"]>) { return this.integrationsService.removeTailIntegration(...args); }
  linearProjects(...args: Parameters<IntegrationsService["linearProjects"]>) { return this.integrationsService.linearProjects(...args); }
  linearOptions(...args: Parameters<IntegrationsService["linearOptions"]>) { return this.integrationsService.linearOptions(...args); }
  clickUpLists(...args: Parameters<IntegrationsService["clickUpLists"]>) { return this.integrationsService.clickUpLists(...args); }
  clickUpOptions(...args: Parameters<IntegrationsService["clickUpOptions"]>) { return this.integrationsService.clickUpOptions(...args); }
  githubRepositories(...args: Parameters<IntegrationsService["githubRepositories"]>) { return this.integrationsService.githubRepositories(...args); }
  githubIssueOptions(...args: Parameters<IntegrationsService["githubIssueOptions"]>) { return this.integrationsService.githubIssueOptions(...args); }
  removeGitHubInstallation(...args: Parameters<IntegrationsService["removeGitHubInstallation"]>) { return this.integrationsService.removeGitHubInstallation(...args); }

  inspectAppConsent(...args: Parameters<AppsService["inspectAppConsent"]>) { return this.appsService.inspectAppConsent(...args); }
  decideAppConsent(...args: Parameters<AppsService["decideAppConsent"]>) { return this.appsService.decideAppConsent(...args); }

  listApps(...args: Parameters<AppsService["listApps"]>) { return this.appsService.listApps(...args); }
  getApp(...args: Parameters<AppsService["getApp"]>) { return this.appsService.getApp(...args); }
  createApp(...args: Parameters<AppsService["createApp"]>) { return this.appsService.createApp(...args); }
  updateApp(...args: Parameters<AppsService["updateApp"]>) { return this.appsService.updateApp(...args); }
  rotateAppSecret(...args: Parameters<AppsService["rotateAppSecret"]>) { return this.appsService.rotateAppSecret(...args); }
  listConnectedApps(...args: Parameters<AppsService["listConnectedApps"]>) { return this.appsService.listConnectedApps(...args); }
  revokeConnectedApp(...args: Parameters<AppsService["revokeConnectedApp"]>) { return this.appsService.revokeConnectedApp(...args); }

  listVmGrants(...args: Parameters<VmGrantsService["listVmGrants"]>) { return this.vmGrantsService.listVmGrants(...args); }

  grantVmPermissions(...args: Parameters<VmGrantsService["grantVmPermissions"]>) { return this.vmGrantsService.grantVmPermissions(...args); }

  revokeVmPermissions(...args: Parameters<VmGrantsService["revokeVmPermissions"]>) { return this.vmGrantsService.revokeVmPermissions(...args); }

  renameMcpClient(...args: Parameters<AccessControlService["renameMcpClient"]>) { return this.accessControlService.renameMcpClient(...args); }
  renameAuthorizedClient(...args: Parameters<AccessControlService["renameAuthorizedClient"]>) { return this.accessControlService.renameAuthorizedClient(...args); }
  listTeamPermissions(...args: Parameters<AccessControlService["listTeamPermissions"]>) { return this.accessControlService.listTeamPermissions(...args); }
  updateTeamPermission(...args: Parameters<AccessControlService["updateTeamPermission"]>) { return this.accessControlService.updateTeamPermission(...args); }
  updateClientPermissions(...args: Parameters<AccessControlService["updateClientPermissions"]>) { return this.accessControlService.updateClientPermissions(...args); }
  listAuthorizedClients(...args: Parameters<AccessControlService["listAuthorizedClients"]>) { return this.accessControlService.listAuthorizedClients(...args); }
  revokeOAuthAuthorization(...args: Parameters<AccessControlService["revokeOAuthAuthorization"]>) { return this.accessControlService.revokeOAuthAuthorization(...args); }
  revokeAuthorizedClient(...args: Parameters<AccessControlService["revokeAuthorizedClient"]>) { return this.accessControlService.revokeAuthorizedClient(...args); }
  listAccessTokens(...args: Parameters<AccessControlService["listAccessTokens"]>) { return this.accessControlService.listAccessTokens(...args); }
  createAccessToken(...args: Parameters<AccessControlService["createAccessToken"]>) { return this.accessControlService.createAccessToken(...args); }
  revokeAccessToken(...args: Parameters<AccessControlService["revokeAccessToken"]>) { return this.accessControlService.revokeAccessToken(...args); }
}

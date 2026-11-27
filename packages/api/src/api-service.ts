import { ProxyService } from "./proxy/application/proxy-service";
import { AccessControlService } from "./access-control/application/access-control-service";
import { AppsService } from "./apps/application/apps-service";

import { IntegrationsService } from "./integrations/application/integrations-service";
import { VmGrantsService } from "./vm-grants/application/vm-grants-service";
import { SubscriptionsService } from "./subscriptions/application/subscriptions-service";
import { TriggersService } from "./triggers/application/triggers-service";

import { eventsFor } from "./events/event-module";

import { activeVmAuthorization } from "./vm-grants/application/vm-auth";
import { BuiltinSkillError, builtinSkillDocuments, builtinSkillEntry, builtinSkill, builtinSkillResource } from "./skills/builtin-skills";

import type { Env, OAuthProps } from "./types";

import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./auth/storage/identity-repository";
import { AccessTokenRepository } from "./access-control/storage/access-token-repository";

import { AGENT_SCOPES, normalizeScopes } from "./access-control/domain/scopes";

export { ServiceError, publicValue } from "./service-contract";
import { ServiceError, publicValue } from "./service-contract";

type Scope = (typeof AGENT_SCOPES)[number];

export class ApiService {
  get events() {
    return eventsFor(this.env, this.auth, scope => this.authorize(scope));
  }
  get triggers() {
    return new TriggersService(this.env, this.auth, scope => this.authorize(scope));
  }
  get subscriptions() {
    return new SubscriptionsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  get vmGrants() {
    return new VmGrantsService(this.env, this.auth, scope => this.authorize(scope));
  }
  get integrations() {
    return new IntegrationsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  get apps() {
    return new AppsService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  get access() {
    return new AccessControlService(this.env, this.auth, scope => this.authorize(scope), scope => this.authorizeOwnerSession(scope));
  }
  get proxy() {
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
}

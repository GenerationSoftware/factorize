import { exeConnection } from "../api/connection-contracts";
import { appConfig, signingConfig } from "../../config/runtime";
import { IntegrationRemoval } from "./integration-removal";

import { integrationRemovalConfirmation, integrationRemovalTarget } from "../api/integration-removal-contracts";
import { cloudflareState, startCloudflare } from "../providers/cloudflare-oauth";

import { AgentApiError } from "../../proxy/application/agent-api";

import { integrationStatus } from "../api/connection-contracts";
import { accessToken } from "../../access-control/api/access-contracts";
import { namedOption, providerOptions, githubRepository, githubInstallation, tailIntegration } from "../api/editor-contracts";
import { z } from "zod";

import type { Env, OAuthProps } from "../../types";
import { databaseFor } from "../../postgres/database";

import { CredentialRepository, IntegrationIdempotencyConflictError, IntegrationValidationError, StaleIntegrationRevisionError } from "../../credentials/storage/credential-repository";
import { XConnectionRepository } from "../../credentials/storage/x-connection-repository";
import { createXPKCE, signXOAuthState, validateXOAuthScopes, type XOAuthScope } from "../providers/x-oauth";
import { GitHubRepository } from "../../credentials/storage/github-repository";
import { IntegrationService } from "./integration-service";
import { ProviderCatalog } from "./provider-catalog";
import { AGENT_SCOPES } from "../../access-control/domain/scopes";
import { createFlyAccountClient, FlyAccountError, flyConnectionInput } from "../providers/fly-account-client";
import { FlyConnectionRepository } from "../../credentials/storage/fly-connection-repository";
import { ServiceError, publicValue } from "../../service-contract";

export class IntegrationsService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>, private authorizeOwnerSession: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  private flyConnections() { return new FlyConnectionRepository(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey); }

  private handleFlyAccountError(error: unknown): never {
    if (!(error instanceof FlyAccountError)) throw error;
    throw new ServiceError(error.kind === "auth" ? 401 : error.kind === "organization" ? 403 : 502, "fly_account_error", error.message);
  }

  private integrations() { return new IntegrationService(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey); }

  private providers() { return new ProviderCatalog(databaseFor(this.env), this.env, this.auth.tenantId); }

  private removal() { return new IntegrationRemoval(databaseFor(this.env),this.auth,signingConfig(this.env).sessionSecret,signingConfig(this.env).credentialKey); }

  private credentials() { return new CredentialRepository(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey); }

  private xConnections() { return new XConnectionRepository(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey); }

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

  async listTailIntegrations() { await this.authorize("integrations:read"); return publicValue(z.array(tailIntegration), await new IntegrationService(databaseFor(this.env), this.auth.tenantId, signingConfig(this.env).credentialKey).tails()); }

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

  async listExeConnections() {
    await this.authorize("integrations:read");
    return publicValue(z.array(exeConnection), (await this.integrations().status()).exeConnections);
  }

  async integrationStatus() { await this.authorize("integrations:read"); return publicValue(integrationStatus, await this.integrations().status()); }

  async saveExeIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveExe(input); }

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
    const state = await signXOAuthState({ tenantId: this.auth.tenantId, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, nonce, exp: expires }, signingConfig(this.env).sessionSecret);
    const saved = await repository.createOAuthAttempt({ nonce, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, verifier: pkce.verifier, expiresAt: new Date(expires * 1000) });
    if (!saved) throw new ServiceError(404, "not_found", "X connection not found.");
    const redirectUri = `${appConfig(this.env).origin}/oauth/x/callback`, authorize = new URL("https://x.com/i/oauth2/authorize");
    authorize.search = new URLSearchParams({ response_type: "code", client_id: credentials.clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state, code_challenge: pkce.challenge, code_challenge_method: "S256" }).toString();
    return { authorizationUrl: authorize.toString(), stateCookie: state };
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
}

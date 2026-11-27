import { teamPermissionPreferences } from "../storage/team-permission-preferences";
import { lockIntegrationTopology } from "../../integrations/storage/integration-removal-topology";

import { lockOAuthPolicy } from "./oauth-reconnect";
import { integrationForScope } from "../domain/scopes";
import { installationScopes, listLegacyOAuthGrants, listOAuthInstallations, materializeLegacyOAuthInstallation } from "./oauth-installations";
import { deleteMcpGrantSubscriptions, lockMcpEventGrant } from "../../subscriptions/storage/mcp-event-outbox";

import { TeamRepository } from "../storage/team-repository";
import { listAgentPolicies } from "../../proxy/application/agent-api";

import { accessToken, createdAccessToken, clientPermissionsUpdate, clientNameInput, authorizedClient } from "../api/access-contracts";
import { z } from "zod";
import { teamPermissionList, teamPermissionUpdate } from "../api/access-contracts";
import { permissionKey, standardPermissions } from "../domain/team-permission-defaults";
import type { Env, OAuthProps } from "../../types";
import { databaseFor } from "../../postgres/database";

import { AccessTokenRepository } from "../storage/access-token-repository";

import { accessTokenDigest, issueAccessToken } from "./access-tokens";
import { ACCESS_SCOPES, AGENT_SCOPES, normalizeScopes } from "../domain/scopes";
import { ServiceError, publicValue } from "../../service-contract";

export class AccessControlService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>, private authorizeOwnerSession: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  async getTeam() { await this.authorize("team:read"); const team = await new TeamRepository(databaseFor(this.env), this.auth.tenantId).get(); if (!team) throw new ServiceError(404, "not_found", "Team not found"); return team; }

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
    const liveScopes = new Set(integrations.filter(row => row.kind === "hetzner" && row.available && row.policy !== "disabled").map(row => row.requiredScope));
    const scopeLabels = Object.fromEntries(integrations.map(row => [row.requiredScope,
      row.kind === "hetzner" ? "Hetzner Cloud (inventory and SSH checks)" : `${row.name} integration access`]));
    return publicValue(z.array(authorizedClient), rows.map(row => {
      const appName = byId.get(row.client_id)?.clientName ?? row.client_id;
      const inactive = (row.active_expires_at !== null && row.active_expires_at.getTime() <= Date.now()) || row.active_session_version !== this.auth.sessionVersion;
      const credentialScopes = inactive ? [] : installationScopes(row).filter(scope => !integrationForScope(scope) || globallyAvailable.includes(scope));
      const pendingScopes = row.selected_scopes.filter(scope => !credentialScopes.includes(scope) && !liveScopes.has(scope));
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

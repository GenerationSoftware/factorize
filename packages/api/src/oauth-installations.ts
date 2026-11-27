import { lockIntegrationTopology } from "./postgres/integration-removal-topology";
import type { AuthRequest, GrantSummary } from "@cloudflare/workers-oauth-provider";
import { normalizeScopes } from "./access-tokens";
import { connectionAccess, requiredIntegrationScope, type AgentIntegration } from "./proxy/application/agent-integration-access";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { applyConnectionScopes, type ConnectionScopePolicy } from "./oauth-connection-settings";
import { initialIntegrationOverrides, lockOAuthPolicy } from "./oauth-reconnect";
import type { Env } from "./types";
import type { Session } from "./session";
import { lockMcpEventGrant } from "./subscriptions/storage/mcp-event-outbox";

export type OAuthInstallation = {
  tenant_id: string; user_id: string; id: string; client_id: string; redirect_uri: string; display_name: string | null;
  selected_scopes: string[]; active_grant_id: string | null; active_scopes: string[]; legacy_implicit_scopes: string[]; active_session_version: number | null;
  active_expires_at: Date | null; policy_revision: number; created_at: Date; revoked_at: Date | null;
};
type Owner = Pick<Session, "tenantId" | "userId" | "sessionVersion">;
export async function getOAuthInstallation(sql: DatabaseClient, tenantId: string, userId: string, id: string, share = false) {
  return (await sql.query<OAuthInstallation>("SELECT * FROM app.oauth_installations WHERE tenant_id=$1 AND user_id=$2 AND id=$3" + (share ? " FOR SHARE" : ""), [tenantId, userId, id])).rows[0] ?? null;
}
export async function listOAuthInstallations(sql: DatabaseClient, tenantId: string, userId: string) {
  return (await sql.query<OAuthInstallation>("SELECT * FROM app.oauth_installations WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND active_grant_id IS NOT NULL ORDER BY created_at DESC,id", [tenantId, userId])).rows;
}
export function installationScopes(row: OAuthInstallation, credentialScopes = row.active_scopes) {
  if (row.revoked_at) return [];
  const issued = new Set(row.active_scopes);
  const selected = new Set(row.selected_scopes);
  const usable = credentialScopes.includes("proxy:use") ? [...credentialScopes, ...row.legacy_implicit_scopes] : credentialScopes;
  return [...new Set(usable.filter(scope => issued.has(scope) && selected.has(scope)))];
}

export async function listLegacyOAuthGrants(env: Env, owner: Owner) {
  if (!env.OAUTH_PROVIDER) return [];
  const result: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const current = await env.OAUTH_PROVIDER.listUserGrants(owner.userId, { limit: 100, cursor });
    result.push(...current.items.filter(grant => (!grant.userId || grant.userId === owner.userId) &&
      grant.metadata?.tenantId === owner.tenantId && !grant.metadata?.oauthInstallationId));
    if (!current.cursor) return result;
    cursor = current.cursor;
  }
  throw new Error("OAuth grant inventory exceeded safe pagination");
}
export async function getLegacyOAuthChoices(env: Env, owner: Owner, request: AuthRequest) {
  const sql = databaseFor(env).pool;
  const grants = (await listLegacyOAuthGrants(env, owner)).filter(grant => grant.clientId === request.clientId && grant.redirectUri === request.redirectUri);
  if (!grants.length) return [];
  const represented = await sql.query<{id: string}>(`SELECT id FROM app.oauth_installations WHERE tenant_id=$1 AND id=ANY($2)
    UNION SELECT subject AS id FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=ANY($2) AND revoked_at IS NOT NULL`,
    [owner.tenantId, grants.map(grant => grant.id)]);
  const ids = new Set(represented.rows.map(row => row.id));
  return (await Promise.all(grants.filter(grant => !ids.has(grant.id)).map(async grant => {
    const policy = await snapshotLegacyGrant(sql, owner, grant);
    return policy && { grantId: grant.id, displayName: policy.displayName, createdAt: Number.isFinite(grant.createdAt) ? grant.createdAt : Math.floor(Date.now()/1000),
      selectedScopes: policy.selectedScopes, activeScopes: policy.activeScopes, policyRevision: policy.policyRevision };
  }))).filter(value => value !== null);
}

type OldPolicy = ConnectionScopePolicy & { user_id: string; session_version: number; integration_overrides: Record<string,string|false>; revoked_at: Date | null; display_name: string | null; permissions_revision: number };
async function snapshotLegacyGrant(sql: DatabaseClient, owner: Owner, grant: GrantSummary) {
  const grantId = grant.id;
  const old = (await sql.query<OldPolicy>(`SELECT user_id,session_version,revoked_at,display_name,permissions_revision,disabled_scopes,scope_overrides,integration_overrides
    FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2`, [owner.tenantId, grantId])).rows[0];
  if (old?.revoked_at || (old && old.user_id !== owner.userId)) return null;
  const original = normalizeScopes(grant.scope);
  const isExplicit = grant.metadata?.explicitIntegrationScopes === true;
  const policy = { disabled_scopes: old?.disabled_scopes ?? [], integration_overrides: old?.integration_overrides ?? initialIntegrationOverrides(grant.metadata?.initialIntegrationDenials) };
  const originalAllowed = applyConnectionScopes(original, old);
  const approved = (old?.scope_overrides ?? originalAllowed).filter(scope => !policy.disabled_scopes.includes(scope));
  const integrations = (await sql.query<AgentIntegration & {legacy_baseline: boolean}>(`SELECT i.*,b.scope IS NOT NULL AS legacy_baseline
    FROM app.agent_integrations i LEFT JOIN app.oauth_legacy_baselines b ON b.tenant_id=i.tenant_id AND b.scope='integration:'||i.id||':'||i.epoch
    WHERE i.tenant_id=$1`, [owner.tenantId])).rows;
  const credential = [...originalAllowed];
  const implicit: string[] = [];
  for (const integration of integrations) {
    const scope = requiredIntegrationScope(integration);
    if (connectionAccess(integration, approved, policy, true) === "blocked") {
      for (let index = approved.indexOf(scope); index !== -1; index = approved.indexOf(scope)) approved.splice(index, 1);
      continue;
    }
    if (!isExplicit && originalAllowed.includes("proxy:use") &&
        (policy.integration_overrides[integration.id] === scope || (integration.legacy_baseline && integration.policy === "baseline"))) {
      approved.push(scope);
      credential.push(scope);
      implicit.push(scope);
    }
  }
  const subscriptions = old ? null : (await sql.query<{session_version: number | null}>(`SELECT min(session_version) AS session_version
    FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND user_id=$2 AND grant_id=$3 AND client_id=$4`,
    [owner.tenantId,owner.userId,grantId,grant.clientId])).rows[0];
  return { displayName: old?.display_name ?? null, selectedScopes: [...new Set(approved)], activeScopes: [...new Set(credential)],
    activeSessionVersion: old?.session_version ?? subscriptions?.session_version ?? owner.sessionVersion, legacyImplicitScopes: [...new Set(implicit)], policyRevision: old?.permissions_revision ?? 0 };
}
export async function materializeLegacyOAuthInstallation(env: Env, sql: DatabaseClient, owner: Owner, grantId: string, clientId?: string, redirectUri?: string, observedGrant?: GrantSummary) {
  const existing = await getOAuthInstallation(sql, owner.tenantId, owner.userId, grantId);
  if (existing) return !existing.revoked_at && (clientId === undefined || existing.client_id === clientId) && (redirectUri === undefined || existing.redirect_uri === redirectUri) ? existing : null;
  const grant = (observedGrant ? [observedGrant] : await listLegacyOAuthGrants(env, owner)).find(value => value.id === grantId &&
    (clientId === undefined || value.clientId === clientId) && (redirectUri === undefined || value.redirectUri === redirectUri));
  if (!grant) return null;
  const snapshot = await snapshotLegacyGrant(sql, owner, grant);
  if (!snapshot) return null;
  const result = await sql.query<OAuthInstallation>(`INSERT INTO app.oauth_installations
    (tenant_id,user_id,id,client_id,redirect_uri,display_name,selected_scopes,active_grant_id,active_session_version,active_scopes,legacy_implicit_scopes,active_expires_at,policy_revision,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$3,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,id) DO NOTHING RETURNING *`,
    [owner.tenantId, owner.userId, grantId, grant.clientId, grant.redirectUri ?? "", snapshot.displayName, snapshot.selectedScopes, snapshot.activeSessionVersion,
      snapshot.activeScopes, snapshot.legacyImplicitScopes, grant.expiresAt ? new Date(grant.expiresAt * 1000) : null, snapshot.policyRevision, new Date(Number.isFinite(grant.createdAt) ? grant.createdAt * 1000 : Date.now())]);
  return result.rows[0] ?? getOAuthInstallation(sql, owner.tenantId, owner.userId, grantId);
}

// Adopt legacy grants only from a verified provider inventory, not from
// a presented token's (potentially downscoped) scopes or a client-provided ID.
export async function adoptLegacyCredential(env: Env, owner: Owner, grantId: string, clientId: string) {
  const db = databaseFor(env);
  if (await getOAuthInstallation(db.pool, owner.tenantId, owner.userId, grantId)) return;
  if (!env.OAUTH_PROVIDER) return;
  await db.transaction(async sql => {
    await lockIntegrationTopology(sql,owner.tenantId);
    await lockOAuthPolicy(sql, owner);
    await lockMcpEventGrant(sql, owner.tenantId, grantId);
    await materializeLegacyOAuthInstallation(env, sql, owner, grantId, clientId);
  });
}

export async function prepareOAuthIssuance(sql: DatabaseClient, input: {
  session: Owner; installationId: string | null; clientId: string; redirectUri: string; policyRevision: number | null;
  selectedScopes: string[]; credentialScopes: string[]; expiresAt: number;
}) {
  const {session} = input;
  const installationId = input.installationId ?? crypto.randomUUID();
  if (input.installationId === null) {
    await sql.query("INSERT INTO app.oauth_installations(tenant_id,user_id,id,client_id,redirect_uri) VALUES($1,$2,$3,$4,$5)",
      [session.tenantId,session.userId,installationId,input.clientId,input.redirectUri]);
  }
  await lockMcpEventGrant(sql, session.tenantId, installationId);
  const current = await getOAuthInstallation(sql, session.tenantId, session.userId, installationId);
  if (!current || current.revoked_at || current.client_id !== input.clientId || current.redirect_uri !== input.redirectUri || current.policy_revision !== (input.policyRevision ?? 0)) {
    throw new Error("OAuth connection changed before authorization");
  }
  const issuanceId = crypto.randomUUID();
  await sql.query(`INSERT INTO app.oauth_installation_issuances
     (id,tenant_id,user_id,installation_id,expected_revision,session_version,selected_scopes,credential_scopes,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [issuanceId,session.tenantId,session.userId,installationId,input.policyRevision ?? 0,session.sessionVersion,input.selectedScopes,input.credentialScopes,new Date(input.expiresAt * 1000)]);
  return { installationId, issuanceId };
}

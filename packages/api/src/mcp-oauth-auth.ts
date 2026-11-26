import { lockIntegrationTopology } from "./postgres/integration-removal-topology";
import { OAuthError, type TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { normalizeScopes } from "./access-tokens";
import { applyConnectionScopes, type ConnectionScopePolicy } from "./oauth-connection-settings";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { lockOAuthPolicy } from "./oauth-reconnect";
import { lockMcpEventGrant } from "./postgres/mcp-event-outbox";
import { getOAuthInstallation, installationScopes, type OAuthInstallation } from "./oauth-installations";
import type { Env, OAuthProps } from "./types";

type Rejection = "invalid_token" | "token_expired" | "membership_inactive" | "session_mismatch" | "grant_revoked" | "grant_mismatch" | "refresh_rejected";
type Policy = ConnectionScopePolicy & { user_id: string; session_version: number; revoked_at: Date | null; integration_overrides: Record<string, string | false> };
export function authDiagnostic(stage: "resource" | "refresh", reason: Rejection) {
  console.warn("factorize.mcp_oauth_rejected", { stage, reason });
}
export function mcpOAuthChallenge(env: Env, reason?: Rejection, scopes?: readonly string[]) {
  if (reason) authDiagnostic("resource", reason);
  const attributes = ['resource_metadata="' + env.APP_ORIGIN + '/.well-known/oauth-protected-resource/mcp"'];
  if (scopes) attributes.unshift('error="insufficient_scope"', 'scope="' + scopes.join(" ") + '"');
  else if (reason) attributes.unshift('error="invalid_token"');
  return Response.json({ error: { code: scopes ? "insufficient_scope" : "invalid_token" } }, {
    status: scopes ? 403 : 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer " + attributes.join(", ") },
  });
}
type GrantIdentity = Pick<OAuthProps, "tenantId" | "userId" | "sessionVersion" | "oauthInstallationId" | "oauthClientId">;
type Inspection = { policy?: Policy; installation?: OAuthInstallation; reason?: Rejection };
export function scopesForOAuthCredential(credential: string[], result: Inspection) {
  return result.reason ? [] : result.installation ? installationScopes(result.installation, credential) : applyConnectionScopes(credential, result.policy);
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function inspectOAuthGrant(sql: DatabaseClient, auth: GrantIdentity, grantId: string, lock = false): Promise<Inspection> {
  if (!auth || !uuid.test(auth.tenantId) || !uuid.test(auth.userId) || !Number.isSafeInteger(auth.sessionVersion) || !grantId) {
    return { reason: "grant_mismatch" as const };
  }
  const { rows } = await sql.query<{ role: string; session_version: number }>(
    `SELECT m.role,m.session_version FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
     WHERE m.tenant_id=$1 AND m.user_id=$2 AND u.email_verified${lock ? " FOR SHARE OF m,u" : ""}`, [auth.tenantId, auth.userId]);
  const member = rows[0];
  if (member?.role !== "owner") return { reason: "membership_inactive" as const };
  if (member.session_version !== auth.sessionVersion) return { reason: "session_mismatch" as const };
  const installation = await getOAuthInstallation(sql, auth.tenantId, auth.userId, auth.oauthInstallationId ?? grantId);
  if (installation) {
    if (installation.revoked_at) return { reason: "grant_revoked" };
    if (installation.active_grant_id !== grantId || installation.active_session_version !== auth.sessionVersion ||
        (auth.oauthClientId !== undefined && auth.oauthClientId !== installation.client_id)) return { reason: "grant_mismatch" };
    return { installation };
  }
  if (auth.oauthInstallationId) return { reason: "grant_mismatch" };
  const policy = (await sql.query<Policy>(
    `SELECT user_id,session_version,revoked_at,disabled_scopes,scope_overrides,integration_overrides
     FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2`, [auth.tenantId, grantId])).rows[0];
  if (policy?.revoked_at) return { reason: "grant_revoked" as const };
  if (policy && (policy.user_id !== auth.userId || policy.session_version !== auth.sessionVersion)) return { reason: "grant_mismatch" as const };
  return { policy };
}

export function oauthResourceAuthorization(env: Env, auth: OAuthProps, grantId: string): Promise<Inspection> {
  if (!auth.oauthExpiresAt || !Number.isFinite(auth.oauthExpiresAt) || auth.oauthExpiresAt <= Date.now() / 1000) {
    return Promise.resolve({ reason: "token_expired" as const });
  }
  return inspectOAuthGrant(databaseFor(env).pool, auth, grantId);
}

type TokenHook = (options: TokenExchangeCallbackOptions) => Promise<{ accessTokenScope: string[] } | void>;
function invalidRefresh(reason: Rejection): never {
  authDiagnostic("refresh", reason);
  throw new OAuthError("invalid_grant", { description: "The authorization is no longer active." });
}

// The provider validates the refresh credential and client before invoking
// the hook. Only then acquire application locks, keeping them through the
// provider's rotation and token writes. Revocation shares this grant lock.
export async function withRefreshAdmission(env: Env, run: (hook: TokenHook) => Promise<Response>, reportProviderRejection: boolean, redirectUri?: string | null) {
  let finish!: (success: boolean) => void;
  const providerFinished = new Promise<boolean>(resolve => { finish = resolve; });
  let transaction: Promise<void> | undefined;
  const onExchange: TokenHook = options => {
    const props = options.props as OAuthProps | undefined;
    const rotating = options.grantType === "refresh_token";
    const activating = options.grantType === "authorization_code" && !!props?.oauthInstallationId;
    if (!rotating && !activating) return Promise.resolve();
    if (!props || !Array.isArray(props.scopes) || props.scopes.some(scope => typeof scope !== "string") || props.userId !== options.userId || !uuid.test(props.tenantId) || !options.grantId) invalidRefresh("grant_mismatch");
    return new Promise((accept, reject) => {
      let admitted = false;
      transaction = databaseFor(env).transaction(async sql => {
        if (activating) await lockIntegrationTopology(sql,props.tenantId);
        await lockOAuthPolicy(sql, props);
        const anchor = props.oauthInstallationId ?? options.grantId;
        await lockMcpEventGrant(sql, props.tenantId, anchor);
        const consent = new Set(normalizeScopes(props.scopes));
        const requested = normalizeScopes(options.requestedScope).filter(scope => consent.has(scope));
        if (activating) {
          const installation = await getOAuthInstallation(sql, props.tenantId, props.userId, anchor);
          if (!installation || installation.revoked_at || installation.client_id !== options.clientId || installation.redirect_uri !== redirectUri ||
              !props.oauthIssuanceId || !uuid.test(props.oauthIssuanceId)) invalidRefresh("grant_mismatch");
          const row = (await sql.query<{expected_revision: number; session_version: number; selected_scopes: string[]; credential_scopes: string[]}>(
            `SELECT p.expected_revision,p.session_version,p.selected_scopes,p.credential_scopes FROM app.oauth_installation_issuances p
             JOIN app.members m ON m.tenant_id=p.tenant_id AND m.user_id=p.user_id JOIN app.auth_users u ON u.id=p.user_id
             WHERE p.id=$1 AND p.tenant_id=$2 AND p.user_id=$3 AND p.installation_id=$4 AND p.consumed_at IS NULL
               AND p.expires_at>clock_timestamp() AND m.role='owner' AND m.session_version=p.session_version AND u.email_verified
             FOR UPDATE OF p FOR SHARE OF m,u`, [props.oauthIssuanceId, props.tenantId, props.userId, anchor])).rows[0];
          if (!row || row.session_version !== props.sessionVersion || row.expected_revision !== installation.policy_revision ||
              row.credential_scopes.some(scope => !consent.has(scope))) invalidRefresh("grant_mismatch");
          const issued = requested.filter(scope => row.credential_scopes.includes(scope) && row.selected_scopes.includes(scope));
          admitted = true;
          accept({ accessTokenScope: issued });
          if (await providerFinished) {
            await sql.query(`UPDATE app.oauth_installations SET active_grant_id=$4,active_session_version=$5,active_scopes=$6,
              selected_scopes=$7,legacy_implicit_scopes='{}',active_expires_at=NULL,policy_revision=policy_revision+1
              WHERE tenant_id=$1 AND user_id=$2 AND id=$3`, [props.tenantId, props.userId, anchor, options.grantId, props.sessionVersion, issued, row.selected_scopes]);
            await sql.query("UPDATE app.oauth_installation_issuances SET consumed_at=now() WHERE id=$1", [props.oauthIssuanceId]);
          }
          return;
        }
        const result = await inspectOAuthGrant(sql, { ...props, oauthClientId: options.clientId }, options.grantId, true);
        if (result.reason) invalidRefresh(result.reason);
        // Never write back synthetic scopes granted only to historical capabilities,
        // or expand a credential whose provider reports a narrower requested scope.
        const effective = new Set(scopesForOAuthCredential(requested, result));
        admitted = true;
        accept({ accessTokenScope: requested.filter(scope => effective.has(scope)) });
        await providerFinished;
      }).catch(error => {
        if (admitted) throw error;
        reject(error);
      });
    });
  };
  let success = false;
  try {
    const response = await run(onExchange);
    success = response.ok;
    if (reportProviderRejection && response.status === 400 && !transaction) {
      const payload = await response.clone().json<{error?: string}>().catch(() => null);
      if (payload?.error === "invalid_grant") authDiagnostic("refresh", "refresh_rejected");
    }
    return response;
  } finally {
    finish(success);
    await transaction;
  }
}

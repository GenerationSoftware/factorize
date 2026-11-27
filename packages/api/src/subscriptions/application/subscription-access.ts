import { normalizeScopes } from "../../access-tokens";

import { getOAuthInstallation, installationScopes } from "../../oauth-installations";
import { applyConnectionScopes, type ConnectionScopePolicy } from "../../oauth-connection-settings";
import { type DatabaseClient } from "../../postgres/database";

import type { Env } from "../../types";

export type Principal = {
  tenant_id: string;
  user_id: string;
  grant_id: string; // Stable OAuth installation, or the original grant for legacy registrations.
  credential_id?: string;
  client_id: string;
  session_version: number;
};

export async function activeGrantScopes(env: Env, principal: Principal): Promise<string[] | null> {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth management unavailable");
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(principal.user_id, { limit: 100, cursor });
    const grant = page.items.find(item => item.id === (principal.credential_id ?? principal.grant_id));
    if (grant) {
      if (grant.clientId !== principal.client_id || grant.metadata?.tenantId !== principal.tenant_id ||
          (grant.expiresAt != null && grant.expiresAt <= Date.now() / 1000)) return null;
      return normalizeScopes(grant.scope);
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}

export async function authorized(sql: DatabaseClient, principal: Principal, scopes: string[]) {
  const member = await sql.query(`SELECT 1 FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
    WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.session_version=$3 AND u.email_verified
    FOR SHARE OF m,u`, [principal.tenant_id, principal.user_id, principal.session_version]);
  if (!member.rowCount) return false;
  const installation = await getOAuthInstallation(sql, principal.tenant_id, principal.user_id, principal.grant_id);
  if (installation) return !installation.revoked_at && installation.client_id === principal.client_id &&
    installation.active_grant_id === (principal.credential_id ?? principal.grant_id) &&
    installation.active_session_version === principal.session_version && scopes.includes("triggers:read") &&
    installationScopes(installation).includes("triggers:read");
  if (principal.credential_id && principal.credential_id !== principal.grant_id) return false;
  const { rows: [policy] } = await sql.query<ConnectionScopePolicy & { revoked_at: Date | null }>(
    `SELECT revoked_at,disabled_scopes,scope_overrides FROM app.agent_identities
     WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3 FOR SHARE`,
    [principal.tenant_id, principal.grant_id, principal.user_id],
  );
  return !policy?.revoked_at && applyConnectionScopes(scopes, policy).includes("triggers:read");
}


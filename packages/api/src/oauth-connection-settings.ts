import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";

export type ConnectionScopePolicy = { disabled_scopes: string[]; scope_overrides: string[] | null };

export function applyConnectionScopes(credentialScopes: string[], policy?: ConnectionScopePolicy): string[] {
  // Connection policy can narrow a credential but cannot confer scopes on it.
  const allowed = policy?.scope_overrides == null ? null : new Set(policy.scope_overrides);
  const disabled = new Set(policy?.disabled_scopes);
  return credentialScopes.filter(scope => (allowed === null || allowed.has(scope)) && !disabled.has(scope));
}

export async function effectiveConnectionScopes(env: Env, auth: OAuthProps, credentialScopes: string[]): Promise<string[]> {
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId) return credentialScopes;
  const { rows } = await databaseFor(env).pool.query<ConnectionScopePolicy>(
    "SELECT disabled_scopes,scope_overrides FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3",
    [auth.tenantId, auth.oauthGrantId, auth.userId],
  );
  return applyConnectionScopes(credentialScopes, rows[0]);
}

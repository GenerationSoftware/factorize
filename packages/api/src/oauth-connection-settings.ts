import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";

export async function effectiveConnectionScopes(env: Env, auth: OAuthProps, grantScopes: string[] = auth.scopes): Promise<string[]> {
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId) return grantScopes;
  const { rows } = await databaseFor(env).pool.query<{ disabled_scopes: string[]; scope_overrides: string[] | null }>(
    "SELECT disabled_scopes,scope_overrides FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3",
    [auth.tenantId, auth.oauthGrantId, auth.userId],
  );
  const policy = rows[0];
  const effective = policy?.scope_overrides ?? grantScopes;
  return effective.filter(scope => !policy?.disabled_scopes.includes(scope));
}

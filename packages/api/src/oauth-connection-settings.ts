import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";

export async function disabledConnectionScopes(env: Env, auth: OAuthProps): Promise<string[]> {
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId) return [];
  const { rows } = await databaseFor(env).pool.query<{ disabled_scopes: string[] }>(
    "SELECT disabled_scopes FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3",
    [auth.tenantId, auth.oauthGrantId, auth.userId],
  );
  return rows[0]?.disabled_scopes ?? [];
}

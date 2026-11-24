import type { GrantSummary, AuthRequest } from "@cloudflare/workers-oauth-provider";
import { integrationScopePattern } from "./agent-api-contracts";
import { normalizeScopes } from "./access-tokens";
import { databaseFor } from "./postgres/database";
import { matchesRegisteredRedirect } from "./oauth-continuation";
import type { Env } from "./types";
import type { Session } from "./session";

type ReconnectPolicy = {
  subject: string;
  disabled_scopes: string[];
  scope_overrides: string[] | null;
  integration_overrides: Record<string, string | false>;
  revoked_at: Date | null;
};

export function initialIntegrationOverrides(ids: unknown): Record<string, false> {
  return Object.fromEntries(Array.isArray(ids) ? ids.filter((id): id is string =>
    typeof id === "string" && integrationScopePattern.test(`integration:${id}:1`)).map(id => [id, false]) : []);
}

export function integrationForScope(scope: string) {
  return integrationScopePattern.exec(scope)?.[1];
}

export async function reconnectPreferences(env: Env, session: Session, request: AuthRequest) {
  if (!env.OAUTH_PROVIDER) return null;
  const grants: GrantSummary[] = [];
  const now = Math.floor(Date.now() / 1000);
  let cursor: string | undefined;
  // A URL client ID may be shared across multiple client installations. Keep
  // its defaults tied to the same exact redirect as the provider does.
  const exactRedirect = /^https?:\/\//.test(request.clientId);
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(session.userId, { cursor, limit: 100 });
    grants.push(...page.items.filter(grant =>
      grant.userId === session.userId && grant.clientId === request.clientId &&
      grant.metadata?.tenantId === session.tenantId && (!grant.expiresAt || grant.expiresAt > now) &&
      (exactRedirect ? grant.redirectUri === request.redirectUri :
        !grant.redirectUri || matchesRegisteredRedirect(request.redirectUri, [grant.redirectUri])),

    ));
    cursor = page.cursor;
  } while (cursor);
  if (!grants.length) return null;
  const { rows } = await databaseFor(env).pool.query<ReconnectPolicy>(
    `SELECT subject,disabled_scopes,scope_overrides,integration_overrides,revoked_at
     FROM app.agent_identities WHERE tenant_id=$1 AND user_id=$2 AND kind='oauth' AND subject=ANY($3)`,
    [session.tenantId, session.userId, grants.map(grant => grant.id)],
  );
  const policies = new Map(rows.map(row => [row.subject, row]));
  const grant = grants.sort((a, b) => b.createdAt-a.createdAt || b.id.localeCompare(a.id))
    .find(item => !policies.get(item.id)?.revoked_at);
  if (!grant) return null;
  const policy = policies.get(grant.id);
  const overrides = policy?.integration_overrides ?? initialIntegrationOverrides(grant.metadata?.initialIntegrationDenials);
  return {
    preferredScopes: normalizeScopes(policy?.scope_overrides ?? grant.scope).filter(scope => {
      const integration = integrationForScope(scope);
      return !policy?.disabled_scopes.includes(scope) && (!integration || overrides[integration] !== false);
    }),
    deniedIntegrations: Object.keys(overrides).filter(id => overrides[id] === false),
  };
}

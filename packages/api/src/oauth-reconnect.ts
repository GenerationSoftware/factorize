import type { GrantSummary, AuthRequest } from "@cloudflare/workers-oauth-provider";
import { connectionAccess, requiredIntegrationScope, type AgentIntegration } from "./agent-integration-access";
import { integrationScopePattern } from "./agent-api-contracts";
import { normalizeScopes } from "./access-tokens";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { matchesRegisteredRedirect } from "./oauth-continuation";
import type { Env } from "./types";
import type { Session } from "./session";

type ReconnectPolicy = {
  subject: string;
  disabled_scopes: string[];
  scope_overrides: string[] | null;
  integration_overrides: Record<string, string | false>;
  revoked_at: Date | null;
  permissions_revision: number;
};

export function initialIntegrationOverrides(ids: unknown): Record<string, false> {
  return Object.fromEntries(Array.isArray(ids) ? ids.filter((id): id is string =>
    typeof id === "string" && integrationScopePattern.test(`integration:${id}:1`)).map(id => [id, false]) : []);
}

export function integrationForScope(scope: string) {
  return integrationScopePattern.exec(scope)?.[1];
}

export type ReconnectRevision = { grantId: string; revision: number; ambiguous: boolean };

export async function lockOAuthPolicy(db: DatabaseClient, session: Pick<Session, "tenantId" | "userId">) {
  // Consent does not have a grant ID yet. Use the owner/team key shared with
  // permission edits and revocation, including before an identity row exists.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`oauth-policy:${session.tenantId}:${session.userId}`]);
}

export async function reconnectPreferences(env: Env, session: Session, request: AuthRequest, db?: DatabaseClient) {
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
  const { rows } = await (db ?? databaseFor(env).pool).query<ReconnectPolicy>(
    `SELECT subject,disabled_scopes,scope_overrides,integration_overrides,revoked_at,permissions_revision
     FROM app.agent_identities WHERE tenant_id=$1 AND user_id=$2 AND kind='oauth' AND subject=ANY($3)`,
    [session.tenantId, session.userId, grants.map(grant => grant.id)],
  );
  const policies = new Map(rows.map(row => [row.subject, row]));
  const candidates = grants.filter(item => !policies.get(item.id)?.revoked_at)
    .sort((a, b) => Number(b.redirectUri === request.redirectUri) - Number(a.redirectUri === request.redirectUri)
      || b.createdAt-a.createdAt || b.id.localeCompare(a.id));
  const grant = candidates[0];
  if (!grant) return null;
  // Standard OAuth cannot identify the originating grant among equally
  // matching copies. Retain the existing single-grant preference behavior,
  // but never infer additional baseline access in the ambiguous case.
  const exact = grant.redirectUri === request.redirectUri;
  const unambiguous = candidates.filter(item => (item.redirectUri === request.redirectUri) === exact).length === 1;
  const policy = policies.get(grant.id);
  const overrides = policy?.integration_overrides ?? initialIntegrationOverrides(grant.metadata?.initialIntegrationDenials);
  const original = normalizeScopes(grant.scope);
  const scopes = normalizeScopes(policy?.scope_overrides ?? original);
  const disabled = policy?.disabled_scopes ?? [];
  const preferred = scopes.filter(scope => {
    const integration = integrationForScope(scope);
    return !disabled.includes(scope) && (!integration || overrides[integration] !== false);
  });
  const granted = new Set(preferred.filter(scope => original.includes(scope)));
  // Existing baseline-only access and an explicit legacy override were not
  // always encoded in grant.scope. Carry that access forward only for this
  // exact legacy policy, never from the workspace defaults.
  if (unambiguous && granted.has("proxy:use") && grant.metadata?.explicitIntegrationScopes !== true) {
    const integrations = (await (db ?? databaseFor(env).pool).query<AgentIntegration>(
      "SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND available=true", [session.tenantId],
    )).rows;
    for (const row of integrations) {
      const scope = requiredIntegrationScope(row);
      if (!disabled.includes(scope) && connectionAccess(row, [...granted], { disabled_scopes: disabled, integration_overrides: overrides }) === "granted") {
        preferred.push(scope);
        granted.add(scope);
      }
    }
  }
  return {
    version: { grantId: grant.id, revision: policy?.permissions_revision ?? 0, ambiguous: !unambiguous } satisfies ReconnectRevision,
    preferredScopes: [...new Set(preferred)],
    grantedScopes: [...granted],
    deniedIntegrations: Object.keys(overrides).filter(id => overrides[id] === false),
  };
}

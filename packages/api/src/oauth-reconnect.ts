import { integrationScopePattern } from "./proxy/api/agent-api-contracts";
import type { DatabaseClient } from "./postgres/database";
import type { Session } from "./session";

export function initialIntegrationOverrides(ids: unknown): Record<string, false> {
  return Object.fromEntries(Array.isArray(ids) ? ids.filter((id): id is string =>
    typeof id === "string" && integrationScopePattern.test(`integration:${id}:1`)).map(id => [id, false]) : []);
}

export function integrationForScope(scope: string) {
  return integrationScopePattern.exec(scope)?.[1];
}

export async function lockOAuthPolicy(db: DatabaseClient, session: Pick<Session, "tenantId" | "userId">) {
  // Consent does not have a grant ID yet. Use the owner/team key shared with
  // permission edits and revocation, including before an identity row exists.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`oauth-policy:${session.tenantId}:${session.userId}`]);
}

import { AGENT_SCOPES } from "./access-tokens";
import { connectionAccess, requiredIntegrationScope, type AgentIntegration } from "./agent-integration-access";
import { integrationScopePattern } from "./agent-api-contracts";
import { AgentApiError } from "./agent-api-error";
import type { Database, DatabaseClient } from "./postgres/database";
import type { OAuthProps } from "./types";
import { initialIntegrationOverrides } from "./oauth-reconnect";
import { z } from "zod";

export const vmPermissionSource = z.strictObject({ scopes: z.array(z.string().min(1).max(200)).max(100) });
export type VmPermissionSource = z.infer<typeof vmPermissionSource>;
type VmPermissionSnapshot = { scopes: string[]; presetId: string | null };

const forbidden = () => new AgentApiError(403, "forbidden", "A requested VM permission exceeds your effective access.");
const standardScopes: ReadonlySet<string> = new Set(AGENT_SCOPES);

async function integrationPolicies(db: DatabaseClient, tenantId: string, scopes: readonly string[]) {
  const ids = scopes.flatMap(scope => {
    const match = integrationScopePattern.exec(scope);
    return match ? [match[1]] : [];
  });
  const { rows } = ids.length
    ? await db.query<AgentIntegration>(
      "SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [tenantId, ids],
    )
    : { rows: [] };
  return new Map(rows.map(row => [requiredIntegrationScope(row), row]));
}

export async function resolveVmPermissions(db: DatabaseClient, auth: OAuthProps, input: VmPermissionSource) {
  const source = vmPermissionSource.parse(input);
  const now = Date.now() / 1000;
  if ((auth.authMethod === "oauth" && (!auth.oauthExpiresAt || auth.oauthExpiresAt <= now)) ||
      (auth.authMethod === "vm" && (!auth.vmTokenExpiresAt || auth.vmTokenExpiresAt <= now))) throw forbidden();
  const { scopes: selected } = source;

  const policy = auth.authMethod === "oauth" && auth.oauthGrantId
    ? (await db.query<{ disabled_scopes: string[]; integration_overrides: Record<string, string | false>; scope_overrides: string[] | null; revoked_at: Date | null }>(
      "SELECT disabled_scopes,integration_overrides,scope_overrides,revoked_at FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3 FOR SHARE",
      [auth.tenantId, auth.oauthGrantId, auth.userId],
    )).rows[0]
    : undefined;
  if (policy?.revoked_at) throw forbidden();

  const vmScopes = auth.authMethod === "vm"
    ? (await db.query<{ scopes: string[] }>(
      `SELECT scopes FROM app.vm_permission_grants WHERE tenant_id=$1 AND id=$2
       AND activated_at IS NOT NULL AND revoked_at IS NULL FOR SHARE`,
      [auth.tenantId, auth.vmGrantId],
    )).rows[0]?.scopes ?? []
    : undefined;
  const disabled = new Set(policy?.disabled_scopes);
  const effective = new Set(auth.scopes.filter(scope =>
    !disabled.has(scope) && (policy?.scope_overrides == null || policy.scope_overrides.includes(scope))
    && (vmScopes === undefined || vmScopes.includes(scope))));
  if (!effective.has("vms:edit")) throw forbidden();

  const scopes = [...new Set(selected)];
  const integrations = await integrationPolicies(db, auth.tenantId, scopes);
  for (const scope of scopes) {
    if (disabled.has(scope)) throw forbidden();
    if (standardScopes.has(scope)) {
      if (!effective.has(scope)) throw forbidden();
      continue;
    }
    const integration = integrations.get(scope);
    if (!integration || !integration.available || integration.policy === "disabled" || !effective.has("proxy:use")) throw forbidden();
    if (auth.authMethod === "oauth") {
      if (connectionAccess(integration, [...effective], policy ?? { disabled_scopes: [], integration_overrides: initialIntegrationOverrides(auth.initialIntegrationDenials) }, auth.explicitIntegrationScopes) !== "granted") throw forbidden();
    } else if (!effective.has(scope)) {
      throw forbidden();
    }
  }
  return { scopes, presetId: null };
}

export async function currentVmScopes(db: DatabaseClient, tenantId: string, snapshot: string[]): Promise<string[]> {
  const integrations = await integrationPolicies(db, tenantId, snapshot);
  return snapshot.filter(scope => {
    if (standardScopes.has(scope)) return true;
    const integration = integrations.get(scope);
    return Boolean(integration?.available && integration.policy !== "disabled");
  });
}

export async function writeVmPermissionSnapshot<T>(
  database: Database,
  auth: OAuthProps,
  source: VmPermissionSource,
  write: (db: DatabaseClient, snapshot: VmPermissionSnapshot) => Promise<T>,
) {
  return database.transaction(async db => {
    const snapshot = await resolveVmPermissions(db, auth, source);
    return write(db, snapshot);
  });
}

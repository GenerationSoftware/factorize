import type { DatabaseClient } from "../../postgres/database";

const scopePrefix = (id: string) => `integration:${id}:`;
const scopeMatches = (column: string, parameter = "$3") => `EXISTS (SELECT 1 FROM unnest(${column}) s WHERE starts_with(s,${parameter}))`;
const stripScopes = (column: string, parameter = "$3") => `ARRAY(SELECT s FROM unnest(${column}) WITH ORDINALITY v(s,n) WHERE NOT starts_with(s,${parameter}) ORDER BY n)`;

type AccessClient = { id: string; name: string };
type AccessWorkload = { id: string; name: string; revoked: boolean };
type AccessSnapshot = {
  clients: AccessClient[];
  workloads: AccessWorkload[];
  evidence: {
    installations: Array<{ id: string; name: string; revision: number; revoked: boolean }>;
    issuances: Array<{ id: string; installationId: string; name: string; revision: number }>;
    legacy: Array<{ id: string; name: string; revision: number; revoked: boolean }>;
    workloads: Array<AccessWorkload & { revision: number; active: boolean; provider: boolean }>;
    baseline: string[];
  };
};

/** Local state only. Legacy grants in the provider are not enumerated; their
 * implicit access is cut off by the removed registration and baseline scope. */
export async function inspectIntegrationAccess(sql: DatabaseClient, tenantId: string, registrationId: string): Promise<AccessSnapshot> {
  const params = [tenantId, registrationId, scopePrefix(registrationId)];
  const { rows } = await sql.query<AccessSnapshot["evidence"]>(`
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM (
        SELECT id, COALESCE(display_name,client_id) AS name, policy_revision AS revision, revoked_at IS NOT NULL AS revoked
        FROM app.oauth_installations
        WHERE tenant_id=$1 AND (${scopeMatches("selected_scopes")} OR ${scopeMatches("active_scopes")} OR ${scopeMatches("legacy_implicit_scopes")})
      ) i),'[]') AS installations,
      COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM (
        SELECT p.id, p.installation_id AS "installationId", COALESCE(i.display_name,i.client_id) AS name, p.expected_revision AS revision
        FROM app.oauth_installation_issuances p
        JOIN app.oauth_installations i ON (i.tenant_id,i.user_id,i.id)=(p.tenant_id,p.user_id,p.installation_id)
        WHERE p.tenant_id=$1 AND p.consumed_at IS NULL AND p.expires_at>statement_timestamp()
          AND (${scopeMatches("p.selected_scopes")} OR ${scopeMatches("p.credential_scopes")})
      ) p),'[]') AS issuances,
      COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM (
        SELECT subject AS id, COALESCE(display_name,subject) AS name, permissions_revision AS revision, revoked_at IS NOT NULL AS revoked
        FROM app.agent_identities
        WHERE tenant_id=$1 AND kind='oauth' AND (integration_overrides ? $2::text OR ${scopeMatches("scope_overrides")} OR ${scopeMatches("disabled_scopes")})
      ) l),'[]') AS legacy,
      COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM (
        SELECT id, CASE WHEN vm_app='' THEN vm ELSE vm_app || ' / ' || vm END AS name, revision,
          revoked_at IS NULL AND provider_id=$2::uuid AS revoked,
          revoked_at IS NULL AS active, provider_id=$2::uuid AS provider
        FROM app.vm_permission_grants WHERE tenant_id=$1 AND (provider_id=$2::uuid OR ${scopeMatches("scopes")})
      ) v),'[]') AS workloads,
      COALESCE((SELECT jsonb_agg(scope ORDER BY scope) FROM app.oauth_legacy_baselines WHERE tenant_id=$1 AND starts_with(scope,$3)),'[]') AS baseline
  `, params);
  const evidence = rows[0]!;
  const clients = new Map<string, AccessClient>();
  for (const {id,name,revoked} of evidence.legacy) if (!revoked) clients.set(id,{id,name});
  for (const {id,name,revoked} of evidence.installations) if (!revoked) clients.set(id,{id,name});
  for (const {installationId:id,name} of evidence.issuances) clients.set(id,{id,name});
  return { clients: [...clients.values()].sort((a,b) => a.id.localeCompare(b.id)),
    workloads: evidence.workloads.filter(row=>row.active).map(({id,name,revoked})=>({id,name,revoked})), evidence };
}

/** Caller holds the integration-topology lock through impact comparison,
 * credential invalidation and this cleanup. Historical VM grants retain a
 * restrictive provider FK; keep a non-authorizing tombstone when necessary. */
export async function removeIntegrationAccess(sql: DatabaseClient, tenantId: string, registrationId: string, _impact: AccessSnapshot) {
  const params = [tenantId, registrationId, scopePrefix(registrationId)];
  await sql.query(`UPDATE app.oauth_installations SET selected_scopes=${stripScopes("selected_scopes","$2")},
      active_scopes=${stripScopes("active_scopes","$2")},legacy_implicit_scopes=${stripScopes("legacy_implicit_scopes","$2")},
      policy_revision=policy_revision+1
    WHERE tenant_id=$1 AND (${scopeMatches("selected_scopes","$2")} OR ${scopeMatches("active_scopes","$2")} OR ${scopeMatches("legacy_implicit_scopes","$2")})`,[tenantId,scopePrefix(registrationId)]);
  await sql.query(`UPDATE app.oauth_installation_issuances SET selected_scopes=${stripScopes("selected_scopes","$2")},
      credential_scopes=${stripScopes("credential_scopes","$2")}
    WHERE tenant_id=$1 AND consumed_at IS NULL AND (${scopeMatches("selected_scopes","$2")} OR ${scopeMatches("credential_scopes","$2")})`,[tenantId,scopePrefix(registrationId)]);
  await sql.query(`UPDATE app.agent_identities SET
      scope_overrides=CASE WHEN scope_overrides IS NULL THEN NULL ELSE ${stripScopes("scope_overrides")} END,
      disabled_scopes=${stripScopes("disabled_scopes")},integration_overrides=integration_overrides - $2::text,
      permissions_revision=permissions_revision+1
    WHERE tenant_id=$1 AND kind='oauth' AND (integration_overrides ? $2::text OR ${scopeMatches("scope_overrides")} OR ${scopeMatches("disabled_scopes")})`,params);
  await sql.query("DELETE FROM app.oauth_legacy_baselines WHERE tenant_id=$1 AND starts_with(scope,$2)",[tenantId,scopePrefix(registrationId)]);
  await sql.query(`UPDATE app.vm_permission_grants SET scopes=${stripScopes("scopes")},
      revoked_at=CASE WHEN provider_id=$2::uuid THEN COALESCE(revoked_at,now()) ELSE revoked_at END,
      cleaned_at=CASE WHEN provider_id=$2::uuid AND revoked_at IS NULL AND provider_kind='fly' THEN now() ELSE cleaned_at END,
      revision=revision+1,updated_at=now(),updated_by='system:integration-removed'
    WHERE tenant_id=$1 AND ((provider_id=$2::uuid AND revoked_at IS NULL) OR ${scopeMatches("scopes")})`,params);
  const {rows} = await sql.query<{ referenced: boolean }>("SELECT EXISTS(SELECT 1 FROM app.vm_permission_grants WHERE tenant_id=$1 AND provider_id=$2) AS referenced",[tenantId,registrationId]);
  return { needsTombstone: Boolean(rows[0]?.referenced) };
}

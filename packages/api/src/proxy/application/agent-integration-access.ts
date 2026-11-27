import { integrationScopePattern } from "../../access-control/domain/scopes";

export type AgentIntegration = {id: string; kind: "bearer" | "model" | "github" | "linear" | "fly" | "exe" | "amp" | "clickup" | "x" | "cloudflare"; credential_id: string; name: string; description: string | null; available: boolean; policy: "baseline" | "requestable" | "disabled"; epoch: number; revision: number};
export const requiredIntegrationScope = (row: AgentIntegration) => `integration:${row.id}:${row.epoch}`;
type IntegrationPermission = { kind: AgentIntegration["kind"]; requiredScope: string };
export function sameOAuthIntegrationPermission(integration: IntegrationPermission, scope: string) {
  if (scope === integration.requiredScope) return true;
  if (integration.kind !== "cloudflare") return false;
  const current = integrationScopePattern.exec(integration.requiredScope);
  const held = integrationScopePattern.exec(scope);
  return !!current && !!held && current[1] === held[1] && Number(held[2]) < Number(current[2]);
}

export function currentOAuthIntegrationScopes(scopes: readonly string[], integrations: readonly IntegrationPermission[]) {
  return [...new Set(scopes.map(scope => integrations.find(row => sameOAuthIntegrationPermission(row, scope))?.requiredScope ?? scope))];
}

export type ConnectionPolicy = { integration_overrides: Record<string, string | false>; disabled_scopes: string[] };
export function connectionAccess(row: AgentIntegration, scopes: string[], policy: ConnectionPolicy, explicitIntegrationScopes = false, liveOAuthInstallation = false) {
  const scope = requiredIntegrationScope(row);
  const matches = (held: string) => held === scope || liveOAuthInstallation &&
    sameOAuthIntegrationPermission({ kind: row.kind, requiredScope: scope }, held);
  if (policy.disabled_scopes.includes("proxy:use") || policy.disabled_scopes.some(matches) || policy.integration_overrides[row.id] === false || row.policy === "disabled" || !row.available) return "blocked";
  return scopes.some(matches) || (!explicitIntegrationScopes && (row.policy === "baseline" || policy.integration_overrides[row.id] === scope)) ? "granted" : "requestable";
}

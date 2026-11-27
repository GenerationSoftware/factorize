export type AgentIntegration = {id: string; kind: "bearer" | "model" | "github" | "linear" | "fly" | "exe" | "amp" | "clickup" | "x" | "cloudflare"; credential_id: string; name: string; description: string | null; available: boolean; policy: "baseline" | "requestable" | "disabled"; epoch: number; revision: number};
export const requiredIntegrationScope = (row: AgentIntegration) => `integration:${row.id}:${row.epoch}`;
export type ConnectionPolicy = { integration_overrides: Record<string, string | false>; disabled_scopes: string[] };
export function connectionAccess(row: AgentIntegration, scopes: string[], policy: ConnectionPolicy, explicitIntegrationScopes = false) {
  const scope = requiredIntegrationScope(row);
  if (policy.disabled_scopes.includes("proxy:use") || policy.disabled_scopes.includes(scope) || policy.integration_overrides[row.id] === false || row.policy === "disabled" || !row.available) return "blocked";
  return scopes.includes(scope) || (!explicitIntegrationScopes && (row.policy === "baseline" || policy.integration_overrides[row.id] === scope)) ? "granted" : "requestable";
}

export const integrationScopePattern = /^integration:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,9})$/;
export const isIntegrationScope = (scope: string) => integrationScopePattern.test(scope);

export const ACCESS_SCOPES = ["team:read", "team:write", "triggers:read", "triggers:write", "integrations:read", "integrations:write", "vms:read", "vms:edit"] as const;
export const AGENT_SCOPES = [...ACCESS_SCOPES, "proxy:use", "apps:manage"] as const;
export type AccessScope = typeof ACCESS_SCOPES[number];
export function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.filter(scope => (AGENT_SCOPES as readonly string[]).includes(scope) || isIntegrationScope(scope)))];
}

export function integrationForScope(scope: string) {
  return integrationScopePattern.exec(scope)?.[1];
}

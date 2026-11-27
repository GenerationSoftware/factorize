import { AGENT_SCOPES, integrationForScope, normalizeScopes } from "./scopes";

export const permissionKey = (scope: string) => {
  const integration = integrationForScope(scope);
  return integration ? "integration:" + integration : scope;
};

export function selectedTeamDefaults(scopes: string[], preferences: ReadonlyMap<string, boolean>) {
  return normalizeScopes(scopes).filter(scope => preferences.get(permissionKey(scope)) === true);
}

export const standardPermissions: readonly string[] = AGENT_SCOPES;

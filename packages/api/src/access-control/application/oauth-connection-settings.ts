export type ConnectionScopePolicy = { disabled_scopes: string[]; scope_overrides: string[] | null };

export function applyConnectionScopes(credentialScopes: string[], policy?: ConnectionScopePolicy): string[] {
  // Connection policy can narrow a credential but cannot confer scopes on it.
  const allowed = policy?.scope_overrides == null ? null : new Set(policy.scope_overrides);
  const disabled = new Set(policy?.disabled_scopes);
  return credentialScopes.filter(scope => (allowed === null || allowed.has(scope)) && !disabled.has(scope));
}

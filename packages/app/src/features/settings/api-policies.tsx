import { createContext, useContext, type ReactNode } from "react";
import { DefaultCheckbox, useTeamPermissions } from "./permissions";

const Context = createContext<Pick<ReturnType<typeof useTeamPermissions>, "data" | "isPending"> | null>(null);
export function IntegrationPoliciesProvider({children}: {children: ReactNode}) {
  const { data, isPending, error } = useTeamPermissions();
  return <Context.Provider value={{ data, isPending }}>
    {error && <p role="alert">Team permissions: {error.message}</p>}
    {children}
  </Context.Provider>;
}

export function IntegrationDefaultPrompt() {
  const query = useContext(Context);
  if (!query?.data?.some(row => row.integrationId && row.available && !row.preferenceSet)) return null;
  return <p className="mb-3 text-sm">Make a new integration available by default? Check its box below to preselect it during consent. This does not grant access.</p>;
}

export function IntegrationPolicy({kind, credentialId, name}: {kind: string; credentialId: string; name: string}) {
  const query = useContext(Context);
  const row = query?.data?.find(row => row.kind === kind && row.credentialId === credentialId);
  if (row) return <DefaultCheckbox key={row.scope} row={row} name={name} />;
  if (kind === "tail") return <span className="text-xs text-slate-600 dark:text-slate-400">Inbound webhook</span>;
  if (query?.isPending) return <span aria-label="Loading default" role="status">…</span>;
  return <span className="text-xs text-slate-600 dark:text-slate-400" aria-label="Default not available">—</span>;
}

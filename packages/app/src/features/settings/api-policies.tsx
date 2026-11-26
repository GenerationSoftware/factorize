import { createContext, useContext, useEffect, type ReactNode } from "react";
import { PermissionChoice, useTeamPermissions } from "./permissions";

const Context = createContext<ReturnType<typeof useTeamPermissions> | null>(null);
export function IntegrationPoliciesProvider({children}: {children: ReactNode}) {
  const settings = useTeamPermissions();
  return <Context.Provider value={settings}>{settings.query.error && <p role="alert">Team permissions: {settings.query.error.message}</p>}{children}</Context.Provider>;
}

export function IntegrationPolicy({kind, credentialId}: {kind: string; credentialId: string}) {
  const settings = useContext(Context);
  const row = settings?.query.data?.find(row => row.kind === kind && row.credentialId === credentialId);
  const refetch = settings?.query.refetch;
  const loaded = !!settings?.query.data;
  // A provider may finish adding a connection on this page without
  // invalidating the team list it did not know about.
  useEffect(() => {
    if (loaded && !row && kind !== "tail") void refetch?.();
  }, [loaded, !!row, kind, credentialId, refetch]);
  if (kind === "tail") return <span className="text-xs text-slate-500">Inbound webhook</span>;
  if (!settings || settings.query.isPending || !row) return null;
  return <div className="text-xs">
    {!row.preferenceSet && row.available && <p>Make this integration a default for new connections? This only preselects it during consent; it does not grant access.</p>}
    <PermissionChoice row={row} settings={settings} />
  </div>;
}

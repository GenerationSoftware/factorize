import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { Button, Input, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { clientsQuery } from "./queries";
export type AuthorizedClient = paths["/api/v1/access/authorized-clients"]["get"]["responses"][200]["content"]["application/json"][number];
export function ClientPermissions({ client, close }: { client: AuthorizedClient; close: () => void }) {
  const cache = useQueryClient();
  const [allowed, setAllowed] = useState(() => client.availableScopes.filter(scope => client.scopes.includes(scope)));
  const save = useMutation({ retry: false, mutationFn: async () => {
    const { error } = await api.PUT("/api/v1/access/authorizations/{grantId}/permissions", { params: { path: { grantId: client.grantId } }, body: { scopes: allowed, expectedRevision: client.revision } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: close, onSettled: () => cache.invalidateQueries({ queryKey: clientsQuery.queryKey }) });
  return <Dialog title={`Permissions for ${client.clientName}`} close={close}><p className="mb-3 text-sm">Changes take effect as soon as you save.</p><fieldset className="grid gap-2"><legend>Agent API scopes</legend>{client.availableScopes.map(scope => <Label key={scope}><Input type="checkbox" checked={allowed.includes(scope)} onChange={event => setAllowed(event.target.checked ? [...allowed, scope] : allowed.filter(value => value !== scope))} />{client.scopeLabels[scope] ?? scope}</Label>)}</fieldset>{save.error && <p role="alert">{save.error.message}</p>}<Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save permissions</Button></Dialog>;
}

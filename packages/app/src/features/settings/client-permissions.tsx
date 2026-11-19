import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { Button, Input, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { clientsQuery } from "./queries";

export type AuthorizedClient = paths["/api/v1/access/authorized-clients"]["get"]["responses"][200]["content"]["application/json"][number];

export function ClientPermissions({client, close}: {client: AuthorizedClient; close: () => void}) {
  const cache = useQueryClient();
  const [disabled, setDisabled] = useState(() => client.availableScopes.filter(scope => !client.scopes.includes(scope)));
  const [overrides, setOverrides] = useState(client.integrationOverrides);
  const policies = useQuery({queryKey: ["settings", "api-policies"], queryFn: async ({signal}) => {
    const {data, error} = await api.GET("/api/v1/integration-api-policies", {signal});
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }});
  const integrations = policies.data?.integrations.filter(row => row.available && row.policy !== "disabled");
  const save = useMutation({retry: false, mutationFn: async () => {
    const integrationOverrides = Object.fromEntries((policies.data?.integrations ?? []).flatMap(row => {
      const approval = overrides[row.id];
      return (row.available && row.policy !== "disabled" && approval === row.requiredScope) || approval === false ? [[row.id, approval] as const] : [];
    }));
    const {error} = await api.PUT("/api/v1/access/authorizations/{grantId}/permissions", {
      params: {path: {grantId: client.grantId}}, body: {disabledScopes: disabled, integrationOverrides, expectedRevision: client.revision},
    });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: close, onSettled: () => cache.invalidateQueries({queryKey: clientsQuery.queryKey})});
  return <Dialog title={`Permissions for ${client.clientName}`} close={close}>
    <fieldset disabled={save.isPending}><legend className="font-semibold">OAuth scopes</legend>
      {client.availableScopes.map(scope => <Label key={scope} className="flex items-center gap-2"><Input type="checkbox" checked={!disabled.includes(scope)} onChange={event => setDisabled(event.target.checked ? disabled.filter(value => value !== scope) : [...disabled, scope])} />{scope}</Label>)}
      {client.availableScopes.length === 0 && <p>No Factorize scopes authorized.</p>}
    </fieldset>
    <fieldset className="my-4" disabled={save.isPending}><legend className="font-semibold">Integration access</legend>
      {policies.isPending && <p role="status">Loading integrations…</p>}
      {policies.error && <p role="alert">{policies.error.message}</p>}
      {integrations?.length === 0 && <p>No integrations available.</p>}
      {integrations?.map(row => <Label key={row.id}>{row.name}<Select value={overrides[row.id] === row.requiredScope ? "allow" : overrides[row.id] === false ? "block" : "default"} onChange={event => {
        const next = {...overrides}, value = event.target.value;
        if (value === "default") delete next[row.id];
        else next[row.id] = value === "allow" ? row.requiredScope : false;
        setOverrides(next);
      }}><option value="default">Default ({row.policy === "baseline" || client.scopes.includes(row.requiredScope) ? "allowed" : "requires approval"})</option><option value="allow">Allow</option><option value="block">Block</option></Select></Label>)}
    </fieldset>
    {save.error && <p role="alert">{save.error.message}</p>}
    <Button variant="primary" disabled={!policies.isSuccess || save.isPending} onClick={() => save.mutate()}>Save permissions</Button>
  </Dialog>;
}

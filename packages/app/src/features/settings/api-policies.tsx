import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Card, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";

export function ApiPolicies() {
  const cache = useQueryClient();
  const policies = useQuery({queryKey:["settings","api-policies"],queryFn:async ({signal}) => {
    const {data,error} = await api.GET("/api/v1/integration-api-policies",{signal});
    if (!data || error) throw new Error(messageOf(error)); return data;
  }});
  const change = useMutation({retry:false,mutationFn:async (input:{id:string;revision:number;policy:"baseline"|"requestable"|"disabled"}) => {
    const {data,error} = await api.PUT("/api/v1/integration-api-policies/{integrationId}",{params:{path:{integrationId:input.id}},body:{policy:input.policy,expectedRevision:input.revision}});
    if (!data || error) throw new Error(messageOf(error)); return data;
  },onSuccess:data=>cache.setQueryData(["settings","api-policies"],data),onSettled:()=>cache.invalidateQueries({queryKey:["settings","api-policies"]})});
  return <section className="my-8" aria-labelledby="api-access-heading"><h2 id="api-access-heading" className="text-2xl font-bold">MCP API access</h2><p>Baseline APIs are available immediately to every connected MCP client. Requestable APIs require separate approval for each connection. Disabling access or disconnecting an integration invalidates its approvals; re-enabling requires fresh consent. Runs keep their own selected connections.</p>
    {policies.isPending && <p role="status">Loading API policies…</p>}
    {[policies.error,change.error].filter(Boolean).map((error,i)=><p role="alert" key={i}>{error?.message}</p>)}
    {policies.data?.integrations.map(row=><Card key={row.id} className="my-3"><Label className="flex items-center justify-between gap-3"><span>{row.name}{!row.available && " · Disconnected"}</span><select aria-label={`${row.name} MCP API access`} disabled={change.isPending} value={row.policy} onChange={event=>change.mutate({id:row.id,revision:row.revision,policy:event.target.value as "baseline"|"requestable"|"disabled"})}><option value="baseline">Baseline</option><option value="requestable">Requestable</option><option value="disabled">Disabled</option></select></Label>{row.description && <p>{row.description}</p>}</Card>)}
  </section>;
}

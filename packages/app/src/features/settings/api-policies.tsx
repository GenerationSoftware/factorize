import { createContext, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Input, Label, Select } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";

type Policy = {id: string; credentialId: string; kind: string; name: string; available: boolean; revision: number; policy: "baseline" | "requestable" | "disabled"};
const queryKey = ["settings", "api-policies"];
function usePolicies() {
  const cache = useQueryClient();
  const query = useQuery({queryKey, queryFn: async ({signal}) => {
    const {data,error} = await api.GET("/api/v1/integration-api-policies", {signal});
    if (!data || error) throw new Error(messageOf(error));
    if (!Array.isArray(data.integrations)) throw new Error("API access settings could not be loaded. Reload the page to try again.");
    return data;
  }});
  const change = useMutation({retry: false, mutationFn: async (input: {row: Policy; policy: Policy["policy"]}) => {
    const {data,error} = await api.PUT("/api/v1/integration-api-policies/{integrationId}", {params: {path: {integrationId: input.row.id}}, body: {policy: input.policy, expectedRevision: input.row.revision}});
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: data => cache.setQueryData(queryKey, data), onSettled: () => cache.invalidateQueries({queryKey})});
  // Read these fields in the subscribing component so context consumers receive query updates.
  return {query: {data: query.data, isPending: query.isPending, error: query.error}, change};
}
const PoliciesContext = createContext<ReturnType<typeof usePolicies> | null>(null);
export function IntegrationPoliciesProvider({children}: {children: ReactNode}) {
  const policies = usePolicies();
  return <PoliciesContext.Provider value={policies}>{policies.query.error && <p role="alert">MCP access settings: {policies.query.error.message}</p>}{children}</PoliciesContext.Provider>;
}
export function useIntegrationPolicy(kind: string, credentialId: string) {
  const context = useContext(PoliciesContext);
  const row = context?.query.data?.integrations.find(row => row.kind === kind && row.credentialId === credentialId);
  return {context, row};
}
export function IntegrationPolicy({kind, credentialId, name}: {kind: string; credentialId: string; name: string}) {
  const {context, row} = useIntegrationPolicy(kind, credentialId);
  const [desired, setDesired] = useState<boolean | null>(null);
  if (kind === "tail") return <span className="text-xs text-slate-500">Inbound webhook</span>;
  if (!context || context.query.isPending) return <span className="text-xs" role="status">Loading API access…</span>;
  if (!row) return <span className="text-xs text-slate-500">API access unavailable</span>;
  const current = context.change.variables?.row.id === row.id;
  const error = current ? context.change.error : null;
  return <div className="text-xs"><Label className="flex min-h-10 items-center gap-1 whitespace-nowrap"><Input type="checkbox" aria-label={`${name} available by default`} title="Available immediately to connected MCP clients. When unchecked, clients need approval. Trigger selections are independent." checked={desired ?? (row.policy === "baseline")} disabled={desired !== null || !row.available || row.policy === "disabled" || context.change.isPending} onChange={event => {const checked = event.target.checked; setDesired(checked); context.change.mutate({row, policy: checked ? "baseline" : "requestable"}, {onSettled: () => setDesired(null)});}} />Available by default</Label>{desired !== null && <p role="status">Saving API access…</p>}{row.policy === "disabled" && <p>MCP access disabled</p>}{error && <p role="alert" className="max-w-56 text-red-700 dark:text-red-400">{error.message}</p>}</div>;
}
export function PolicyDialog({kind, credentialId, close}: {kind: string; credentialId: string; close: () => void}) {
  const {context, row} = useIntegrationPolicy(kind, credentialId);
  if (!context || !row) return null;
  return <Dialog title={`${row.name} MCP access`} close={close}><p className="mb-4 text-sm">Default access applies to connected MCP clients. Requiring approval keeps existing approvals. Disabling access revokes approvals; enabling it again requires fresh consent. Trigger selections are independent.</p><Label>MCP access<Select disabled={context.change.isPending} value={row.policy} onChange={event => context.change.mutate({row, policy: event.target.value as Policy["policy"]})}><option value="baseline">Available by default</option><option value="requestable">Requires approval</option><option value="disabled">Disabled</option></Select></Label>{context.change.variables?.row.id === row.id && context.change.error && <p role="alert">{context.change.error.message}</p>}</Dialog>;
}

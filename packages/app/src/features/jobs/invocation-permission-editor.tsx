import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { selectorQuery } from "./editor-queries";
import { messageOf } from "../auth/session";

export function InvocationPermissionEditor({ triggerId }: { triggerId: string }) {
  const [search, setSearch] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const configured = useQuery({ queryKey: ["trigger-invocation-permissions", triggerId], queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/triggers/{triggerId}/invocation-permissions", { params: { path: { triggerId } }, signal });
    if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  useEffect(() => { if (configured.data) setSelected(configured.data.destinationTriggerIds); }, [configured.data]);
  const triggers = useQuery(selectorQuery(search));
  const save = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.PUT("/api/v1/triggers/{triggerId}/invocation-permissions", { params: { path: { triggerId } }, body: { destinationTriggerIds: selected } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: value => { setSelected(value.destinationTriggerIds); void configured.refetch(); } });
  return <section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-slate-700">
    <h3 className="font-semibold">Manual invocation permissions</h3>
    <p className="text-sm text-slate-600 dark:text-slate-400">Choose triggers in this team that this trigger may manually invoke during a run. Lifecycle events are managed separately.</p>
    <Label>Search destination triggers <Input value={search} maxLength={120} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => setSearch(event.target.value)} /></Label>
    {configured.isPending && <p role="status">Loading permissions…</p>}{configured.error && <p role="alert">{configured.error.message}</p>}
    {triggers.isPending && <p role="status">Loading triggers…</p>}{triggers.error && <p role="alert">{triggers.error.message}</p>}
    <Label className="block"><Input type="checkbox" checked={selected.includes(triggerId)} onChange={event => setSelected(event.target.checked ? [...selected, triggerId] : selected.filter(id => id !== triggerId))} /> Current trigger (allow this trigger to invoke itself)</Label>
    {triggers.data?.items.filter(trigger => trigger.id !== triggerId).map(trigger => <Label key={trigger.id} className="block"><Input type="checkbox" checked={selected.includes(trigger.id)} onChange={event => setSelected(event.target.checked ? [...selected, trigger.id] : selected.filter(id => id !== trigger.id))} /> {trigger.name}</Label>)}
    <Button type="button" disabled={save.isPending || configured.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save permissions"}</Button>
    {save.error && <p role="alert">{save.error.message}</p>}
    {save.isSuccess && <p role="status">Manual invocation permissions saved.</p>}
  </section>;
}

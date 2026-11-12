import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { selectorQuery } from "./editor-queries";
import { messageOf } from "../auth/session";

export function InvocationPermissionEditor({ jobId, projectId }: { jobId: string; projectId: string }) {
  const [search, setSearch] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const configured = useQuery({ queryKey: ["job-invocation-permissions", jobId], queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}/invocation-permissions", { params: { path: { jobId } }, signal });
    if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  useEffect(() => { if (configured.data) setSelected(configured.data.destinationJobIds); }, [configured.data]);
  const jobs = useQuery(selectorQuery(search, undefined, projectId));
  const save = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.PUT("/api/v1/jobs/{jobId}/invocation-permissions", { params: { path: { jobId } }, body: { destinationJobIds: selected } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: value => { setSelected(value.destinationJobIds); void configured.refetch(); } });
  return <section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-slate-700">
    <h3 className="font-semibold">Manual invocation permissions</h3>
    <p className="text-sm text-slate-600 dark:text-slate-400">Choose jobs in this project that this job may manually invoke during a run. Lifecycle triggers are managed separately.</p>
    <Label>Search destination jobs <Input value={search} maxLength={120} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => setSearch(event.target.value)} /></Label>
    {configured.isPending && <p role="status">Loading permissions…</p>}{configured.error && <p role="alert">{configured.error.message}</p>}
    {jobs.isPending && <p role="status">Loading jobs…</p>}{jobs.error && <p role="alert">{jobs.error.message}</p>}
    <Label className="block"><Input type="checkbox" checked={selected.includes(jobId)} onChange={event => setSelected(event.target.checked ? [...selected, jobId] : selected.filter(id => id !== jobId))} /> Current job (allow this job to invoke itself)</Label>
    {jobs.data?.items.filter(job => job.id !== jobId).map(job => <Label key={job.id} className="block"><Input type="checkbox" checked={selected.includes(job.id)} onChange={event => setSelected(event.target.checked ? [...selected, job.id] : selected.filter(id => id !== job.id))} /> {job.name}</Label>)}
    <Button type="button" disabled={save.isPending || configured.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save permissions"}</Button>
    {save.error && <p role="alert">{save.error.message}</p>}
    {save.isSuccess && <p role="status">Manual invocation permissions saved.</p>}
  </section>;
}

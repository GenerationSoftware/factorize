import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label, PageHeader, Select } from "../../shared/ui";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { messageOf } from "../auth/session";
import { integrationsQuery } from "./queries";
import { SettingsLayout } from "./navigation";

type Target = { id: string; name: string; kind: "exe-vm" | "amp"; integrationId?: string; tags?: string[]; agentKind: string };
const targetQuery = { queryKey: ["settings", "execution-targets"], queryFn: async ({ signal }: { signal: AbortSignal }) => { const { data, error } = await api.GET("/api/v1/execution-targets", { signal }); if (!data || error) throw new Error(messageOf(error)); return data as Target[]; }, staleTime: 10_000 };

export function Targets() {
  const cache = useQueryClient();
  const targets = useQuery(targetQuery), integrations = useQuery(integrationsQuery);
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(""), [kind, setKind] = useState<"exe" | "amp">("exe"), [integrationId, setIntegrationId] = useState(""), [agentKind, setAgentKind] = useState("codex"), [tags, setTags] = useState(""), [diagnostic, setDiagnostic] = useState<unknown>(null), savedSnapshot = useRef("");
  const refresh = async () => { await cache.invalidateQueries({ queryKey: targetQuery.queryKey }); await cache.invalidateQueries({ queryKey: ["editor"] }); };
  const save = useMutation({ mutationFn: async () => { const body = { name: name.trim(), tags: tags.split(",").map(value => value.trim()).filter(Boolean), agentKind, integrationKind: kind, integrationId }; const wasEditing = Boolean(editing); const result = editing ? await api.PUT("/api/v1/execution-targets/{targetId}", { params: { path: { targetId: editing } }, body }) : await api.POST("/api/v1/execution-targets", { body }); if (result.error || !result.data) throw new Error(messageOf(result.error)); return { wasEditing }; }, onSuccess: async ({ wasEditing }) => { if (!wasEditing) { setEditing(null); setName(""); setTags(""); } await refresh(); } });
  const remove = useMutation({ mutationFn: async (id: string) => { const result = await api.DELETE("/api/v1/execution-targets/{targetId}", { params: { path: { targetId: id } } }); if (result.error) throw new Error(messageOf(result.error)); }, onSuccess: refresh });
  const diagnose = useMutation({ mutationFn: async (id: string) => { const result = await api.POST("/api/v1/execution-targets/{targetId}/diagnostics", { params: { path: { targetId: id } } }); if (result.error || !result.data) throw new Error(messageOf(result.error)); return result.data; }, onSuccess: setDiagnostic });
  const formValue = { name, kind, integrationId, agentKind, tags };
  const startEdit = (target: Target) => { const next = { name: target.name, kind: target.kind === "amp" ? "amp" as const : "exe" as const, integrationId: target.integrationId ?? "", agentKind: target.agentKind, tags: (target.tags ?? []).join(", ") }; savedSnapshot.current = JSON.stringify(next); setEditing(target.id); setName(next.name); setKind(next.kind); setIntegrationId(next.integrationId); setAgentKind(next.agentKind); setTags(next.tags); };
  const autosave = useDebouncedAutosave({ value: formValue, enabled: Boolean(editing) && JSON.stringify(formValue) !== savedSnapshot.current, validate: next => !next.name.trim() ? "Enter a display name." : !next.integrationId ? "Choose a saved integration." : next.tags.split(",").some(tag => tag.trim() && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag.trim())) ? "VM tags are invalid." : undefined, save: async next => { await save.mutateAsync(); savedSnapshot.current = JSON.stringify(next); } });
  const exe = integrations.data?.exeConnections ?? [], amp = integrations.data?.ampConnections ?? [], error = [targets.error, integrations.error, save.error, remove.error, diagnose.error].find(Boolean);
  return <SettingsLayout title="Execution targets">
    <PageHeader title="Execution targets" description="Choose VM tags and an agent independently for each job target. Targets may share one stored integration credential." />
    {error && <p role="alert">{error instanceof Error ? error.message : "Operation failed"}</p>}
    <Card><h2 className="mb-4 text-lg font-semibold">{editing ? "Edit target" : "Create target"}</h2><form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <Label>Display name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label>
      <Label>Integration<Select required value={`${kind}:${integrationId}`} onChange={event => { const [nextKind, ...rest] = event.target.value.split(":"); setKind(nextKind as "amp" | "exe"); setIntegrationId(rest.join(":")); }}><option value=":">Choose a saved integration</option>{exe.map(connection => <option key={`exe:${connection.connectionId}`} value={`exe:${connection.connectionId}`}>exe.dev · {connection.connectionId}</option>)}{amp.map(connection => <option key={`amp:${connection.connectionId}`} value={`amp:${connection.connectionId}`}>Amp · {connection.project}</option>)}</Select></Label>
      <Label>Agent<Select value={agentKind} onChange={event => setAgentKind(event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="pi">Pi</option></Select></Label>
      <Label>VM tags<Input aria-label="VM tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="payments, production" /></Label>
      <div className="flex items-end gap-3">{!editing && <Button variant="primary" type="submit" disabled={save.isPending || !integrationId}>{save.isPending ? "Saving…" : "Create target"}</Button>}{editing && <><AutosaveStatus state={autosave.state} error={autosave.error} label="Target" /><Button type="button" onClick={() => setEditing(null)}>Cancel</Button></>}</div>
    </form></Card>
    <div className="mt-5 grid gap-4">{targets.isPending && <p role="status">Loading execution targets…</p>}{targets.data?.length === 0 && <Card><p>No execution targets yet. Save an integration first, then create a target.</p></Card>}{targets.data?.map(target => <Card key={target.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{target.name}</h2><p className="text-sm text-slate-600 dark:text-slate-400">{target.kind} · {target.agentKind} · {(target.tags ?? []).join(", ") || "No VM tags"}</p><p className="text-xs text-slate-500">Integration: {target.integrationId ?? "—"}</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => startEdit(target)}>Edit</Button>{target.kind === "exe-vm" && <Button disabled={diagnose.isPending} onClick={() => diagnose.mutate(target.id)}>Diagnose</Button>}<Button variant="destructive" onClick={() => { if (window.confirm("Delete this execution target? Jobs using it must be updated first.")) remove.mutate(target.id); }}>Delete</Button></div></div></Card>)}</div>
    {diagnostic !== null && <Card className="mt-5"><h2 className="mb-2 text-lg font-semibold">Target diagnostic</h2><pre role="status" className="whitespace-pre-wrap break-words text-sm">{String(JSON.stringify(diagnostic, null, 2))}</pre></Card>}
  </SettingsLayout>;
}

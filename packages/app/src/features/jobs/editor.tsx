import { validationMessage } from "./validation-message";
import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useParams, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { jobQuery } from "./queries";
import { metadataQuery, targetsQuery } from "./editor-queries";
import { editableJob, emptyJob, reconcile, writeInput, type Job, type JobInput } from "./editor-state";
import { TemplateField } from "./template-field";
import { TriggerEditor } from "./trigger-editor";
import { messageOf } from "../auth/session";
export function JobEditor() {
  const { jobId } = useParams({ strict: false });
  const job = useQuery({ ...jobQuery(jobId ?? ""), enabled: !!jobId });
  if (jobId && job.isPending) return <main className="p-6"><p role="status">Loading job configuration…</p></main>;
  if (jobId && job.error) return <main className="p-6"><p role="alert">{job.error.message}</p></main>;
  return <EditorForm key={jobId ?? "new"} initial={job.data} />;
}
function EditorForm({ initial }: { initial?: Job }) {
  const navigate = useNavigate(), cache = useQueryClient();
  const [base, setBase] = useState(initial ? editableJob(initial) : emptyJob);
  const [draft, setDraft] = useState(base), [revision, setRevision] = useState(initial?.updatedAt);
  const [remote, setRemote] = useState<Job>(), [conflicts, setConflicts] = useState<(keyof JobInput)[]>([]);
  const [reconciling, setReconciling] = useState(false), [saved, setSaved] = useState(false);
  const savingNavigation = useRef(false);
  const dirty = !saved && JSON.stringify(base) !== JSON.stringify(draft);
  useBlocker({ shouldBlockFn: () => dirty && !savingNavigation.current && !window.confirm("Discard unsaved job changes?"), enableBeforeUnload: dirty });
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const targets = useQuery(targetsQuery), metadata = useQuery(metadataQuery);
  const target = targets.data?.find(t => t.id === draft.executionTargetId);
  const update = <K extends keyof JobInput>(key: K, value: JobInput[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const refreshConflict = useMutation({ retry: false, mutationFn: async () => {
    if (!initial) throw new Error("No job selected");
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}", { params: { path: { jobId: initial.id } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: value => { setRemote(value); setReconciling(false); } });
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (remote || conflicts.length) throw new Error("Resolve the stale edit before saving.");
    const result = initial ? await api.PUT("/api/v1/jobs/{jobId}", { params: { path: { jobId: initial.id } }, body: { ...writeInput(draft), expectedUpdatedAt: revision } }) : await api.POST("/api/v1/jobs", { body: writeInput(draft) });
    if (result.error || !result.data) {
      if (result.error?.error.code === "stale_job") { setReconciling(true); refreshConflict.mutate(); }
      throw new Error(validationMessage(result.error));
    }
    return result.data;
  }, onSuccess: async value => { savingNavigation.current = true; setSaved(true); setBase(editableJob(value)); cache.setQueryData(jobQuery(value.id).queryKey, value); await cache.invalidateQueries({ queryKey: ["jobs"] }); void navigate({ to: "/jobs/$jobId", params: { jobId: value.id } }); } });
  const acceptRemote = () => { if (!remote) return; const value = editableJob(remote); setDraft(value); setBase(value); setRevision(remote.updatedAt); setRemote(undefined); setConflicts([]); save.reset(); };
  const merge = () => { if (!remote) return; const value = editableJob(remote), result = reconcile(base, draft, value); setDraft(result.merged); setConflicts(result.conflicts); setBase(value); setRevision(remote.updatedAt); if (!result.conflicts.length) setRemote(undefined); save.reset(); };
  const resolve = (field: keyof JobInput, local: boolean) => {
    // Local values are kept separately from the merged draft until chosen.
    setDraft(previous => local ? { ...previous, [field]: localConflictDraft[field] } : previous); setConflicts(previous => previous.filter(key => key !== field));
    if (conflicts.length === 1) setRemote(undefined);
  };
  const [localConflictDraft, setLocalConflictDraft] = useState(draft);
  return <main className="mx-auto max-w-4xl p-6"><Link to="/jobs" search={{ q: "" }}>Jobs</Link><h1 className="text-3xl font-semibold">{initial ? "Edit job" : "Create job"}</h1>
    {(remote || reconciling || refreshConflict.error) && <section role="alert" className="my-4 border p-4"><h2>This job changed while you were editing</h2><p>Your unsaved draft is retained. Review the latest configuration before retrying.</p>
      {refreshConflict.isPending && <p>Loading latest configuration…</p>}{refreshConflict.error && <><p>{refreshConflict.error.message}</p><button onClick={() => refreshConflict.mutate()}>Retry loading latest</button></>}
      {remote && !conflicts.length && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(editableJob(remote), null, 2)}</pre><button onClick={acceptRemote}>Reload latest and discard my changes</button><button onClick={() => { setLocalConflictDraft(draft); merge(); }}>Reconcile my changes</button></>}
      {conflicts.map(field => <fieldset key={field}><legend>Both versions changed {field}</legend><pre className="max-h-40 overflow-auto">Mine: {JSON.stringify(localConflictDraft[field], null, 2)}<br />Latest: {JSON.stringify(base[field], null, 2)}</pre><button onClick={() => resolve(field, true)}>Keep my {field}</button><button onClick={() => resolve(field, false)}>Keep latest {field}</button></fieldset>)}
    </section>}
    <form className="my-4 grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <label>Name <input required maxLength={120} value={draft.name} onChange={e => update("name", e.target.value)} /></label>
      <label>Slug <input required pattern="[a-z][a-z0-9_-]{0,29}" value={draft.slug} onChange={e => update("slug", e.target.value)} /></label>
      <label>Execution target <select required value={draft.executionTargetId} onChange={e => { update("executionTargetId", e.target.value); update("model", ""); update("effort", ""); }}><option value="">Choose a target</option>{targets.data?.map(t => <option key={t.id} value={t.id}>{t.name} · {t.agentKind}</option>)}{draft.executionTargetId && !target && <option value={draft.executionTargetId}>Unavailable target: {draft.executionTargetId}</option>}</select></label>
      {targets.isPending && <p role="status">Loading execution targets…</p>}{targets.error && <p role="alert">{targets.error.message}</p>}{targets.data?.length === 0 && <p>Connect an execution provider in settings before creating a job.</p>}
      <label>Model <select value={draft.model} disabled={target?.kind === "amp"} onChange={e => update("model", e.target.value)}><option value="">Harness default</option>{target?.models?.map(model => <option key={model}>{model}</option>)}{draft.model && !target?.models?.includes(draft.model) && <option value={draft.model}>{draft.model} (unavailable)</option>}</select></label>
      <label>Effort <select value={draft.effort} disabled={target?.kind === "amp"} onChange={e => update("effort", e.target.value)}><option value="">Harness default</option>{target?.efforts?.map(effort => <option key={effort}>{effort}</option>)}{draft.effort && !target?.efforts?.includes(draft.effort) && <option value={draft.effort}>{draft.effort} (unavailable)</option>}</select></label>
      <label>Concurrency limit <input required type="number" min={1} max={50} value={draft.concurrencyLimit} onChange={e => update("concurrencyLimit", e.target.valueAsNumber)} /></label>
      <TemplateField label="Prompt template" multiline value={draft.promptTemplate} onChange={value => update("promptTemplate", value)} triggers={draft.triggers} />
      <TemplateField label="Run name template" value={draft.runNameTemplate ?? ""} onChange={value => update("runNameTemplate", value)} triggers={draft.triggers} />
      <details><summary>Template variables</summary>{metadata.error && <p role="alert">{metadata.error.message}</p>}{Object.entries(metadata.data ?? {}).map(([kind, fields]) => <section key={kind}><h3>{kind}</h3><ul>{fields.map(field => <li key={field.path}><code>{field.path}</code> — {field.description}</li>)}</ul></section>)}</details>
      <TriggerEditor triggers={draft.triggers} onChange={value => update("triggers", value)} />
      {save.error && <p role="alert">{save.error.message}</p>}
      <button disabled={save.isPending || !!remote || reconciling || !!conflicts.length || targets.isPending || !!targets.error}>{save.isPending ? "Saving…" : "Save job"}</button>
    </form>
  </main>;
}

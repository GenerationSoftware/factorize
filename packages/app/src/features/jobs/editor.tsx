import { Disclosure, Summary, Button, Input, Select, Label, Page, Card } from "../../shared/ui";
import { JobHeader } from "./header";
import { DeleteJob } from "./delete";
import { validationMessage } from "./validation-message";
import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useBlocker } from "@tanstack/react-router";
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
  if (jobId && job.isPending) return <Page className="p-6"><p role="status">Loading job configuration…</p></Page>;
  if (jobId && job.error) return <Page className="p-6"><p role="alert">{job.error.message}</p></Page>;
  return <EditorForm key={jobId ?? "new"} initial={job.data} />;
}
function EditorForm({ initial }: { initial?: Job }) {
  const location = useLocation(), navigate = useNavigate(), cache = useQueryClient();
  const [base, setBase] = useState(initial ? editableJob(initial) : emptyJob);
  const [draft, setDraft] = useState(base), [revision, setRevision] = useState(initial?.updatedAt);
  const [remote, setRemote] = useState<Job>(), [conflicts, setConflicts] = useState<(keyof JobInput)[]>([]);
  const [reconciling, setReconciling] = useState(false), [saved, setSaved] = useState(false);
  const savingNavigation = useRef(false);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  useBlocker({ shouldBlockFn: () => dirty && !savingNavigation.current && !window.confirm("Discard unsaved job changes?"), enableBeforeUnload: dirty });
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const targets = useQuery(targetsQuery), metadata = useQuery(metadataQuery);
  const target = targets.data?.find(t => t.id === draft.executionTargetId);
  const update = <K extends keyof JobInput>(key: K, value: JobInput[K]) => { setSaved(false); setDraft(previous => ({ ...previous, [key]: value })); };
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
  }, onSuccess: async value => { savingNavigation.current = true; setSaved(true); setBase(editableJob(value)); setDraft(editableJob(value)); setRevision(value.updatedAt); cache.setQueryData(jobQuery(value.id).queryKey, value); await cache.invalidateQueries({ queryKey: ["jobs"] }); if (!initial) void navigate({ to: "/jobs/$jobId", params: { jobId: value.id } }); else savingNavigation.current = false; } });
  const acceptRemote = () => { if (!remote) return; const value = editableJob(remote); setDraft(value); setBase(value); setRevision(remote.updatedAt); setRemote(undefined); setConflicts([]); save.reset(); };
  const merge = () => { if (!remote) return; const value = editableJob(remote), result = reconcile(base, draft, value); setDraft(result.merged); setConflicts(result.conflicts); setBase(value); setRevision(remote.updatedAt); if (!result.conflicts.length) setRemote(undefined); save.reset(); };
  const resolve = (field: keyof JobInput, local: boolean) => {
    // Local values are kept separately from the merged draft until chosen.
    setDraft(previous => local ? { ...previous, [field]: localConflictDraft[field] } : previous); setConflicts(previous => previous.filter(key => key !== field));
    if (conflicts.length === 1) setRemote(undefined);
  };
  const [localConflictDraft, setLocalConflictDraft] = useState(draft);
  const showJobBreadcrumb = Boolean(initial && !location.pathname.endsWith("/settings"));
  return <Page className="max-w-6xl"><nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-2"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>{showJobBreadcrumb && initial && <><span aria-hidden="true">→</span><Link className="break-words min-w-0" to="/jobs/$jobId" params={{ jobId: initial.id }} search={{}}> {initial.name}</Link></>}</nav>{initial && <JobHeader job={initial} />}
    {(remote || reconciling || refreshConflict.error) && <Card role="alert" className="my-4 border p-4"><h2>This job changed while you were editing</h2><p>Your unsaved draft is retained. Review the latest configuration before retrying.</p>
      {refreshConflict.isPending && <p>Loading latest configuration…</p>}{refreshConflict.error && <><p>{refreshConflict.error.message}</p><Button onClick={() => refreshConflict.mutate()}>Retry loading latest</Button></>}
      {remote && !conflicts.length && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(editableJob(remote), null, 2)}</pre><Button onClick={acceptRemote}>Reload latest and discard my changes</Button><Button onClick={() => { setLocalConflictDraft(draft); merge(); }}>Reconcile my changes</Button></>}
      {conflicts.map(field => <fieldset key={field}><legend>Both versions changed {field}</legend><pre className="max-h-40 overflow-auto">Mine: {JSON.stringify(localConflictDraft[field], null, 2)}<br />Latest: {JSON.stringify(base[field], null, 2)}</pre><Button onClick={() => resolve(field, true)}>Keep my {field}</Button><Button onClick={() => resolve(field, false)}>Keep latest {field}</Button></fieldset>)}
    </Card>}
    <form className="my-4 grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <Card><h2>Job details</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Name this job and set its stable identifier.</p><div className="grid gap-5 sm:grid-cols-2"><Label>Name <Input required maxLength={120} value={draft.name} onChange={e => update("name", e.target.value)} /></Label>
      <Label>Slug <Input required pattern="[a-z][a-z0-9_-]{0,29}" value={draft.slug} onChange={e => update("slug", e.target.value)} /></Label>
      </div></Card><Card><h2>Execution target</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose the provider, model, effort, and concurrency for each run.</p><div className="grid gap-5 sm:grid-cols-2"><Label>Execution target <Select required value={draft.executionTargetId} onChange={e => { update("executionTargetId", e.target.value); update("model", ""); update("effort", ""); }}><option value="">Choose a target</option>{targets.data?.map(t => <option key={t.id} value={t.id}>{t.name} · {t.agentKind}</option>)}{draft.executionTargetId && !target && <option value={draft.executionTargetId}>Unavailable target: {draft.executionTargetId}</option>}</Select></Label>
      {targets.isPending && <p role="status">Loading execution targets…</p>}{targets.error && <p role="alert">{targets.error.message}</p>}{targets.data?.length === 0 && <p>Connect an execution provider in settings before creating a job.</p>}
      <Label>Model <Select value={draft.model} disabled={target?.kind === "amp"} onChange={e => update("model", e.target.value)}><option value="">Harness default</option>{target?.models?.map(model => <option key={model}>{model}</option>)}{draft.model && !target?.models?.includes(draft.model) && <option value={draft.model}>{draft.model} (unavailable)</option>}</Select></Label>
      <Label>Effort <Select value={draft.effort} disabled={target?.kind === "amp"} onChange={e => update("effort", e.target.value)}><option value="">Harness default</option>{target?.efforts?.map(effort => <option key={effort}>{effort}</option>)}{draft.effort && !target?.efforts?.includes(draft.effort) && <option value={draft.effort}>{draft.effort} (unavailable)</option>}</Select></Label>
      <Label>Concurrency limit <Input required type="number" min={1} max={50} value={draft.concurrencyLimit} onChange={e => update("concurrencyLimit", e.target.valueAsNumber)} /></Label>
      </div></Card><Card className="space-y-5"><h2>Prompt and context</h2><p className="text-sm text-slate-600 dark:text-slate-400">Write instructions using context supplied by your triggers.</p><TemplateField label="Prompt template" multiline value={draft.promptTemplate} onChange={value => update("promptTemplate", value)} triggers={draft.triggers} />
      <TemplateField label="Run name template" value={draft.runNameTemplate ?? ""} onChange={value => update("runNameTemplate", value)} triggers={draft.triggers} />
      <Disclosure><Summary>Template variables</Summary>{metadata.error && <p role="alert">{metadata.error.message}</p>}{Object.entries(metadata.data ?? {}).map(([kind, fields]) => <Card key={kind}><h3>{kind}</h3><ul>{fields.map(field => <li key={field.path}><code>{field.path}</code> — {field.description}</li>)}</ul></Card>)}</Disclosure>
      </Card><Card><h2>Triggers</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose the events that start this job.</p><TriggerEditor triggers={draft.triggers} onChange={value => update("triggers", value)} />
      {initial?.triggers.map(trigger => trigger.kind === "webhook" && trigger.config.provider === "cloudflareTail" && trigger.config.destination ? <div key={trigger.id} className="mt-4 text-sm"><p>{trigger.slug} · Tail webhook destination</p><code className="break-all">{trigger.config.destination}</code></div> : null)}
      </Card>{save.error && <p role="alert">{save.error.message}</p>}
      <Button variant="primary" disabled={save.isPending || !!remote || reconciling || !!conflicts.length || targets.isPending || !!targets.error}>{save.isPending ? "Saving…" : "Save job"}</Button>
    </form>{saved && <p role="status">Job settings saved.</p>}{initial && <DeleteJob jobId={initial.id} name={initial.name} disabled={save.isPending} onDeleted={() => { savingNavigation.current = true; }} />}
  </Page>;
}

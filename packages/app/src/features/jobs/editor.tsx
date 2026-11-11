import { RunPermissions, defaultRunScopes } from "./run-permissions";
import { Disclosure, Summary, Button, Input, Select, Label, Page, Card, Textarea } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { DeleteJob } from "./delete";
import { validationMessage } from "./validation-message";
import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { jobQuery } from "./queries";
import { metadataQuery, targetsQuery } from "./editor-queries";
import { canonicalizeVmImage, applySavedJob, editableJob, emptyJob, reconcile, validateJobInput, writeInput, type Job, type JobInput } from "./editor-state";
import { TemplateField } from "./template-field";
import { TriggerEditor } from "./trigger-editor";
import { InvocationPermissionEditor } from "./invocation-permission-editor";
import { NavIcon } from "../../shared/nav-icon";
import { messageOf } from "../auth/session";
import { projectsQuery } from "../projects/queries";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { skillsQuery } from "../skills/queries";
import { JobNav } from "./job-nav";
export function JobEditor() {
  const { jobId, section } = useParams({ strict: false });
  const job = useQuery({ ...jobQuery(jobId ?? ""), enabled: !!jobId });
  if (jobId && job.isPending) return <Page className="p-6"><p role="status">Loading job configuration…</p></Page>;
  if (jobId && job.error) return <Page className="p-6"><p role="alert">{job.error.message}</p></Page>;
  return <>{job.data?.projectId && <JobNav jobId={job.data.id} tab="settings" />}<EditorForm key={jobId ?? "new"} initial={job.data} section={section} /></>;
}
function EditorForm({ initial, section }: { initial?: Job; section?: string }) {
  const location = useLocation(), navigate = useNavigate(), cache = useQueryClient();
  const [base, setBase] = useState(initial ? editableJob(initial) : emptyJob);
  const [draft, setDraft] = useState(base), [revision, setRevision] = useState(initial?.updatedAt);
  const [remote, setRemote] = useState<Job>(), [conflicts, setConflicts] = useState<(keyof JobInput)[]>([]);
  const [reconciling, setReconciling] = useState(false), [saved, setSaved] = useState(false), [invalidForm, setInvalidForm] = useState(false);
  const savingNavigation = useRef(false);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  useBlocker({ shouldBlockFn: ({ next }) => dirty && !(initial && next.pathname.startsWith(`/jobs/${initial.id}/settings/`)) && !savingNavigation.current && !window.confirm("Discard unsaved job changes?"), enableBeforeUnload: dirty });
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const targets = useQuery(targetsQuery), metadata = useQuery(metadataQuery), skills = useQuery(skillsQuery());
  const projects = useQuery({ ...projectsQuery, enabled: !initial });
  const target = targets.data?.find(t => t.id === draft.executionConfigId);
  const verificationFingerprint = JSON.stringify([draft.executionConfigId, canonicalizeVmImage(draft.vmImage ?? ""), draft.tags ?? [], target?.agentKind ?? ""]);
  const verificationKey = `factorize-vm-image-verification:${initial?.id ?? "new"}`;
  const [verificationRef, setVerificationRef] = useState<{ fingerprint: string; id: string } | null>(() => { try { return JSON.parse(localStorage.getItem(verificationKey) ?? "null"); } catch { return null; } });
  const currentVerificationFingerprint = useRef(verificationFingerprint); currentVerificationFingerprint.current = verificationFingerprint;
  const verificationGeneration = useRef(0);
  const activeVerificationId = verificationRef?.fingerprint === verificationFingerprint ? verificationRef.id : "";
  const verification = useQuery({ queryKey: ["vm-image-verification", activeVerificationId], enabled: !!activeVerificationId, queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/vm-image-verifications/{verificationId}", { params: { path: { verificationId: activeVerificationId } }, signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, refetchInterval: query => query.state.data && ["succeeded", "failed", "cleanup_failed"].includes(query.state.data.status) ? false : 1500, refetchIntervalInBackground: true });
  const verifyImage = useMutation({ retry: false, mutationFn: async (snapshot: { fingerprint: string; generation: number }) => { const { data, error } = await api.POST("/api/v1/vm-image-verifications", { body: { connectionId: draft.executionConfigId, image: draft.vmImage?.trim() ?? "", tags: draft.tags ?? [], agentKind: target?.agentKind as "codex" | "claude" | "pi", executionType: draft.executionType ?? "agent" } }); if (!data || error) throw new Error(messageOf(error)); return { ...snapshot, id: data.id }; }, onSuccess: value => { if (currentVerificationFingerprint.current !== value.fingerprint || verificationGeneration.current !== value.generation) return; const record = { fingerprint: value.fingerprint, id: value.id }; setVerificationRef(record); localStorage.setItem(verificationKey, JSON.stringify(record)); } });
  const projectId = new URLSearchParams(location.searchStr).get("projectId") ?? undefined;
  const selectedProjectId = initial?.projectId ?? draft.projectId ?? projectId;
  const [projectDialog, setProjectDialog] = useState(false);
  const onlyProject = projects.data?.length === 1 ? projects.data[0] : undefined;
  useEffect(() => { if (!initial && !draft.projectId && !projectId && onlyProject) setDraft(previous => ({ ...previous, projectId: onlyProject.id })); }, [initial, draft.projectId, projectId, onlyProject]);
  const update = <K extends keyof JobInput>(key: K, value: JobInput[K]) => { setSaved(false); const sameImage = key === "vmImage" && canonicalizeVmImage(draft.vmImage ?? "") === canonicalizeVmImage(typeof value === "string" ? value : ""); if (["executionConfigId", "tags"].includes(key) || (key === "vmImage" && !sameImage)) { verificationGeneration.current++; setVerificationRef(null); localStorage.removeItem(verificationKey); } setDraft(previous => ({ ...previous, [key]: value })); };
  const refreshConflict = useMutation({ retry: false, mutationFn: async () => {
    if (!initial) throw new Error("No job selected");
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}", { params: { path: { jobId: initial.id } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: value => { setRemote(value); setReconciling(false); } });
  const save = useMutation({ retry: false, mutationFn: async (snapshot: JobInput) => {
    if (remote || conflicts.length) throw new Error("Resolve the stale edit before saving.");
    if (!initial && !selectedProjectId) throw new Error("Choose a project before creating the job.");
    const input = { ...writeInput(snapshot), ...(selectedProjectId ? { projectId: selectedProjectId } : {}) };
    const result = initial ? await api.PUT("/api/v1/jobs/{jobId}", { params: { path: { jobId: initial.id } }, body: { ...input, expectedUpdatedAt: revision } }) : await api.POST("/api/v1/jobs", { body: input });
    if (result.error || !result.data) {
      if (result.error?.error.code === "stale_job") { setReconciling(true); refreshConflict.mutate(); }
      throw new Error(validationMessage(result.error));
    }
    return result.data;
  }, onSuccess: async (value, snapshot) => {
    savingNavigation.current = !initial;
    setSaved(true);
    if (!initial && verificationRef && verificationRef.fingerprint === currentVerificationFingerprint.current) localStorage.setItem(`factorize-vm-image-verification:${value.id}`, JSON.stringify(verificationRef));
    const accepted = editableJob(value);
    setBase(accepted);
    setDraft(current => applySavedJob(snapshot, current, accepted));
    setRevision(value.updatedAt);
    cache.setQueryData(jobQuery(value.id).queryKey, value);
    await cache.invalidateQueries({ queryKey: ["jobs"] });
    if (!initial) void navigate({ to: "/jobs/$jobId", params: { jobId: value.id } });
  } });
  const autosave = useDebouncedAutosave({ value: draft, enabled: Boolean(initial) && dirty && !invalidForm && !remote && !reconciling && !conflicts.length, validate: validateJobInput, save: async snapshot => { await save.mutateAsync(snapshot); } });
  const acceptRemote = () => { if (!remote) return; const value = editableJob(remote); setDraft(value); setBase(value); setRevision(remote.updatedAt); setRemote(undefined); setConflicts([]); save.reset(); };
  const merge = () => { if (!remote) return; const value = editableJob(remote), result = reconcile(base, draft, value); setDraft(result.merged); setConflicts(result.conflicts); setBase(value); setRevision(remote.updatedAt); if (!result.conflicts.length) setRemote(undefined); save.reset(); };
  const resolve = (field: keyof JobInput, local: boolean) => {
    // Local values are kept separately from the merged draft until chosen.
    setDraft(previous => local ? { ...previous, [field]: localConflictDraft[field] } : previous); setConflicts(previous => previous.filter(key => key !== field));
    if (conflicts.length === 1) setRemote(undefined);
  };
  const [localConflictDraft, setLocalConflictDraft] = useState(draft);
  const selectedSection = initial && ["general", "execution", "context", "permissions", "triggers"].includes(section ?? "") ? section : initial ? "general" : "all";
  const show = (name: string) => selectedSection === "all" || selectedSection === name;
  const settingsSection = (name: "general" | "execution" | "context" | "permissions" | "triggers") => <Link to="/jobs/$jobId/settings/$section" params={{ jobId: initial!.id, section: name }} aria-current={selectedSection === name ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${selectedSection === name ? "bg-factorize-50 font-semibold text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" : "hover:bg-stone-100 dark:hover:bg-slate-800"}`}><NavIcon name={name} />{name[0].toUpperCase() + name.slice(1)}</Link>;
  return <Page className="max-w-6xl">
    {(remote || reconciling || refreshConflict.error) && <Card role="alert" className="my-4 border p-4"><h2>This job changed while you were editing</h2><p>Your unsaved draft is retained. Review the latest configuration before retrying.</p>
      {refreshConflict.isPending && <p>Loading latest configuration…</p>}{refreshConflict.error && <><p>{refreshConflict.error.message}</p><Button onClick={() => refreshConflict.mutate()}>Retry loading latest</Button></>}
      {remote && !conflicts.length && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(editableJob(remote), null, 2)}</pre><Button onClick={acceptRemote}>Reload latest and discard my changes</Button><Button onClick={() => { setLocalConflictDraft(draft); merge(); }}>Reconcile my changes</Button></>}
      {conflicts.map(field => <fieldset key={field}><legend>Both versions changed {field}</legend><pre className="max-h-40 overflow-auto">Mine: {JSON.stringify(localConflictDraft[field], null, 2)}<br />Latest: {JSON.stringify(base[field], null, 2)}</pre><Button onClick={() => resolve(field, true)}>Keep my {field}</Button><Button onClick={() => resolve(field, false)}>Keep latest {field}</Button></fieldset>)}
    </Card>}
    <form className="my-4 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8" onSubmit={e => { e.preventDefault(); save.mutate(draft); }}>
      <aside className="mb-5 lg:sticky lg:top-6 lg:mb-0"><nav aria-label="Job settings sections" className="grid gap-1">{initial ? <>{settingsSection("general")}{settingsSection("execution")}{settingsSection("context")}{settingsSection("permissions")}{settingsSection("triggers")}</> : <span className="px-3 py-2 text-sm font-semibold">General</span>}</nav></aside>
      <div className="grid gap-4">
      {show("general") && <section id="general" aria-labelledby="general-heading"><Card><h2 id="general-heading">General</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Set the job name, description, and stable identifier.</p><div className="grid gap-5 sm:grid-cols-2">{!initial && <div><Label>Project <Select required aria-label="Project" value={selectedProjectId ?? ""} onChange={e => update("projectId", e.target.value || undefined)}><option value="">Choose a project</option>{projects.data?.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</Select></Label><Button type="button" className="mt-2" onClick={() => setProjectDialog(true)}>Create new project</Button>{projects.isPending && <p role="status">Loading projects…</p>}{projects.error && <p role="alert">{projects.error.message}</p>}</div>}<Label>Name <Input required maxLength={120} value={draft.name} onChange={e => update("name", e.target.value)} /></Label>
      <Label>Slug <Input required pattern="[a-z][a-z0-9_-]{0,29}" value={draft.slug} onChange={e => update("slug", e.target.value)} /></Label><Label className="sm:col-span-2">Description <Textarea maxLength={2000} value={draft.description ?? ""} onChange={e => update("description", e.target.value)} /></Label>
      </div></Card>{initial && <DeleteJob jobId={initial.id} name={initial.name} disabled={save.isPending} onDeleted={() => { savingNavigation.current = true; }} />}</section>}{show("execution") && <section id="execution" aria-labelledby="execution-heading"><Card><h2 id="execution-heading">Execution</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose an integration for this job, then configure its VM tags, model, effort, and concurrency.</p><div className="grid gap-5 sm:grid-cols-2"><Label>Execution type <Select value={draft.executionType ?? "agent"} onChange={e => update("executionType", e.target.value as "agent" | "code")}><option value="agent">Agent</option><option value="code">Code script</option></Select></Label><Label>Integration <Select required value={draft.executionConfigId} onChange={e => { update("executionConfigId", e.target.value); update("model", ""); update("effort", ""); }}><option value="">Choose an integration</option>{targets.data?.map(t => <option key={t.id} value={t.id}>{t.name} · {t.agentKind}</option>)}{draft.executionConfigId && !target && <option value={draft.executionConfigId}>Unavailable integration: {draft.executionConfigId}</option>}</Select></Label>
      {targets.isPending && <p role="status">Loading integrations…</p>}{targets.error && <p role="alert">{targets.error.message}</p>}{targets.data?.length === 0 && <p>Connect an execution provider in settings before creating a job.</p>}
      <Label>VM tags <Select multiple value={draft.tags ?? []} disabled={target?.kind === "amp"} onChange={e => update("tags", Array.from(e.target.selectedOptions, option => option.value))}>{target?.tags?.map(tag => <option key={tag}>{tag}</option>)}{(draft.tags ?? []).filter(tag => !target?.tags?.includes(tag)).map(tag => <option key={tag} value={tag}>{tag} (unavailable)</option>)}</Select></Label>
      {target?.kind !== "amp" && <div className="space-y-2"><Label>VM image <Input maxLength={512} placeholder="Default exe.dev image" value={draft.vmImage ?? ""} onChange={e => update("vmImage", e.target.value)} /><span className="text-xs text-slate-500">Optional public Docker/OCI image. Blank uses the exe.dev default.</span></Label>{draft.vmImage && <p className="text-sm" role="status">{verification.data?.status === "succeeded" && activeVerificationId ? `Verified: ${verification.data?.phase}` : verification.data?.status === "failed" && activeVerificationId ? `${verification.data?.errorKind}: ${verification.data?.error}` : verification.data?.status === "cleanup_failed" && activeVerificationId ? `Cleanup unresolved: ${verification.data?.error}` : activeVerificationId ? `Verification ${verification.data?.status}: ${verification.data?.phase}` : "Not verified"}</p>}{draft.vmImage && <Button type="button" disabled={!draft.executionConfigId || !target || verifyImage.isPending || ["queued", "creating", "checking_ssh", "checking_agent", "cleaning_up"].includes(verification.data?.status ?? "")} onClick={() => verifyImage.mutate({ fingerprint: verificationFingerprint, generation: verificationGeneration.current })}>{verifyImage.isPending ? "Starting verification…" : activeVerificationId && ["queued", "creating", "checking_ssh", "checking_agent", "cleaning_up"].includes(verification.data?.status ?? "") ? "Verification in progress…" : "Verify image"}</Button>}{verifyImage.error && <p role="alert">{verifyImage.error.message}</p>}</div>}
      {(draft.executionType ?? "agent") === "agent" && <><Label>Model <Select value={draft.model} disabled={target?.kind === "amp"} onChange={e => update("model", e.target.value)}><option value="">Harness default</option>{target?.models?.map(model => <option key={model}>{model}</option>)}{draft.model && !target?.models?.includes(draft.model) && <option value={draft.model}>{draft.model} (unavailable)</option>}</Select></Label>
      <Label>Effort <Select value={draft.effort} disabled={target?.kind === "amp"} onChange={e => update("effort", e.target.value)}><option value="">Harness default</option>{target?.efforts?.map(effort => <option key={effort}>{effort}</option>)}{draft.effort && !target?.efforts?.includes(draft.effort) && <option value={draft.effort}>{draft.effort} (unavailable)</option>}</Select></Label>
      <Label>Concurrency limit <Input required type="number" min={1} max={50} value={draft.concurrencyLimit} onChange={e => update("concurrencyLimit", e.target.valueAsNumber)} /></Label></>}
      {(draft.executionType ?? "agent") === "code" && <Label className="sm:col-span-2">Script <textarea required rows={12} className="w-full rounded border p-3 font-mono text-sm" value={draft.script ?? ""} onChange={e => update("script", e.target.value)} /></Label>}
      </div></Card></section>}{show("context") && <section id="context" aria-labelledby="context-heading" className="grid gap-4">{(draft.executionType ?? "agent") === "agent" ? <><h2 id="context-heading" className="sr-only">Context</h2><Card className="space-y-4"><h3>Skills</h3><p className="text-sm text-slate-600 dark:text-slate-400">Ordered global instructions are composed before this job context. Bodies remain literal.</p><div className="grid gap-2">{(draft.skillIds ?? []).map((id, index) => { const skill = skills.data?.items.find(item => item.id === id); return <div key={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-3 dark:border-slate-700"><span className="font-semibold">{index + 1}. {skill?.key ?? "Unavailable skill"}</span><Button type="button" onClick={() => update("skillIds", (draft.skillIds ?? []).filter(value => value !== id))}>Remove</Button><Button type="button" disabled={index === 0} onClick={() => { const next = [...(draft.skillIds ?? [])]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update("skillIds", next); }}>Up</Button><Button type="button" disabled={index === (draft.skillIds ?? []).length - 1} onClick={() => { const next = [...(draft.skillIds ?? [])]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; update("skillIds", next); }}>Down</Button></div>; })}</div><div className="flex flex-wrap gap-2"><Select aria-label="Add skill" value="" onChange={e => { if (e.target.value) update("skillIds", [...(draft.skillIds ?? []), e.target.value]); }}><option value="">Add skill…</option>{skills.data?.items.filter(skill => !(draft.skillIds ?? []).includes(skill.id)).map(skill => <option key={skill.id} value={skill.id}>{skill.key}</option>)}</Select><Link to="/skills" className="self-center text-sm font-semibold underline">Create or edit skills</Link></div></Card><Card className="space-y-5"><h2>Prompt and context</h2><p className="text-sm text-slate-600 dark:text-slate-400">Write instructions using context supplied by your triggers.</p><TemplateField label="Prompt template" multiline value={draft.promptTemplate} onChange={value => update("promptTemplate", value)} triggers={draft.triggers} />
      <TemplateField label="Run name template" value={draft.runNameTemplate ?? ""} onChange={value => update("runNameTemplate", value)} triggers={draft.triggers} />
      <Disclosure><Summary>Template variables</Summary>{metadata.error && <p role="alert">{metadata.error.message}</p>}{Object.entries(metadata.data ?? {}).map(([kind, fields]) => <Card key={kind}><h3>{kind}</h3><ul>{fields.map(field => <li key={field.path}><code>{field.path}</code> — {field.description}</li>)}</ul></Card>)}</Disclosure>
      </Card></> : <Card><h2 id="context-heading">Context</h2><p>Context settings are available for agent jobs.</p></Card>}</section>}{show("permissions") && <section id="permissions" aria-label="Permissions" className="grid gap-4"><RunPermissions value={draft.runScopes ?? defaultRunScopes} onChange={value => update("runScopes", value)} />{initial && <Card><InvocationPermissionEditor jobId={initial.id} /></Card>}</section>}{show("triggers") && <section id="triggers" aria-labelledby="triggers-heading"><Card><h2 id="triggers-heading">Triggers</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose the events that start this job.</p><TriggerEditor triggers={draft.triggers} projectId={selectedProjectId} onChange={value => update("triggers", value)} onValidityChange={setInvalidForm} />
      {initial?.triggers.map(trigger => trigger.kind === "webhook" && trigger.config.provider === "cloudflareTail" && trigger.config.destination ? <div key={trigger.id} className="mt-4 text-sm"><p>{trigger.slug} · Tail webhook destination</p><code className="break-all">{trigger.config.destination}</code></div> : null)}
      </Card></section>}{save.error && <p role="alert">{save.error.message}</p>}
      {!initial && <Button variant="primary" disabled={save.isPending || !!remote || reconciling || !!conflicts.length || targets.isPending || !!targets.error}>{save.isPending ? "Saving…" : "Create job"}</Button>}
      {initial && <AutosaveStatus state={autosave.state} error={autosave.error} label="Job settings" />}
      </div>
    </form>{saved && !initial && <p role="status">Job settings saved.</p>}{projectDialog && <ProjectDialog close={() => setProjectDialog(false)} onCreated={value => { cache.setQueryData(projectsQuery.queryKey, (current = []) => [...current, value]); void cache.invalidateQueries({ queryKey: ["projects"] }); update("projectId", value.id); setProjectDialog(false); }} />}
  </Page>;
}

function ProjectDialog({ close, onCreated }: { close: () => void; onCreated: (project: { id: string; name: string; description?: string; jobCount: number; createdAt: string; updatedAt: string }) => void }) {
  const [name, setName] = useState(""), [description, setDescription] = useState("");
  const create = useMutation({ retry: false, mutationFn: async () => { const trimmed = name.trim(); if (!trimmed) throw new Error("Project name is required."); const { data, error } = await api.POST("/api/v1/projects", { body: { name: trimmed, description: description.trim() || undefined } }); if (!data || error) throw new Error(messageOf(error)); return data; }, onSuccess: onCreated });
  return <Dialog title="Create new project" close={() => { if (!create.isPending) close(); }}><form className="space-y-5" onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(); }}><Label>Name<Input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label><Label>Description<Textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></Label>{create.error && <p role="alert">{create.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" onClick={close} disabled={create.isPending}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create project"}</Button></div></form></Dialog>;
}

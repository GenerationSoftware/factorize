import { modelAccountsQuery } from "../settings/queries";
import { PromptPreview } from "./prompt-preview";
import { teamQuery } from "../settings/team-query";
import type { TeamDefaults } from "./editor-state";
import { ProviderCredentials } from "./provider-credentials";
import { PresetPicker } from "../settings/preset-picker";
import type { VmPreset } from "../settings/preset-queries";
import { RunPermissions, defaultRunScopes } from "./run-permissions";
import { Disclosure, Summary, Button, Input, Select, Label, Page, Card, Textarea } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { DeleteTrigger } from "./delete";
import { validationMessage } from "./validation-message";
import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { triggerQuery } from "./queries";
import { metadataQuery, targetsQuery } from "./editor-queries";
import { canonicalizeVmImage, applySavedTrigger, editableTrigger, emptyTrigger, reconcile, validateTriggerInput, writeInput, type Trigger, type TriggerInput } from "./editor-state";
import { TemplateField } from "./template-field";
import { EventEditor } from "./trigger-editor";
import { InvocationPermissionEditor } from "./invocation-permission-editor";
import { NavIcon } from "../../shared/nav-icon";
import { messageOf } from "../auth/session";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { skillsQuery } from "../skills/queries";
import { FlyExecutionFields, flyConnectionQuery, flyConfigurationsQuery } from "../settings/fly";
import { TriggerNav } from "./job-nav";
export function TriggerEditor() {
  const { triggerId, section } = useParams({ strict: false });
  const trigger = useQuery({ ...triggerQuery(triggerId ?? ""), enabled: !!triggerId });
  const team = useQuery({...teamQuery,enabled:!triggerId});
  if (!triggerId && team.isPending) return <Page><p role="status">Loading Team defaults…</p></Page>;
  if (!triggerId && team.error) return <Page><div role="alert">{team.error.message} <Button onClick={() => void team.refetch()}>Retry</Button></div></Page>;
  if (triggerId && trigger.isPending) return <Page className="p-6"><p role="status">Loading trigger configuration…</p></Page>;
  if (triggerId && trigger.error) return <Page className="p-6"><p role="alert">{trigger.error.message}</p></Page>;
  return <>{trigger.data && <TriggerNav triggerId={trigger.data.id} tab="settings" />}<EditorForm key={triggerId ?? "new"} initial={trigger.data} defaults={team.data?.runDefaults} section={section} /></>;
}
function EditorForm({ initial, defaults, section }: { initial?: Trigger; defaults?:TeamDefaults; section?: string }) {
  const location = useLocation(), navigate = useNavigate(), cache = useQueryClient();
  const [base, setBase] = useState(() => initial ? editableTrigger(initial) : emptyTrigger(defaults));
  const [draft, setDraft] = useState(base), [revision, setRevision] = useState(initial?.updatedAt);
  const [remote, setRemote] = useState<Trigger>(), [conflicts, setConflicts] = useState<(keyof TriggerInput)[]>([]);
  const [reconciling, setReconciling] = useState(false), [saved, setSaved] = useState(false), [invalidForm, setInvalidForm] = useState(false);
  const savingNavigation = useRef(false);
  const [flySettingsDirty, setFlySettingsDirty] = useState(false);
  const dirty = flySettingsDirty || JSON.stringify(base) !== JSON.stringify(draft);
  useBlocker({ shouldBlockFn: ({ next }) => dirty && !(initial && next.pathname.startsWith(`/triggers/${initial.id}/settings/`)) && !savingNavigation.current && !window.confirm("Discard unsaved trigger changes?"), enableBeforeUnload: dirty });
  useEffect(() => { const handler = (inputEvent: BeforeUnloadEvent) => { if (dirty) { inputEvent.preventDefault(); inputEvent.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const [skillSearch,setSkillSearch]=useState("");
  const [previewEvent,setPreviewEvent]=useState("");
  const targets = useQuery(targetsQuery), metadata = useQuery(metadataQuery), skills = useQuery(skillsQuery(skillSearch));
  const flyConnection = useQuery(flyConnectionQuery), flyConfigurations = useQuery(flyConfigurationsQuery);
  const flyConfiguration = flyConfigurations.data?.find(item => item.id === draft.executionConfigId);
  const isFly = draft.executionConfigId === "fly-new" || Boolean(flyConfiguration);
  const accounts = useQuery({ ...modelAccountsQuery, enabled: (draft.executionType ?? "agent") === "agent", select: data => data.accounts });
  const target = targets.data?.find(t => t.id === draft.executionConfigId);
  const verificationFingerprint = JSON.stringify([draft.executionConfigId, canonicalizeVmImage(draft.vmImage ?? ""), draft.tags ?? []]);
  const verificationKey = `factorize-vm-image-verification:${initial?.id ?? "new"}`;
  const [verificationRef, setVerificationRef] = useState<{ fingerprint: string; id: string } | null>(() => { try { return JSON.parse(localStorage.getItem(verificationKey) ?? "null"); } catch { return null; } });
  const currentVerificationFingerprint = useRef(verificationFingerprint); currentVerificationFingerprint.current = verificationFingerprint;
  const verificationGeneration = useRef(0);
  const activeVerificationId = verificationRef?.fingerprint === verificationFingerprint ? verificationRef.id : "";
  const verification = useQuery({ queryKey: ["vm-image-verification", activeVerificationId], enabled: !!activeVerificationId, queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/vm-image-verifications/{verificationId}", { params: { path: { verificationId: activeVerificationId } }, signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, refetchInterval: query => query.state.data && ["succeeded", "failed", "cleanup_failed"].includes(query.state.data.status) ? false : 1500, refetchIntervalInBackground: true });
  const verifyImage = useMutation({ retry: false, mutationFn: async (snapshot: { fingerprint: string; generation: number }) => { const { data, error } = await api.POST("/api/v1/vm-image-verifications", { body: { connectionId: draft.executionConfigId ?? "", image: draft.vmImage?.trim() ?? "", tags: draft.tags ?? [] } }); if (!data || error) throw new Error(messageOf(error)); return { ...snapshot, id: data.id }; }, onSuccess: value => { if (currentVerificationFingerprint.current !== value.fingerprint || verificationGeneration.current !== value.generation) return; const record = { fingerprint: value.fingerprint, id: value.id }; setVerificationRef(record); localStorage.setItem(verificationKey, JSON.stringify(record)); } });
  const update = <K extends keyof TriggerInput>(key: K, value: TriggerInput[K]) => { setSaved(false); const sameImage = key === "vmImage" && canonicalizeVmImage(draft.vmImage ?? "") === canonicalizeVmImage(typeof value === "string" ? value : ""); if (["executionConfigId", "tags"].includes(key) || (key === "vmImage" && !sameImage)) { verificationGeneration.current++; setVerificationRef(null); localStorage.removeItem(verificationKey); } setDraft(previous => ({ ...previous, [key]: value })); };
  function applyPreset(preset: VmPreset) {
    const settings = preset.settings;
    setFlySettingsDirty(false);
    update("requiresVm",true);
    update("executionConfigId", preset.executionConfigId);
    update("tags", settings.provider === "exe" ? settings.tags : []);
    update("vmImage", settings.provider === "exe" ? settings.image : "");

  }
  const refreshConflict = useMutation({ retry: false, mutationFn: async () => {
    if (!initial) throw new Error("No trigger selected");
    const { data, error } = await api.GET("/api/v1/triggers/{triggerId}", { params: { path: { triggerId: initial.id } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: value => { setRemote(value); setReconciling(false); } });
  const save = useMutation({ retry: false, mutationFn: async (snapshot: TriggerInput) => {
    if (remote || conflicts.length) throw new Error("Resolve the stale edit before saving.");
    if (flySettingsDirty || snapshot.executionConfigId === "fly-new") throw new Error("Save Fly VM settings before saving the trigger.");
    const input = writeInput(snapshot);
    if (!initial && defaults) {
      for (const key of Object.keys(defaults) as (keyof TriggerInput)[]) {
        if (JSON.stringify(snapshot[key]) === JSON.stringify(base[key])) delete input[key];
      }
    }
    const result = initial ? await api.PUT("/api/v1/triggers/{triggerId}", { params: { path: { triggerId: initial.id } }, body: { ...input, expectedUpdatedAt: revision } }) : await api.POST("/api/v1/triggers", { body: input });
    if (result.error || !result.data) {
      if (result.error?.error.code === "stale_trigger") { setReconciling(true); refreshConflict.mutate(); }
      throw new Error(validationMessage(result.error));
    }
    return result.data;
  }, onSuccess: async (value, snapshot) => {
    savingNavigation.current = !initial;
    setSaved(true);
    if (!initial && verificationRef && verificationRef.fingerprint === currentVerificationFingerprint.current) localStorage.setItem(`factorize-vm-image-verification:${value.id}`, JSON.stringify(verificationRef));
    const accepted = editableTrigger(value);
    setBase(accepted);
    setDraft(current => applySavedTrigger(snapshot, current, accepted));
    setRevision(value.updatedAt);
    cache.setQueryData(triggerQuery(value.id).queryKey, value);
    await cache.invalidateQueries({ queryKey: ["triggers"] });
    if (!initial) void navigate({ to: "/triggers/$triggerId", params: { triggerId: value.id } });
  } });
  const autosave = useDebouncedAutosave({ value: draft, enabled: Boolean(initial) && !flySettingsDirty && dirty && !invalidForm && !remote && !reconciling && !conflicts.length, validate: validateTriggerInput, save: async snapshot => { await save.mutateAsync(snapshot); } });
  const acceptRemote = () => { if (!remote) return; const value = editableTrigger(remote); setDraft(value); setBase(value); setRevision(remote.updatedAt); setRemote(undefined); setConflicts([]); save.reset(); };
  const merge = () => { if (!remote) return; const value = editableTrigger(remote), result = reconcile(base, draft, value); setDraft(result.merged); setConflicts(result.conflicts); setBase(value); setRevision(remote.updatedAt); if (!result.conflicts.length) setRemote(undefined); save.reset(); };
  const resolve = (field: keyof TriggerInput, local: boolean) => {
    // Local values are kept separately from the merged draft until chosen.
    setDraft(previous => local ? { ...previous, [field]: localConflictDraft[field] } : previous); setConflicts(previous => previous.filter(key => key !== field));
    if (conflicts.length === 1) setRemote(undefined);
  };
  const [localConflictDraft, setLocalConflictDraft] = useState(draft);
  const selectedSection = initial && ["general", "vm", "context", "permissions", "events"].includes(section ?? "") ? section : initial ? "general" : "all";
  const show = (name: string) => selectedSection === "all" || selectedSection === name;
  const settingsSection = (name: "general" | "vm" | "context" | "permissions" | "events") => <Link to="/triggers/$triggerId/settings/$section" params={{ triggerId: initial!.id, section: name }} aria-current={selectedSection === name ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${selectedSection === name ? "bg-factorize-50 font-semibold text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" : "hover:bg-stone-100 dark:hover:bg-slate-800"}`}><NavIcon name={name} />{name === "vm" ? "VM" : name[0].toUpperCase() + name.slice(1)}</Link>;
  return <Page className="max-w-6xl">
    {initial?.contextReviewRequired && <Card role="alert">This Trigger used multiple skills. Select one skill in Context before enabling it.</Card>}
    {(remote || reconciling || refreshConflict.error) && <Card role="alert" className="my-4 border p-4"><h2>This trigger changed while you were editing</h2><p>Your unsaved draft is retained. Review the latest configuration before retrying.</p>
      {refreshConflict.isPending && <p>Loading latest configuration…</p>}{refreshConflict.error && <><p>{refreshConflict.error.message}</p><Button onClick={() => refreshConflict.mutate()}>Retry loading latest</Button></>}
      {remote && !conflicts.length && <><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(editableTrigger(remote), null, 2)}</pre><Button onClick={acceptRemote}>Reload latest and discard my changes</Button><Button onClick={() => { setLocalConflictDraft(draft); merge(); }}>Reconcile my changes</Button></>}
      {conflicts.map(field => <fieldset key={field}><legend>Both versions changed {field}</legend><pre className="max-h-40 overflow-auto">Mine: {JSON.stringify(localConflictDraft[field], null, 2)}<br />Latest: {JSON.stringify(base[field], null, 2)}</pre><Button onClick={() => resolve(field, true)}>Keep my {field}</Button><Button onClick={() => resolve(field, false)}>Keep latest {field}</Button></fieldset>)}
    </Card>}
    <form className="my-4 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8" onSubmit={e => { e.preventDefault(); save.mutate(draft); }}>
      <aside className="mb-5 lg:sticky lg:top-6 lg:mb-0"><nav aria-label="Trigger settings sections" className="grid gap-1">{initial ? <>{settingsSection("general")}{settingsSection("vm")}{settingsSection("context")}{settingsSection("permissions")}{settingsSection("events")}</> : <span className="px-3 py-2 text-sm font-semibold">General</span>}</nav></aside>
      <div className="grid gap-4">
      {show("general") && <section id="general" aria-labelledby="general-heading"><Card><h2 id="general-heading">General</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose a unique name shared with team skills. Use lowercase letters, digits, and single hyphens.</p><div className="grid gap-5 sm:grid-cols-2"><Label>Name <Input required maxLength={64} pattern="(?!manual$)[a-z0-9]+(-[a-z0-9]+)*" value={draft.name} onChange={e => update("name", e.target.value)} /></Label>
      </div></Card><Card className="mt-4"><h2>Model and capacity</h2><div className="mt-4 grid gap-5 sm:grid-cols-2">      {(draft.executionType ?? "agent") === "agent" && <><Label>Model<Input aria-label="Model" required value={draft.model} maxLength={120} placeholder="Provider model ID" onChange={e=>update("model",e.target.value)} /></Label>
      <Label>Effort<Select aria-label="Effort" value={draft.effort} onChange={e=>update("effort",e.target.value as TriggerInput["effort"])}><option value="">Default</option>{["minimal","low","medium","high","xhigh"].map(value=><option key={value}>{value}</option>)}</Select></Label>
      </>}<Label>Concurrency limit <Input required type="number" min={1} max={50} value={draft.concurrencyLimit} onChange={e => update("concurrencyLimit", e.target.valueAsNumber)} /></Label></div></Card>{initial && <DeleteTrigger triggerId={initial.id} name={initial.name} disabled={save.isPending} onDeleted={() => { savingNavigation.current = true; }} />}</section>}{show("vm") && <section id="vm" aria-labelledby="vm-heading"><Card><h2 id="vm-heading">VM</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Pi runs in Factorize. Enable a remote workspace when the task needs a VM. Scripts require a VM.</p><Label><input type="checkbox" checked={draft.executionType==="code" || Boolean(draft.requiresVm)} disabled={draft.executionType==="code"} onChange={event=>update("requiresVm",event.target.checked)} /> Requires VM</Label><fieldset disabled={!draft.requiresVm && draft.executionType!=="code"}><div className="grid gap-5 sm:grid-cols-2"><PresetPicker availableIds={[...(targets.data ?? []), ...(flyConfigurations.data ?? [])].map(item => item.id)} apply={applyPreset} /><Label>Integration <Select required value={draft.executionConfigId} onChange={e => { setFlySettingsDirty(false); update("executionConfigId", e.target.value); update("vmImage", ""); update("tags", []); }}><option value="">Choose an integration</option>{targets.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}{flyConnection.data && <option value="fly-new">Fly.io · New VM configuration</option>}{flyConfigurations.data?.filter(config => !config.presetName || config.id === draft.executionConfigId).map(config => <option key={config.id} value={config.id}>Fly.io · {config.presetName ?? config.name}</option>)}{draft.executionConfigId && !target && !isFly && <option value={draft.executionConfigId}>Unavailable integration: {draft.executionConfigId}</option>}</Select></Label>
      {targets.isPending && <p role="status">Loading integrations…</p>}{targets.error && <p role="alert">{targets.error.message}</p>}{targets.data?.length === 0 && !flyConnection.data && !flyConfigurations.data?.length && <p>Connect an execution provider in Integrations before creating a trigger.</p>}
      {flyConfiguration?.presetName && <p>{flyConfiguration.size} · {flyConfiguration.region} · {flyConfiguration.image}</p>}
      {isFly && !flyConfiguration?.presetName && <FlyExecutionFields key={draft.executionConfigId} initial={flyConfiguration} onDirty={() => setFlySettingsDirty(true)} onSaved={id => { setFlySettingsDirty(false); update("executionConfigId", id); update("vmImage", ""); }} />}

      {flyConnection.error && <p role="alert">Fly.io: {flyConnection.error.message}</p>}{flyConfigurations.error && <p role="alert">Fly.io: {flyConfigurations.error.message}</p>}
      {!isFly && <Label>VM tags <Select multiple value={draft.tags ?? []} onChange={e => update("tags", Array.from(e.target.selectedOptions, option => option.value))}>{target?.tags?.map(tag => <option key={tag}>{tag}</option>)}{(draft.tags ?? []).filter(tag => !target?.tags?.includes(tag)).map(tag => <option key={tag} value={tag}>{tag} (unavailable)</option>)}</Select></Label>}

      {!isFly && <div className="space-y-2"><Label>VM image <Input maxLength={512} placeholder="Default exe.dev image" value={draft.vmImage ?? ""} onChange={e => update("vmImage", e.target.value)} /><span className="text-xs text-slate-500">Optional public Docker/OCI image. Blank uses the exe.dev default.</span></Label>{draft.vmImage && <p className="text-sm" role="status">{verification.data?.status === "succeeded" && activeVerificationId ? `Verified: ${verification.data?.phase}` : verification.data?.status === "failed" && activeVerificationId ? `${verification.data?.errorKind}: ${verification.data?.error}` : verification.data?.status === "cleanup_failed" && activeVerificationId ? `Cleanup unresolved: ${verification.data?.error}` : activeVerificationId ? `Verification ${verification.data?.status}: ${verification.data?.phase}` : "Not verified"}</p>}{draft.vmImage && <Button type="button" disabled={!draft.executionConfigId || !target || verifyImage.isPending || ["queued", "creating", "checking_ssh", "checking_agent", "cleaning_up"].includes(verification.data?.status ?? "")} onClick={() => verifyImage.mutate({ fingerprint: verificationFingerprint, generation: verificationGeneration.current })}>{verifyImage.isPending ? "Starting verification…" : activeVerificationId && ["queued", "creating", "checking_ssh", "checking_agent", "cleaning_up"].includes(verification.data?.status ?? "") ? "Verification in progress…" : "Verify image"}</Button>}{verifyImage.error && <p role="alert">{verifyImage.error.message}</p>}</div>}


      </div></fieldset></Card></section>}{show("context") && <section id="context" aria-labelledby="context-heading" className="grid gap-4">{(draft.executionType ?? "agent") === "agent" ? <><h2 id="context-heading" className="sr-only">Context</h2><Card className="space-y-4"><h3>Skill</h3>{initial?.contextReviewRequired && <Button type="button" onClick={()=>save.mutate({...draft,skillId:draft.skillId ?? null})}>Use this context choice</Button>}<Label>Find skill<Input value={skillSearch} onChange={event=>setSkillSearch(event.target.value)} /></Label><Label>Skill<Select aria-label="Skill" value={draft.skillId ?? ""} onChange={event=>update("skillId",event.target.value || null)}><option value="">No skill</option>{skills.data?.items.map(skill=><option key={skill.id} value={skill.id}>{skill.key}</option>)}{draft.skillId && !skills.data?.items.some(skill=>skill.id===draft.skillId) && <option value={draft.skillId}>{initial?.skill?.key ?? "Selected skill"}</option>}</Select></Label><p className="text-sm">One optional team skill supplies reusable instructions. Its body remains literal.</p><Link to="/skills" className="text-sm underline">Create or edit skills</Link></Card><Card className="space-y-5"><h2>Prompt</h2><p className="text-sm">Optional literal instructions. Event templates add selected data, followed by manual instructions.</p><Label>Prompt<Textarea aria-label="Prompt" rows={8} maxLength={50_000} value={draft.prompt ?? ""} onChange={event=>update("prompt",event.target.value)} /></Label>
      <TemplateField label="Run name template" value={draft.runNameTemplate ?? ""} onChange={value => update("runNameTemplate", value)} events={draft.events} />
      <Label>Preview Event<Select aria-label="Preview Event" value={previewEvent || draft.events[0]?.slug || ""} onChange={event=>setPreviewEvent(event.target.value)}>{draft.events.map(event=><option key={event.slug} value={event.slug}>{event.slug} · {event.kind}</option>)}</Select></Label>
      <PromptPreview eventKind={draft.events.find(event=>event.slug===(previewEvent || draft.events[0]?.slug))?.kind ?? "manual"} skillId={draft.skillId} prompt={draft.prompt ?? ""} eventSlug={previewEvent || draft.events[0]?.slug} eventTemplate={draft.events.find(event=>event.slug===(previewEvent || draft.events[0]?.slug))?.template} runNameTemplate={draft.runNameTemplate} />
      <Disclosure><Summary>Template variables</Summary>{metadata.error && <p role="alert">{metadata.error.message}</p>}{Object.entries(metadata.data ?? {}).map(([kind, fields]) => <Card key={kind}><h3>{kind}</h3><ul>{fields.map(field => <li key={field.path}><code>{field.path}</code> — {field.description}</li>)}</ul></Card>)}</Disclosure>
      </Card></> : <Card><h2 id="context-heading">Script context</h2>      {(draft.executionType ?? "agent") === "code" && <Label className="sm:col-span-2">Script <textarea required rows={12} className="w-full rounded border p-3 font-mono text-sm" value={draft.script ?? ""} onChange={e => update("script", e.target.value)} /></Label>}</Card>}</section>}{show("permissions") && <section id="permissions" aria-label="Permissions" className="grid gap-4"><Card className="space-y-4">      {(draft.executionType??"agent")==="agent" && <>
        <Label>Model integration<Select required value={draft.modelAccountId??""} onChange={event=>update("modelAccountId",event.target.value||undefined)}><option value="">Choose a model integration</option>{accounts.data?.map(account=><option key={account.id} value={account.id} disabled={!account.credentialConfigured}>{account.name}{account.credentialConfigured?"":" (configuration required)"}</option>)}{draft.modelAccountId&&!accounts.data?.some(account=>account.id===draft.modelAccountId)&&<option value={draft.modelAccountId}>Unavailable model integration: {draft.modelAccountId}</option>}</Select><span className="text-xs">Configure an OpenAI-compatible provider in Integrations.</span>{accounts.error&&<span role="alert">{accounts.error.message}</span>}</Label>
      </>}<ProviderCredentials value={draft} onChange={value => setDraft(previous => ({...previous,...value}))} /></Card><RunPermissions value={draft.runScopes ?? defaultRunScopes} onChange={value => update("runScopes", value)} />{initial && <Card><InvocationPermissionEditor triggerId={initial.id} /></Card>}</section>}{show("events") && <section id="events" aria-labelledby="events-heading"><Card><h2 id="events-heading">Events</h2><p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Choose the events that start this trigger.</p><EventEditor events={draft.events} onChange={value => update("events", value)} onValidityChange={setInvalidForm} />
      {initial?.events.map(event => event.kind === "webhook" && event.config.provider === "cloudflareTail" && event.config.destination ? <div key={event.id} className="mt-4 text-sm"><p>{event.slug} · Tail webhook destination</p><code className="break-all">{event.config.destination}</code></div> : null)}
      </Card></section>}{save.error && <p role="alert">{save.error.message}</p>}
      {!initial && <Button variant="primary" disabled={save.isPending || !!remote || reconciling || !!conflicts.length || targets.isPending || !!targets.error}>{save.isPending ? "Saving…" : "Create trigger"}</Button>}
      {initial && <AutosaveStatus state={autosave.state} error={autosave.error} label="Trigger settings" />}
      </div>
    </form>{saved && !initial && <p role="status">Trigger settings saved.</p>}
  </Page>;
}

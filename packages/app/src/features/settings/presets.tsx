import { PresetSelect as Select } from "../../shared/preset-select";
import { ActionMenu } from "../../shared/action-menu";
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { TeamSettingsLayout } from "./team";
import { presetsQuery, presetSection, presetType, type Preset, type PresetInput, type PresetKind } from "./preset-queries";
import { messageOf } from "../auth/session";
import { integrationsQuery, modelAccountsQuery } from "./queries";
import { flyConnectionQuery, flyRegions, flySizes } from "./fly";
import { PresetVerification } from "./preset-verification";
import { RunPermissions } from "../jobs/run-permissions";
import { ProviderCredentials } from "../jobs/provider-credentials";
import { LifecycleSelector } from "../jobs/lifecycle-selector";
import { teamQuery } from "./team-query";

const title = (kind:PresetKind) => kind==="vm"?"VM":kind==="permission"?"Permission":"Model";
function summary(preset:Preset){
 if(preset.kind==="vm"){const s=preset.settings;return s.provider==="none"?"No VM":s.provider==="exe"?["exe.dev",s.image||"Provider default image",...s.tags].join(" · "):["Fly.io",s.size,s.region,s.image].join(" · ");}
 if(preset.kind==="model")return [preset.settings.model||"Model not selected",preset.settings.effort].filter(Boolean).join(" · ");
 return `${preset.settings.runScopes?.length??0} application permissions`;
}
export function PresetList({kind}:{kind:PresetKind}){
 const query=useQuery(presetsQuery),cache=useQueryClient(),[deleting,setDeleting]=useState<Preset>();
 const action=useMutation({mutationFn:async({preset,remove}:{preset:Preset;remove:boolean})=>{
  const result=remove?await api.DELETE("/api/v1/presets/{id}",{params:{path:{id:preset.id}}}):await api.POST("/api/v1/presets/{id}/default",{params:{path:{id:preset.id}}});
  if(result.error)throw new Error(messageOf(result.error));
 },onSuccess:async()=>{setDeleting(undefined);await Promise.all([cache.invalidateQueries({queryKey:presetsQuery.queryKey}),cache.invalidateQueries({queryKey:["skills"]})]);}});
 return <TeamSettingsLayout title={`${title(kind)} presets`}><div className="mb-5 flex items-center justify-between gap-4"><p className="text-sm">Skills inherit the team default unless they select a preset.</p><Link to="/settings/$presetKind/new" params={{presetKind:presetSection(kind)}} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-factorize-500 bg-factorize-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-factorize-100">Add preset</Link></div>
  {query.isPending&&<p role="status">Loading presets…</p>}{query.error&&<p role="alert">{query.error.message}</p>}
  {query.data&&<ul aria-label={`${title(kind)} presets`} className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900">{query.data.filter(p=>p.kind===kind).map(preset=><li key={preset.id} className="flex items-start justify-between gap-3 border-t border-stone-200 p-4 first:border-t-0 dark:border-slate-800"><div className="min-w-0 break-words"><strong>{preset.name}</strong>{preset.isDefault&&<span className="ml-2 rounded bg-factorize-50 px-2 py-1 text-xs text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500">Default</span>}<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{preset.slug} · revision {preset.revision}</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{summary(preset)}</p></div><PresetMenu preset={preset} pending={action.isPending} makeDefault={()=>action.mutate({preset,remove:false})} remove={()=>{action.reset();setDeleting(preset);}}/></li>)}</ul>}
  {query.data&&!query.data.some(p=>p.kind===kind)&&<p>No presets yet.</p>}{action.error&&!deleting&&<p role="alert">{action.error.message}</p>}
  {deleting&&<Dialog title={`Delete ${deleting.name}?`} close={()=>setDeleting(undefined)}><p>Delete this preset? Its historical revisions remain available for existing runs.</p>{action.error&&<p className="mt-3" role="alert">{action.error.message}</p>}<div className="mt-5 flex gap-2"><Button onClick={()=>setDeleting(undefined)}>Cancel</Button><Button variant="destructive" disabled={action.isPending} onClick={()=>action.mutate({preset:deleting,remove:true})}>Delete preset</Button></div></Dialog>}
  {kind==="vm"&&<TeamCapacity/>}
 </TeamSettingsLayout>;
}
function PresetMenu({preset,pending,makeDefault,remove}:{preset:Preset;pending:boolean;makeDefault:()=>void;remove:()=>void}){
 const navigate=useNavigate();
 return <ActionMenu name={preset.name} actions={[
  {label:"Edit",onClick:()=>void navigate({to:"/settings/$presetKind/$presetId/edit",params:{presetKind:presetSection(preset.kind),presetId:preset.id}})},
  {label:"Make team default",disabled:pending||preset.isDefault,onClick:makeDefault},
  {label:"Delete",destructive:true,disabled:pending||preset.isDefault,onClick:remove},
 ]}/>;
}
function TeamCapacity(){
 const query=useQuery(teamQuery),[value,setValue]=useState<number>(),cache=useQueryClient();
 const save=useMutation({mutationFn:async()=>{const latest=await api.GET("/api/v1/team");if(!latest.data)throw new Error(messageOf(latest.error));const result=await api.PUT("/api/v1/team/run-defaults",{body:{...latest.data.runDefaults,capacity:value??latest.data.runDefaults.capacity??4}});if(result.error)throw new Error(messageOf(result.error));},onSuccess:()=>cache.invalidateQueries({queryKey:teamQuery.queryKey})});
 return <Card className="mt-6"><form className="grid gap-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><Label>Team concurrency limit<Input required type="number" min={1} max={50} value={value??query.data?.runDefaults.capacity??4} onChange={e=>setValue(e.target.valueAsNumber)}/></Label>{save.error&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">Team capacity saved.</p>}<Button disabled={save.isPending||!query.data}>Save team capacity</Button></form></Card>;
}
export function PresetEditorPage(){
 const {presetKind,presetId}=useParams({strict:false});const kind=presetType(presetKind??"vm");const query=useQuery(presetsQuery);
 const initial=query.data?.find(p=>p.id===presetId&&p.kind===kind);
 return <TeamSettingsLayout title={`${presetId?"Edit":"Add"} ${title(kind)} preset`}>{query.isPending?<p role="status">Loading presets…</p>:query.error?<p role="alert">{query.error.message}</p>:presetId&&!initial?<p role="alert">Preset not found.</p>:<PresetEditor key={presetId??kind} kind={kind} initial={initial}/>}</TeamSettingsLayout>;
}
function PresetEditor({kind,initial}:{kind:PresetKind;initial?:Preset}){
 const navigate=useNavigate(),cache=useQueryClient();
 const [name,setName]=useState(initial?.name??""),[slug,setSlug]=useState(initial?.slug??"");
 const [settings,setSettings]=useState<any>(initial?.settings??(kind==="vm"?{provider:"none"}:kind==="permission"?{runScopes:[],portableIntegrationIds:[],githubInstallationIds:[],xConnectionIds:[],allowedTriggerIds:[]}:{model:"",effort:""}));
 const integrations=useQuery({...integrationsQuery,enabled:kind==="vm"}),fly=useQuery({...flyConnectionQuery,enabled:kind==="vm"}),accounts=useQuery({...modelAccountsQuery,enabled:kind==="model"});
 const back=()=>navigate({to:kind==="vm"?"/settings/vm":kind==="permission"?"/settings/permissions":"/settings/models"});
 const save=useMutation({mutationFn:async()=>{const body={kind,name,slug,settings,...(initial?{expectedRevision:initial.revision}:{})} as PresetInput;const result=initial?await api.PUT("/api/v1/presets/{id}",{params:{path:{id:initial.id}},body}):await api.POST("/api/v1/presets",{body});if(result.error)throw new Error(messageOf(result.error));},onSuccess:async()=>{await cache.invalidateQueries({queryKey:presetsQuery.queryKey});await back();}});
 const update=(patch:Record<string,unknown>)=>setSettings({...settings,...patch});
 return <Card><form className="grid gap-4" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="grid gap-4"><Label>Preset name<Input required maxLength={120} value={name} onChange={e=>{setName(e.target.value);if(!initial)setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""));}}/></Label><Label>Slug<Input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} disabled={!!initial} value={slug} onChange={e=>setSlug(e.target.value)}/></Label>
 {kind==="vm"&&<><Label>Execution provider<Select aria-label="Execution provider" value={settings.provider} onChange={e=>setSettings(e.target.value==="none"?{provider:"none"}:e.target.value==="fly"?{provider:"fly",region:"iad",size:"shared-cpu-1x",image:""}:{provider:"exe",connectionId:"",image:"",tags:[]})}><option value="none">No VM</option><option value="exe">exe.dev</option><option value="fly" disabled={!fly.data}>Fly.io</option></Select></Label>
 {settings.provider==="exe"&&<><Label>Connection<Select aria-label="Connection" required value={settings.connectionId} onChange={e=>update({connectionId:e.target.value,tags:[]})}><option value="">Choose a connection</option>{integrations.data?.exeConnections.map(item=><option key={item.connectionId} value={item.connectionId}>{item.connectionId}</option>)}</Select></Label><fieldset><legend>VM tags</legend>{Array.from(new Set([...(integrations.data?.exeConnections.find(item=>item.connectionId===settings.connectionId)?.accountTags??[]),...settings.tags] as string[])).map(tag=><Label key={tag}><input type="checkbox" checked={settings.tags.includes(tag)} onChange={e=>update({tags:e.target.checked?[...settings.tags,tag]:settings.tags.filter((t:string)=>t!==tag)})}/>{tag}</Label>)}</fieldset></>}
 {settings.provider==="fly"&&<><Label>Region<Select aria-label="Region" value={settings.region} onChange={e=>update({region:e.target.value})}>{flyRegions.map(region=><option key={region}>{region}</option>)}</Select></Label><Label>VM size<Select aria-label="VM size" value={settings.size} onChange={e=>update({size:e.target.value})}>{flySizes.map(size=><option key={size}>{size}</option>)}</Select></Label></>}
 {settings.provider!=="none"&&<Label>VM image<Input required={settings.provider==="fly"} maxLength={512} value={settings.image} placeholder="Provider default image" onChange={e=>update({image:e.target.value})}/></Label>}
 {settings.provider==="exe"&&settings.connectionId&&settings.image&&<PresetVerification key={JSON.stringify(settings)} connectionId={settings.connectionId} image={settings.image} tags={settings.tags}/>}
 {(integrations.error||fly.error)&&<p role="alert">{(integrations.error??fly.error)?.message}</p>}</>}
 {kind==="permission"&&<><RunPermissions value={settings.runScopes??[]} onChange={runScopes=>update({runScopes})}/><ProviderCredentials value={settings} onChange={setSettings}/><LifecycleSelector kind="destination" selected={settings.allowedTriggerIds??[]} onChange={allowedTriggerIds=>update({allowedTriggerIds})}/></>}
 {kind==="model"&&<><Label>Model account<Select aria-label="Model account" required value={settings.modelAccountId??""} onChange={e=>update({modelAccountId:e.target.value})}><option value="">Choose a model account</option>{accounts.data?.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</Select></Label><Label>Model<Input required value={settings.model??""} onChange={e=>update({model:e.target.value})}/></Label><Label>Effort<Select aria-label="Effort" value={settings.effort??""} onChange={e=>update({effort:e.target.value})}>{["","minimal","low","medium","high","xhigh"].map(value=><option key={value} value={value}>{value||"Provider default"}</option>)}</Select></Label>{accounts.error&&<p role="alert">{accounts.error.message}</p>}</>}
 {save.error&&<p role="alert">{save.error.message}</p>}<div className="flex gap-2"><Button type="button" onClick={()=>void back()}>Cancel</Button><Button variant="primary" type="submit">Save preset</Button></div></fieldset></form></Card>;
}

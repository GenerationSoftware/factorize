import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";

const key = ["settings", "permission-presets"];
const standardScopes = ["team:read","team:write","triggers:read","triggers:write","integrations:read","integrations:write","skills:read","skills:write","proxy:use","apps:manage"];
type Preset = {id:string;name:string;scopes:string[];isDefault:boolean;revision:number};
export function Permissions() {
  const cache = useQueryClient();
  const presets = useQuery({queryKey:key,queryFn:async({signal})=>{const {data,error}=await api.GET("/api/v1/permission-presets",{signal});if(!data||error)throw new Error(messageOf(error));return data as Preset[];}});
  const integrations = useQuery({queryKey:["settings","api-policies"],queryFn:async({signal})=>{const {data,error}=await api.GET("/api/v1/integration-api-policies",{signal});if(!data||error)throw new Error(messageOf(error));return data.integrations;}});
  const [editing,setEditing]=useState<Preset|null>(null),[name,setName]=useState(""),[scopes,setScopes]=useState<string[]>([]),[error,setError]=useState(""),[formOpen,setFormOpen]=useState(false);
  const refresh=()=>cache.invalidateQueries({queryKey:key});
  const save=useMutation({retry:false,mutationFn:async()=>{
    const body={name:name.trim(),scopes};
    const result=editing?await api.PUT("/api/v1/permission-presets/{presetId}",{params:{path:{presetId:editing.id}},body:{...body,expectedRevision:editing.revision}}):await api.POST("/api/v1/permission-presets",{body});
    if(result.error)throw new Error(messageOf(result.error));
  },onSuccess:async()=>{setEditing(null);setName("");setScopes([]);setError("");setFormOpen(false);await refresh();},onError:e=>setError(e.message)});
  const action=useMutation({retry:false,mutationFn:async({preset,kind}:{preset:Preset;kind:"default"|"delete"})=>{
    const result=kind==="default"?await api.POST("/api/v1/permission-presets/{presetId}/default",{params:{path:{presetId:preset.id}}}):await api.DELETE("/api/v1/permission-presets/{presetId}",{params:{path:{presetId:preset.id}}});
    if(result.error)throw new Error(messageOf(result.error));
  },onSuccess:refresh,onError:e=>setError(e.message)});
  const toggle=(scope:string)=>setScopes(current=>current.includes(scope)?current.filter(value=>value!==scope):[...current,scope]);
  const begin=(preset?:Preset)=>{setEditing(preset??null);setName(preset?.name??"");setScopes(preset?.scopes??[]);setError("");setFormOpen(true);};
  const scopeOptions=[...standardScopes,...(integrations.data??[]).filter(row=>row.available&&row.policy!=="disabled").map(row=>row.requiredScope)];
  const labels=new Map((integrations.data??[]).map(row=>[row.requiredScope,`${row.name} integration access`]));
  return <SettingsLayout title="Permissions">
    <p className="mb-5">Create scope presets for new client connections. The default preset preselects scopes during authorization. Existing client permissions remain individually editable.</p>
    {(presets.error||integrations.error||error)&&<p role="alert">{error||(presets.error??integrations.error)?.message}</p>}
    {presets.isPending&&<p role="status">Loading permission presets…</p>}
    {!!presets.data?.length&&<ul className="mb-6 divide-y rounded-xl border dark:border-slate-800">{presets.data.map(preset=><li key={preset.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div><strong>{preset.name}</strong>{preset.isDefault&&<span className="ml-2 rounded bg-factorize-50 px-2 py-1 text-xs text-factorize-700">Default</span>}<p className="mt-1 text-sm text-slate-600">{preset.scopes.map(scope=>labels.get(scope)??scope).join(", ")||"No scopes"}</p></div>
      <div className="flex flex-wrap gap-2"><Button onClick={()=>begin(preset)}>Edit</Button><Button disabled={preset.isDefault||action.isPending} onClick={()=>action.mutate({preset,kind:"default"})}>Make default</Button><Button disabled={action.isPending} onClick={()=>{if(window.confirm(`Delete permission preset ${preset.name}?`))action.mutate({preset,kind:"delete"});}}>Delete</Button></div>
    </li>)}</ul>}
    {!presets.isPending&&!presets.data?.length&&<p className="mb-5">No permission presets yet.</p>}
    {formOpen?<form className="grid gap-4 rounded-xl border p-4" onSubmit={event=>{event.preventDefault();save.mutate();}}>
      <h2>{editing?`Edit ${editing.name}`:"New permission preset"}</h2>
      <Label>Preset name<Input required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></Label>
      <fieldset className="grid gap-2"><legend>Scopes</legend>{scopeOptions.map(scope=><Label key={scope} className="flex items-center gap-2"><Input type="checkbox" checked={scopes.includes(scope)} onChange={()=>toggle(scope)}/>{labels.get(scope)??scope}</Label>)}</fieldset>
      {save.isPending&&<p role="status">Saving preset…</p>}
      <div className="flex gap-2"><Button type="button" onClick={()=>setFormOpen(false)}>Cancel</Button><Button variant="primary" disabled={save.isPending||!integrations.data}>Save preset</Button></div>
    </form>:<Button variant="primary" onClick={()=>begin()}>Create permission preset</Button>}
  </SettingsLayout>;
}

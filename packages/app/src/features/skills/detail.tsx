import Markdown from "react-markdown";
import { SkillDirectory } from "./directory";
import { SkillNavigation } from "./navigation";
import { SkillTriggerSettings } from "./trigger-settings";
import { SkillEditor, type Definition } from "./editor";
import { PresetCombobox } from "../settings/preset-combobox";
import { presetsQuery } from "../settings/preset-queries";
import { RunList } from "../runs/list";
import { useLocation,useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button,Card,Page,PageHeader } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { skillQuery } from "./queries";
export function SkillDetail(){
 const {skillId:routeSkillId}=useParams({strict:false}),skillId=routeSkillId!;
 const pathname=useLocation({select:l=>l.pathname});const tab=pathname.endsWith("/triggers")?"triggers":pathname.endsWith("/runs")?"runs":"overview";
 const skill=useQuery(skillQuery(skillId)),presets=useQuery(presetsQuery),cache=useQueryClient();
 const [editing,setEditing]=useState<{definition:Definition;revision:number}>();
 const edit=useMutation({mutationFn:async({definition,revision}:{definition:Definition;revision:number})=>{
  const result=await api.PUT("/api/v1/skills/{skillId}",{params:{path:{skillId}},body:{key:definition.name,definition,expectedRevision:revision}});if(!result.data||result.error)throw new Error(messageOf(result.error));return result.data;
 },onSuccess:async updated=>{cache.setQueryData(skillQuery(skillId).queryKey,updated);setEditing(undefined);await Promise.all([cache.invalidateQueries({queryKey:["skills","list"]}),cache.invalidateQueries({queryKey:["skill-library"]})]);}});
 const definition=skill.data?.definition??(skill.data?{name:skill.data.key,description:"",factorize:{concurrency:0,disabled:false},markdown:skill.data.body}:undefined);
 return <><SkillNavigation skillId={skillId} tab={tab}/><Page className="max-w-6xl">{skill.isPending&&<p role="status">Loading skill…</p>}{skill.error&&<p role="alert">{skill.error.message}</p>}{skill.data&&definition&&<>{tab==="triggers"?<SkillTriggerSettings skillId={skillId}/>:tab==="runs"?<><PageHeader title="Runs"/><RunList skillId={skillId}/></>:<><PageHeader title={skill.data.key} description={`Revision ${skill.data.revision}`}><Button disabled={edit.isPending} onClick={()=>{edit.reset();setEditing({definition,revision:skill.data!.revision});}}>Edit</Button></PageHeader>{editing?<SkillEditor initial={editing.definition} pending={edit.isPending} error={edit.error} save={value=>edit.mutate({definition:value,revision:editing.revision})} cancel={()=>{setEditing(undefined);edit.reset();}}/>:<><Card className="mb-5"><div className="grid gap-4 lg:grid-cols-3">{(["vm","permission","model"] as const).map(kind=><PresetCombobox key={kind} kind={kind} presets={presets.data??[]} disabled={edit.isPending||!presets.data} value={definition.factorize[`${kind}-preset`]} onChange={value=>edit.mutate({definition:{...definition,factorize:{...definition.factorize,[`${kind}-preset`]:value}},revision:skill.data!.revision})}/>)}</div>{presets.error&&<p role="alert">{presets.error.message}</p>}{edit.isPending&&<p role="status" className="mt-3">Saving presets…</p>}{edit.isSuccess&&<p role="status" className="mt-3">Skill saved.</p>}{edit.error&&<div className="mt-3"><p role="alert">{edit.error.message}</p><Button onClick={()=>{edit.reset();void skill.refetch();}}>Reload skill</Button></div>}{definition.factorize.disabled&&<p className="mt-3 text-sm">Disabled · new runs are paused.</p>}</Card><Card><div className="skill-markdown space-y-4 break-words [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-stone-100 [&_pre]:p-4 dark:[&_pre]:bg-slate-950"><Markdown skipHtml>{definition.markdown}</Markdown></div></Card></>}<SkillDirectory skillId={skillId} revision={skill.data.revision}/></>}</>}</Page></>;
}

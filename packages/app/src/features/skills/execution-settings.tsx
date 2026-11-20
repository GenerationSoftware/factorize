import { useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { api,type operations } from "factorize-api-client";
import { TeamRunDefaults } from "../settings/team-run-defaults";
import { Button,Card,Label,Select,Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
type Defaults=operations["put_api_v1_skills_skillId_settings"]["requestBody"]["content"]["application/json"]["defaults"];
export function SkillExecutionSettings({skillId,section}:{skillId:string;section:"general"|"vm"|"permissions"}){
 const cache=useQueryClient();
 const query=useQuery({queryKey:["skill-settings",skillId],queryFn:async()=>{const {data,error}=await api.GET("/api/v1/skills/{skillId}/settings",{params:{path:{skillId}}});if(!data||error)throw new Error(messageOf(error));return data;}});
 const save=async(patch:Partial<Defaults>,keys:readonly string[])=>{
  const latest=await api.GET("/api/v1/skills/{skillId}/settings",{params:{path:{skillId}}});if(!latest.data||latest.error)throw new Error(messageOf(latest.error));
  const defaults={...latest.data.defaults};
  for(const key of keys){delete (defaults as Record<string,unknown>)[key];if((patch as Record<string,unknown>)[key]!==undefined)Object.assign(defaults,{[key]:(patch as Record<string,unknown>)[key]});}
  const {data,error}=await api.PUT("/api/v1/skills/{skillId}/settings",{params:{path:{skillId}},body:{defaults,expectedRevision:latest.data.revision}});if(!data||error)throw new Error(messageOf(error));
  cache.setQueryData(["skill-settings",skillId],data);await Promise.all([cache.invalidateQueries({queryKey:["skills"]}),cache.invalidateQueries({queryKey:["skill-trigger",skillId]})]);
 };
 const permissionKeys=["runScopes","portableIntegrationIds","githubInstallationIds","linearConnectionId","xConnectionIds","allowedTriggerIds"];
 const vmKeys=["requiresVm","executionConfigId","vmImage","tags","modelAccountId","model","effort","concurrencyLimit"];
 return <>{query.isPending&&<p role="status">Loading skill defaults…</p>}{query.error&&<p role="alert">{query.error.message}</p>}{query.data&&(section==="general"?<General initial={query.data.defaults} save={draft=>save(draft,["executionType","script","prompt",...(draft.executionType==="code"?["requiresVm"]:[])])}/>:<TeamRunDefaults key={section} section={section} initial={query.data.defaults} onSave={draft=>save(draft,section==="permissions"?permissionKeys:vmKeys)}/>)}</>;
}
function General({initial,save}:{initial:Defaults;save:(draft:Defaults)=>Promise<void>}){
 const [draft,setDraft]=useState(initial);
 const mutation=useMutation({mutationFn:()=>save({...draft,...(draft.executionType==="code"?{requiresVm:true}:{script:undefined})})});
 return <Card><form className="grid gap-4" onSubmit={event=>{event.preventDefault();mutation.mutate();}}><Label>Execution mode<Select value={draft.executionType??"agent"} onChange={event=>setDraft({...draft,executionType:event.target.value as "agent"|"code"})}><option value="agent">Agent</option><option value="code">Script</option></Select></Label>{draft.executionType==="code"?<Label>Script<Textarea aria-label="Script" required rows={12} value={draft.script??""} onChange={event=>setDraft({...draft,script:event.target.value})}/></Label>:<Label>Prompt<Textarea aria-label="Prompt" rows={8} maxLength={50000} value={draft.prompt??""} onChange={event=>setDraft({...draft,prompt:event.target.value})}/></Label>}<p className="text-sm">Saved settings apply to future manual and event-triggered runs. Edit the skill name and instructions on Overview.</p>{mutation.error&&<p role="alert">{mutation.error.message}</p>}{mutation.isSuccess&&<p role="status">Skill settings saved.</p>}<Button disabled={mutation.isPending}>Save skill settings</Button></form></Card>;
}

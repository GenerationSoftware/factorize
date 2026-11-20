import { SkillDirectory } from "./directory";
import { SkillNavigation, SkillSettingsNavigation } from "./navigation";
import { SkillExecutionSettings } from "./execution-settings";
import { SkillTriggerSettings } from "./trigger-settings";
import { RunList } from "../runs/list";
import { StartRun } from "../runs/start";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label, Page, PageHeader, Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { skillQuery } from "./queries";

export function SkillDetail() {
  const { skillId: routeSkillId, section } = useParams({ strict:false });
  const skillId=routeSkillId!;
  const pathname=useLocation({select:location=>location.pathname});
  const tab=pathname.includes("/settings")?"settings":pathname.endsWith("/runs")?"runs":"overview";
  const skill = useQuery(skillQuery(skillId));
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false), [key, setKey] = useState(""), [body, setBody] = useState("");
  const edit = useMutation({ mutationFn: async () => { const result = await api.PUT("/api/v1/skills/{skillId}", { params: { path: { skillId } }, body: { key, body, expectedRevision: skill.data!.revision } }); if (!result.data || result.error) throw new Error(messageOf(result.error)); return result.data; }, onSuccess: async updated => { cache.setQueryData(skillQuery(skillId).queryKey, updated); await Promise.all([cache.invalidateQueries({ queryKey: ["skills"] }), cache.invalidateQueries({ queryKey: ["skill-library"] })]); setEditing(false); } });
  const startEditing = () => { if (!skill.data) return; setKey(skill.data.key); setBody(skill.data.body); setEditing(true); };
  return <><SkillNavigation skillId={skillId} tab={tab}/><Page className="max-w-6xl">{skill.isPending&&<p role="status">Loading skill…</p>}{skill.error&&<p role="alert">{skill.error.message}</p>}{skill.data&&<>{tab==="settings"?<div className="grid min-w-0 gap-8 md:grid-cols-[13rem_minmax(0,1fr)]"><SkillSettingsNavigation skillId={skillId} section={section??"general"}/><div className="min-w-0"><PageHeader title={section==="trigger"?"Trigger settings":section==="vm"?"VM defaults":section==="permissions"?"Permissions":"General settings"}/>{section==="trigger"?<SkillTriggerSettings skillId={skillId}/>:<SkillExecutionSettings key={section} skillId={skillId} section={(section??"general") as "general"|"vm"|"permissions"}/>}</div></div>:tab==="runs"?<><PageHeader title="Runs"/><RunList skillId={skillId}/></>:<><PageHeader title={skill.data.key} description={`Revision ${skill.data.revision}`}><StartRun skillId={skillId}/><Button onClick={startEditing}>Edit</Button></PageHeader>{editing?<Card><form className="grid gap-4" onSubmit={event=>{event.preventDefault();edit.mutate();}}><Label>Key<Input required maxLength={64} pattern="(?!manual$)[a-z0-9]+(-[a-z0-9]+)*" value={key} onChange={event=>setKey(event.target.value)}/></Label><Label>Literal body<Textarea required className="min-h-56" value={body} onChange={event=>setBody(event.target.value)}/></Label><p className="text-sm">Changes apply to future runs of this skill.</p>{edit.error&&<p role="alert">{edit.error.message}</p>}<div className="flex gap-2"><Button type="button" onClick={()=>setEditing(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={edit.isPending}>Save skill</Button></div></form></Card>:<Card><h2 className="mb-3">Instructions</h2><pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6">{skill.data.body}</pre></Card>}<SkillDirectory skillId={skillId} revision={skill.data.revision}/></>}</>}</Page></>;
}

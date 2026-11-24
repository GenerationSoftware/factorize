import { useState } from "react";
import { Link,useNavigate,useSearch } from "@tanstack/react-router";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button,Card,Page,Table,tableHeadClasses,tableRowClasses,tableCellClasses } from "../../shared/ui";
import { skillsQuery } from "./queries";
import { SkillEditor,emptyDefinition,type Definition } from "./editor";
import { messageOf } from "../auth/session";
export function SkillsLibrary(){
 const cache=useQueryClient(),navigate=useNavigate(),search=useSearch({from:"/skills"}),[creating,setCreating]=useState(false);
 const skills=useQuery(skillsQuery("",search.cursor));
 const save=useMutation({mutationFn:async(definition:Definition)=>{const result=await api.POST("/api/v1/skills",{body:{key:definition.name,definition}});if(!result.data||result.error)throw new Error(messageOf(result.error));return result.data;},onSuccess:async()=>{setCreating(false);await Promise.all([cache.invalidateQueries({queryKey:["skills"]}),cache.invalidateQueries({queryKey:["skill-library"]})]);}});
 const history=search.previous?.split(",")??[];
 return <Page className="max-w-6xl"><div className="mb-5 flex items-center justify-end gap-3"><Button variant="primary" onClick={()=>{save.reset();setCreating(true);}}>New skill</Button></div>{creating&&<div className="mb-5"><SkillEditor initial={emptyDefinition()} pending={save.isPending} error={save.error} save={value=>save.mutate(value)} cancel={()=>setCreating(false)}/></div>}
 {skills.isPending&&<p role="status">Loading skills…</p>}{skills.error&&<p role="alert">{skills.error.message}</p>}
 {skills.data&&<><Table aria-label="Skills" className="table-fixed"><colgroup><col className="w-32 sm:w-48"/><col/></colgroup><thead className={tableHeadClasses}><tr>{["Skill name","Description"].map(label=><th scope="col" key={label} className={`${tableCellClasses} whitespace-nowrap`}>{label}</th>)}</tr></thead><tbody>{skills.data.items.map(skill=><tr key={skill.id} className={tableRowClasses}><td className={tableCellClasses}><Link to="/skills/$skillId" params={{skillId:skill.id}} className="break-words font-semibold hover:text-factorize-700 dark:hover:text-factorize-500">{skill.key}</Link></td><td className={`${tableCellClasses} min-w-0`}><p className="line-clamp-3 break-words">{skill.description||"—"}</p></td></tr>)}</tbody></Table>{!skills.data.items.length&&<Card className="mt-4 py-10 text-center"><h2>No skills yet</h2><p>Create a skill to get started.</p></Card>}
 <div className="mt-4 flex gap-3">{history.length>0&&<Button onClick={()=>{const previous=[...history],cursor=previous.pop();void navigate({to:"/skills",search:{cursor:cursor==="first"?undefined:cursor,previous:previous.length?previous.join(","):undefined}});}}>Previous skills</Button>}{skills.data.nextCursor&&<Button onClick={()=>void navigate({to:"/skills",search:{cursor:skills.data!.nextCursor!,previous:[...history,search.cursor??"first"].join(",")}})}>More skills</Button>}</div></>}
 </Page>;
}

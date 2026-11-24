import { useState } from "react";
import type { operations } from "factorize-api-client";
import { Button, Card, Input, Label, Textarea } from "../../shared/ui";
export type Definition=NonNullable<operations["get_api_v1_skills_skillId"]["responses"][200]["content"]["application/json"]["definition"]>;
export const emptyDefinition=():Definition=>({name:"",description:"",markdown:""});
export function SkillEditor({initial,pending,error,save,cancel}:{initial:Definition;pending:boolean;error?:Error|null;save:(value:Definition)=>void;cancel:()=>void}){
 const [draft,setDraft]=useState(initial);
 return <Card><form className="grid gap-5" onSubmit={e=>{e.preventDefault();save(draft);}}><fieldset disabled={pending} className="grid gap-4"><legend className="mb-4 font-semibold">Skill document</legend><Label>Name<Input required maxLength={64} pattern="(?!manual$)[a-z0-9]+(-[a-z0-9]+)*" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Label><Label>Description<Textarea aria-label="Description" maxLength={1024} rows={2} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></Label><Label>Markdown body<Textarea aria-label="Markdown body" className="min-h-72 font-mono" value={draft.markdown} onChange={e=>setDraft({...draft,markdown:e.target.value})}/></Label>{error&&<p role="alert">{error.message}</p>}<div className="flex gap-2"><Button type="button" onClick={cancel}>Cancel</Button><Button type="submit" variant="primary">{pending?"Saving…":"Save skill"}</Button></div></fieldset></form></Card>;
}

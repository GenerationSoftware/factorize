import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { EventEditor } from "../jobs/trigger-editor";
import { Button, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { editableTrigger } from "../jobs/editor-state";
import type { Event } from "../jobs/editor-state";
type Input={events:Event[];enabled:boolean;expectedUpdatedAt?:string};
export function SkillTriggerSettings({skillId}:{skillId:string}){
 const cache=useQueryClient(),[draft,setDraft]=useState<Input>(),[invalid,setInvalid]=useState(false);
 const query=useQuery({queryKey:["skill-trigger",skillId],queryFn:async()=>{const {data,error}=await api.GET("/api/v1/skills/{skillId}/trigger",{params:{path:{skillId}}});if(!data||error)throw new Error(messageOf(error));return data;}});
 const trigger=query.data?.trigger;
 const value:Input=draft??{events:(trigger?editableTrigger(trigger).events.filter(event=>event.kind!=="manual"):undefined)??[],enabled:trigger?.enabled??true,expectedUpdatedAt:trigger?.updatedAt};
 const save=useMutation({mutationFn:async()=>{const {data,error}=await api.PUT("/api/v1/skills/{skillId}/trigger",{params:{path:{skillId}},body:value});if(!data||error)throw new Error(messageOf(error));return data;},onSuccess:async data=>{cache.setQueryData(["skill-trigger",skillId],data);setDraft(undefined);await cache.invalidateQueries({queryKey:["skills"]});}});
 return <div className="grid gap-4">{query.isPending&&<p role="status">Loading trigger…</p>}{query.error&&<p role="alert">{query.error.message}</p>}{query.data&&<form className="grid gap-4" onSubmit={event=>{event.preventDefault();save.mutate();}}><Label><input type="checkbox" checked={value.enabled} onChange={event=>setDraft({...value,enabled:event.target.checked})}/> Automation enabled</Label>{!value.events.length&&<p>No triggers configured. Add a trigger to automate this skill.</p>}<EventEditor addLabel="Add trigger" events={value.events} onChange={events=>setDraft({...value,events})} onValidityChange={setInvalid}/>{save.error&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">Trigger saved.</p>}<Button disabled={save.isPending||invalid}>Save trigger</Button></form>}</div>;
}

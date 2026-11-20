import {useState,useEffect} from "react";
import {useMutation} from "@tanstack/react-query";
import {api} from "factorize-api-client";
import {Button,Disclosure,Summary,Label,Textarea} from "../../shared/ui";
import {messageOf} from "../auth/session";

export function PromptPreview({skillId,prompt,eventTemplate,eventSlug,eventKind,runNameTemplate}:{skillId?:string|null;prompt:string;eventTemplate?:string;eventSlug?:string;eventKind:"manual"|"schedule"|"webhook"|"triggerLifecycle"|"triggerIdle";runNameTemplate?:string}) {
  const [sample,setSample]=useState("{}"),[instructions,setInstructions]=useState("");
  const preview=useMutation({retry:false,mutationFn:async()=>{
    let eventData:Record<string,unknown>;
    try {eventData=JSON.parse(sample);if(!eventData || typeof eventData!=="object" || Array.isArray(eventData))throw new Error();}
    catch {throw new Error("Enter an Event data JSON object.");}
    const {data,error}=await api.POST("/api/v1/triggers/preview",{body:{skillId,prompt,eventTemplate,eventSlug,eventKind,eventData,instructions:eventKind==="manual"?instructions:"",runNameTemplate}});
    if(!data||error)throw new Error(messageOf(error));return data;
  }});
  useEffect(()=>preview.reset(),[skillId,prompt,eventTemplate,eventSlug,eventKind,runNameTemplate]);
  return <Disclosure><Summary>Preview run context</Summary><div className="grid gap-4 py-3">
    <Label>Sample Event data JSON<Textarea aria-label="Sample Event data JSON" rows={6} maxLength={200000} value={sample} onChange={event=>{setSample(event.target.value);preview.reset();}} /></Label>
    {eventKind==="manual" && <Label>Manual instructions for preview<Textarea aria-label="Manual instructions for preview" rows={3} value={instructions} onChange={event=>{setInstructions(event.target.value);preview.reset();}} /></Label>}
    <Button type="button" disabled={preview.isPending} onClick={()=>preview.mutate()}>{preview.isPending?"Rendering…":"Render preview"}</Button>
    {preview.error&&<p role="alert">{preview.error.message}</p>}
    {preview.data&&<div role="region" aria-label="Run context preview"><p>Run name: {preview.data.runName}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{preview.data.prompt || "No instructions yet."}</pre></div>}
  </div></Disclosure>;
}

import {useEffect, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {api} from "factorize-api-client";
import {Button, Input, Label} from "../../shared/ui";
import {messageOf} from "../auth/session";

import { Dialog } from "../../shared/dialog";
import { IntegrationRow, ProviderTile } from "./integration-ui";

type Account={id:string; name:string; description:string|null; revision:number; credentialConfigured:boolean};
type Authorization={state:string; verificationUrl?:string; userCode?:string; pollAfterSeconds?:number};
const queryKey=["settings","model-accounts"];
async function authorization(accountId:string,action:"authorize"|"status"|"cancel"):Promise<Authorization> {
  const path=action==="authorize" ? "/api/v1/model-accounts/{accountId}/authorization/authorize" : action==="status" ? "/api/v1/model-accounts/{accountId}/authorization/status" : "/api/v1/model-accounts/{accountId}/authorization/cancel";
  const {data,error}=await api.POST(path,{params:{path:{accountId}},body:{}});
  if(!data || error) throw new Error(messageOf(error));
  return data;
}
export function useModelAccounts() {
  const cache=useQueryClient();
  const accounts=useQuery({queryKey,queryFn:async({signal})=>{const {data,error}=await api.GET("/api/v1/model-accounts",{signal}); if(!data || error) throw new Error(messageOf(error)); if(!Array.isArray(data.accounts) || !Number.isSafeInteger(data.revision)) throw new Error("Model accounts could not be loaded. Reload the page to try again."); return data;}});
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState<string|null>(null),[states,setStates]=useState<Record<string,Authorization>>({}),[error,setError]=useState("");
  const [name,setName]=useState(""),[description,setDescription]=useState(""),[kind,setKind]=useState<"chatgpt"|"api-key">("chatgpt"),[key,setKey]=useState(""),[editId,setEditId]=useState<string|null>(null);
  const refresh=()=>cache.invalidateQueries({queryKey:["settings"]});
  const connect=async(id:string)=>{
    setError("");
    try {const state=await authorization(id,"authorize"); setStates(current=>({...current,[id]:state})); setActive(state.state==="pending"?id:null);}
    catch(reason) {setError(reason instanceof Error?reason.message:"Could not connect the account.");}
  };
  useEffect(()=>{
    if(!active) return;
    let stopped=false,inFlight=false;
    const poll=async()=>{
      if(inFlight) return;
      inFlight=true;
      try {const state=await authorization(active,"status"); if(stopped) return; setStates(current=>({...current,[active]:state})); if(state.state!=="pending") {setActive(null); await cache.invalidateQueries({queryKey});}}
      catch(reason) {if(!stopped) setError(reason instanceof Error?reason.message:"Could not check authorization.");}
      finally {inFlight=false;}
    };
    const timer=window.setInterval(()=>void poll(),2000);
    return()=>{stopped=true;window.clearInterval(timer);};
  },[active,cache]);
  const reset=()=>{setEditId(null);setName("");setDescription("");setKey("");setKind("chatgpt");};
  const save=useMutation({retry:false,mutationFn:async()=>{
    if(!accounts.data) throw new Error("Model accounts are still loading.");
    if(kind==="api-key" && !key.trim()) throw new Error("Enter the replacement API key.");
    const body={expectedRevision:accounts.data.revision,idempotencyKey:crypto.randomUUID(),name:name.trim(),description:description.trim()||null,initialState:kind==="api-key"?JSON.stringify({OPENAI_API_KEY:key.trim()}):"{}"};
    const id=editId??crypto.randomUUID();
    const response=editId?await api.PUT("/api/v1/model-accounts/{accountId}",{params:{path:{accountId:id}},body}):await api.POST("/api/v1/model-accounts",{body:{...body,id}});
    if(!response.data || response.error) throw new Error(messageOf(response.error));
    return{id,connect:kind==="chatgpt"};
  },onSuccess:async(result)=>{reset();setOpen(false);setError("");await refresh();if(result.connect) await connect(result.id);},onError:async(reason)=>{setError(reason.message);await refresh();}});
  const remove=useMutation({retry:false,mutationFn:async(account:Account)=>{
    if(!accounts.data) throw new Error("Model accounts are still loading.");
    const {data,error}=await api.DELETE("/api/v1/model-accounts/{accountId}",{params:{path:{accountId:account.id}},body:{expectedRevision:accounts.data.revision,idempotencyKey:crypto.randomUUID()}});
    if(!data || error) throw new Error(messageOf(error));
  },onSuccess:async()=>{setError("");await refresh();},onError:async(reason)=>{setError(reason.message);await refresh();}});
  const cancel=async(id:string)=>{
    try {const state=await authorization(id,"cancel");setStates(current=>({...current,[id]:state}));setActive(null);}
    catch(reason) {setError(reason instanceof Error?reason.message:"Could not cancel authorization.");}
  };
  const close=()=>{reset();setOpen(false);setError("");};
  return {
    count:accounts.data?.accounts.length??0,pending:accounts.isPending,
    rows:accounts.data?.accounts.map(account=>{
      const state=states[account.id];
      return <IntegrationRow key={account.id} kind="model" credentialId={account.id} name={account.name} detail={account.description??"Model account"} connected={account.credentialConfigured} status={account.credentialConfigured?"Connected":"Not connected"} actions={[
        state?.state==="pending" ? {label:"Cancel authorization",onClick:()=>void cancel(account.id)} : {label:account.credentialConfigured?"Reconnect ChatGPT":"Connect ChatGPT",disabled:Boolean(active)||remove.isPending,onClick:()=>void connect(account.id)},
        {label:"Replace API key",disabled:Boolean(active)||save.isPending,onClick:()=>{setEditId(account.id);setName(account.name);setDescription(account.description??"");setKind("api-key");setKey("");setOpen(true);}},
        {label:"Delete account",destructive:true,disabled:remove.isPending||Boolean(active),onClick:()=>{if(window.confirm(`Delete ${account.name}? Existing run access will remain revoked even after reconnection.`)) remove.mutate(account);}},
      ]}>
        {state?.state==="pending"&&<div className="mt-3 space-y-1 text-sm" role="status"><p>Enter this one-time code to connect ChatGPT: <strong className="select-all">{state.userCode}</strong></p><a className="underline" href={state.verificationUrl} target="_blank" rel="noreferrer">Open ChatGPT device authorization</a><Button onClick={()=>void cancel(account.id)}>Cancel authorization</Button></div>}
        {state?.state==="authorized"&&<p role="status">Account connected.</p>}{state?.state==="canceled"&&<p role="status">Authorization attempt canceled.</p>}
        {["expired","failed","reauthentication-required"].includes(state?.state??"")&&<p role="alert">Authorization did not complete. Connect the account again.</p>}
      </IntegrationRow>;
    }),
    tile:<ProviderTile kind="model" name="Model account" description="Connect ChatGPT or an OpenAI API key." count={accounts.data?.accounts.length??0} onAdd={()=>{reset();setError("");setOpen(true);}} />,
    feedback:<>{accounts.error&&<p role="alert">{accounts.error.message}</p>}{error&&!open&&<p role="alert">{error}</p>}</>,
    dialog:open&&<Dialog title={editId?"Replace model credential":"Add a model account"} close={close}><p className="text-sm">Connect ChatGPT or save an OpenAI API key. Stored credentials cannot be viewed.</p>
    <form className="mt-3 grid gap-3" onSubmit={event=>{event.preventDefault();setError("");save.mutate();}}>
      <Label>Name <Input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></Label>
      <Label>Description (optional) <Input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)}/></Label>
      {!editId&&<Label>Connection <select className="rounded-lg border border-stone-300 bg-transparent p-2 dark:border-slate-700" value={kind} onChange={event=>{setKind(event.target.value as "chatgpt"|"api-key");setKey("");}}><option value="chatgpt">ChatGPT device authorization</option><option value="api-key">OpenAI API key</option></select></Label>}
      {kind==="api-key"&&<Label>API key <Input type="password" required autoComplete="off" maxLength={16384} value={key} onChange={event=>setKey(event.target.value)}/></Label>}
      <div className="flex gap-2"><Button variant="primary" disabled={save.isPending||accounts.isPending||Boolean(accounts.error)||Boolean(active)}>{save.isPending?"Saving…":editId?"Replace credential":kind==="chatgpt"?"Add and connect ChatGPT":"Save model account"}</Button>{editId&&<Button type="button" onClick={()=>{reset();setOpen(false);}}>Cancel replacement</Button>}</div>
    </form>{error&&<p role="alert">{error}</p>}</Dialog>,
  };
}

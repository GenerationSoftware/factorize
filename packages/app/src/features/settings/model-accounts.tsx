import {useEffect, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {api} from "factorize-api-client";
import {Button, Card, Input, Label} from "../../shared/ui";
import {messageOf} from "../auth/session";

type Account={id:string; name:string; description:string|null; revision:number; credentialConfigured:boolean};
type Authorization={state:string; verificationUrl?:string; userCode?:string; pollAfterSeconds?:number};
const queryKey=["settings","model-accounts"];
async function authorization(accountId:string,action:"authorize"|"status"|"cancel"):Promise<Authorization> {
  const path=action==="authorize" ? "/api/v1/model-accounts/{accountId}/authorization/authorize" : action==="status" ? "/api/v1/model-accounts/{accountId}/authorization/status" : "/api/v1/model-accounts/{accountId}/authorization/cancel";
  const {data,error}=await api.POST(path,{params:{path:{accountId}},body:{}});
  if(!data || error) throw new Error(messageOf(error));
  return data;
}
export function ModelAccounts() {
  const cache=useQueryClient();
  const accounts=useQuery({queryKey,queryFn:async({signal})=>{const {data,error}=await api.GET("/api/v1/model-accounts",{signal}); if(!data || error) throw new Error(messageOf(error)); return data;}});
  const [active,setActive]=useState<string|null>(null),[states,setStates]=useState<Record<string,Authorization>>({}),[error,setError]=useState("");
  const [name,setName]=useState(""),[description,setDescription]=useState(""),[kind,setKind]=useState<"chatgpt"|"api-key">("chatgpt"),[key,setKey]=useState(""),[editId,setEditId]=useState<string|null>(null);
  const refresh=()=>cache.invalidateQueries({queryKey});
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
  },onSuccess:async(result)=>{reset();setError("");await refresh();if(result.connect) await connect(result.id);},onError:async(reason)=>{setError(reason.message);await refresh();}});
  const remove=useMutation({retry:false,mutationFn:async(account:Account)=>{
    if(!accounts.data) throw new Error("Model accounts are still loading.");
    const {data,error}=await api.DELETE("/api/v1/model-accounts/{accountId}",{params:{path:{accountId:account.id}},body:{expectedRevision:accounts.data.revision,idempotencyKey:crypto.randomUUID()}});
    if(!data || error) throw new Error(messageOf(error));
  },onSuccess:async()=>{setError("");await refresh();},onError:async(reason)=>{setError(reason.message);await refresh();}});
  const cancel=async(id:string)=>{
    try {const state=await authorization(id,"cancel");setStates(current=>({...current,[id]:state}));setActive(null);}
    catch(reason) {setError(reason instanceof Error?reason.message:"Could not cancel authorization.");}
  };
  return <section className="mt-10 space-y-4" aria-labelledby="model-accounts-heading">
    <div><h2 id="model-accounts-heading" className="text-2xl font-bold">Model accounts</h2><p className="text-sm text-slate-600 dark:text-slate-400">Connect ChatGPT or save an OpenAI API key. Factorize stores and refreshes credentials on the server. Stored credentials cannot be viewed.</p></div>
    {accounts.isPending&&<p role="status">Loading model accounts…</p>}{accounts.error&&<p role="alert">{accounts.error.message}</p>}{error&&<p role="alert">{error}</p>}
    {accounts.data?.accounts.length===0&&<Card><p>No model accounts are configured yet.</p></Card>}
    {accounts.data?.accounts.map(account=>{const state=states[account.id];return <Card key={account.id} className="flex flex-wrap items-start gap-3">
      <div className="min-w-40 flex-1"><p className="font-semibold">{account.name}</p>{account.description&&<p>{account.description}</p>}<p className="text-sm">{account.credentialConfigured?"Credentials saved":"Not connected"}</p>
        {state?.state==="pending"&&<div className="mt-2 space-y-1" role="status"><p>Enter this one-time code to connect ChatGPT:</p><p><strong className="select-all">{state.userCode}</strong></p><a className="underline" href={state.verificationUrl} target="_blank" rel="noreferrer">Open ChatGPT device authorization</a></div>}
        {state?.state==="authorized"&&<p role="status">Account connected.</p>}{state?.state==="canceled"&&<p role="status">Authorization attempt canceled.</p>}
        {["expired","failed","reauthentication-required"].includes(state?.state??"")&&<p role="alert">Authorization did not complete. Connect the account again.</p>}
      </div>
      {state?.state==="pending"?<Button onClick={()=>void cancel(account.id)}>Cancel authorization</Button>:<Button disabled={Boolean(active)||remove.isPending} onClick={()=>void connect(account.id)}>{account.credentialConfigured?"Reconnect ChatGPT":"Connect ChatGPT"}</Button>}
      <Button disabled={Boolean(active)||save.isPending} onClick={()=>{setEditId(account.id);setName(account.name);setDescription(account.description??"");setKind("api-key");setKey("");}}>Replace API key</Button>
      <Button variant="destructive" disabled={remove.isPending||Boolean(active)} onClick={()=>{if(window.confirm(`Delete ${account.name}? Existing run access will remain revoked even after reconnection.`)) remove.mutate(account);}}>Delete account</Button>
    </Card>;})}
    <Card><h3 className="font-semibold">{editId?"Replace model credential":"Add a model account"}</h3><form className="mt-3 grid gap-3" onSubmit={event=>{event.preventDefault();setError("");save.mutate();}}>
      <Label>Name <Input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></Label>
      <Label>Description (optional) <Input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)}/></Label>
      {!editId&&<Label>Connection <select className="rounded-lg border border-stone-300 bg-transparent p-2 dark:border-slate-700" value={kind} onChange={event=>{setKind(event.target.value as "chatgpt"|"api-key");setKey("");}}><option value="chatgpt">ChatGPT device authorization</option><option value="api-key">OpenAI API key</option></select></Label>}
      {kind==="api-key"&&<Label>API key <Input type="password" required autoComplete="off" maxLength={16384} value={key} onChange={event=>setKey(event.target.value)}/></Label>}
      <div className="flex gap-2"><Button variant="primary" disabled={save.isPending||accounts.isPending||Boolean(accounts.error)||Boolean(active)}>{save.isPending?"Saving…":editId?"Replace credential":kind==="chatgpt"?"Add and connect ChatGPT":"Save model account"}</Button>{editId&&<Button type="button" onClick={reset}>Cancel replacement</Button>}</div>
    </form></Card>
  </section>;
}

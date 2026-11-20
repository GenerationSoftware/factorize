import {modelAccountsQuery} from "./queries";
import {useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {api} from "factorize-api-client";
import {Button,Input,Label} from "../../shared/ui";
import {messageOf} from "../auth/session";
import {Dialog} from "../../shared/dialog";
import {IntegrationRow,ProviderTile} from "./integration-ui";
type Account={id:string;name:string;description:string|null;providerUrl:string|null;credentialConfigured:boolean};
export function useModelAccounts(){
 const cache=useQueryClient(),[open,setOpen]=useState(false),[editId,setEditId]=useState<string|null>(null),[name,setName]=useState(""),[description,setDescription]=useState(""),[providerUrl,setProviderUrl]=useState(""),[key,setKey]=useState(""),[error,setError]=useState(""),[contextWindow,setContextWindow]=useState(128000),[maxTokens,setMaxTokens]=useState(8192);
 const accounts=useQuery(modelAccountsQuery);
 const refresh=()=>cache.invalidateQueries({queryKey:["settings"]});
 const reset=()=>{setEditId(null);setName("");setDescription("");setProviderUrl("");setKey("");setContextWindow(128000);setMaxTokens(8192);setError("");};
 const save=useMutation({retry:false,mutationFn:async()=>{
  if(!accounts.data)throw new Error("Model integrations are still loading.");
  const body={expectedRevision:accounts.data.revision,idempotencyKey:crypto.randomUUID(),name:name.trim(),description:description.trim()||null,providerUrl:providerUrl.trim(),contextWindow,maxTokens,...(key.trim()?{apiKey:key.trim()}:{} )};
  const response=editId?await api.PUT("/api/v1/model-accounts/{accountId}",{params:{path:{accountId:editId}},body}):await api.POST("/api/v1/model-accounts",{body:{...body,id:crypto.randomUUID()}});
  if(!response.data||response.error)throw new Error(messageOf(response.error));
 },onSuccess:async()=>{reset();setOpen(false);await refresh();},onError:async reason=>{setError(reason.message);await refresh();}});
 const remove=useMutation({retry:false,mutationFn:async(account:Account)=>{
  if(!accounts.data)throw new Error("Model integrations are still loading.");
  const {data,error}=await api.DELETE("/api/v1/model-accounts/{accountId}",{params:{path:{accountId:account.id}},body:{expectedRevision:accounts.data.revision,idempotencyKey:crypto.randomUUID()}});if(!data||error)throw new Error(messageOf(error));
 },onSuccess:async()=>{setError("");await refresh();},onError:async reason=>{setError(reason.message);await refresh();}});
 return {count:accounts.data?.accounts.length??0,pending:accounts.isPending,
  rows:accounts.data?.accounts.map(account=><IntegrationRow key={account.id} kind="model" credentialId={account.id} name={account.name} detail={account.providerUrl??"Provider URL required"} connected={account.credentialConfigured} status={account.credentialConfigured?"Configured":"Configuration required"} actions={[
   {label:"Edit model integration",disabled:save.isPending,onClick:()=>{reset();setEditId(account.id);setName(account.name);setDescription(account.description??"");setProviderUrl(account.providerUrl??"");setContextWindow(account.contextWindow??128000);setMaxTokens(account.maxTokens??8192);setOpen(true);}},
   {label:"Delete account",destructive:true,disabled:remove.isPending,onClick:()=>{if(window.confirm(`Delete ${account.name}?`))remove.mutate(account);}},
  ]}/>),
  tile:<ProviderTile kind="model" name="Model integration" description="OpenAI-compatible provider URL and optional API key." count={accounts.data?.accounts.length??0} onAdd={()=>{reset();setOpen(true);}}/>,
  feedback:<>{accounts.error&&<p role="alert">{accounts.error.message}</p>}{error&&!open&&<p role="alert">{error}</p>}</>,
  dialog:open&&<Dialog title={editId?"Edit model integration":"Add a model integration"} close={()=>{reset();setOpen(false);}}><p className="text-sm">Pi uses this OpenAI-compatible endpoint. Choose the model in Team or Trigger settings.</p><form className="mt-3 grid gap-3" onSubmit={event=>{event.preventDefault();save.mutate();}}>
   <Label>Name<Input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></Label>
   <Label>Description (optional)<Input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)}/></Label>
   <Label>Provider URL<Input required type="url" placeholder="https://provider.example/v1" maxLength={2048} value={providerUrl} onChange={event=>setProviderUrl(event.target.value)}/></Label>
   <Label>API key (optional)<Input aria-label="API key (optional)" type="password" autoComplete="off" maxLength={32768} value={key} onChange={event=>setKey(event.target.value)}/><span className="text-xs">Blank saves a keyless integration. Enter the replacement key when editing an authenticated provider.</span></Label>
   <details><summary>Model limits</summary><Label>Context window (tokens)<Input required type="number" min={1024} max={2000000} value={contextWindow} onChange={event=>setContextWindow(event.target.valueAsNumber)}/></Label><Label>Maximum output tokens<Input required type="number" min={1} max={200000} value={maxTokens} onChange={event=>setMaxTokens(event.target.valueAsNumber)}/></Label></details>
   <Button variant="primary" disabled={save.isPending||accounts.isPending||Boolean(accounts.error)}>{save.isPending?"Saving…":"Save model integration"}</Button>
  </form>{error&&<p role="alert">{error}</p>}</Dialog>};
}

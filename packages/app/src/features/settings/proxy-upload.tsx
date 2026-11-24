import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useParams} from "@tanstack/react-router";
import {api} from "factorize-api-client";
import {Page,Card,Button} from "../../shared/ui";
import {messageOf} from "../auth/session";

export function ProxyUpload(){
 const {handle}=useParams({strict:false}) as {handle:string};const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const query=useQuery({queryKey:["proxy-payload",handle],queryFn:async()=>{const {data,error}=await api.GET("/api/v1/proxy-payloads/{handle}",{params:{path:{handle}}});if(error||!data)throw new Error(messageOf(error));return data;},retry:false});
 const upload=async()=>{if(!file)return;setError("");if(file.size>32*1024*1024){setError("Choose a file no larger than 32 MiB.");return;}setBusy(true);try{const {error}=await api.PUT("/api/v1/proxy-payloads/{handle}/bytes",{params:{path:{handle}},body:file as never,bodySerializer:()=>file,headers:{"Content-Type":"application/octet-stream"}});if(error)throw new Error(messageOf(error));await query.refetch();}catch(error){setError(error instanceof Error?error.message:"Upload failed. Try again.");}finally{setBusy(false);}};
 return <Page><Card><h1>Upload a request file</h1><p>The file goes directly to Factorize for the connection that requested it. Temporary files expire after 30 minutes.</p>{query.isPending?<p role="status">Loading upload…</p>:query.error?<p role="alert">{query.error.message}</p>:query.data?.state==="ready"?<div role="status"><p>Upload complete. Return to your chat and use this payload handle:</p><code className="break-all">{query.data.handle}</code><p>{query.data.size.toLocaleString()} bytes · SHA-256 <span className="break-all">{query.data.sha256}</span></p></div>:<div className="space-y-4"><p>Requested file: {query.data?.name}</p><label className="block">File<input type="file" aria-label="File" disabled={busy} onChange={event=>setFile(event.target.files?.[0]??null)}/></label><Button disabled={!file||busy} onClick={()=>void upload()}>{busy?"Uploading…":"Upload file"}</Button></div>}{error&&<p role="alert">{error}</p>}</Card></Page>;
}

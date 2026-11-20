import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button,Card } from "../../shared/ui";
import { messageOf } from "../auth/session";
type File={path:string;content:string;executable:boolean};
type Tree={files:File[];directories:Map<string,Tree>};
function treeOf(files:File[]){const root:Tree={files:[],directories:new Map()};for(const file of files){const parts=file.path.split("/");let node=root;for(const part of parts.slice(0,-1)){if(!node.directories.has(part))node.directories.set(part,{files:[],directories:new Map()});node=node.directories.get(part)!;}node.files.push(file);}return root;}
function TreeView({tree,select}:{tree:Tree;select:(path:string)=>void}){return <ul className="space-y-1">{[...tree.directories].sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=><li key={name}><details open><summary className="cursor-pointer py-1 font-semibold">{name}/</summary><div className="ml-3 border-l pl-3"><TreeView tree={child} select={select}/></div></details></li>)}{tree.files.map(file=><li key={file.path}><button type="button" aria-label={`Open file ${file.path}`} className="w-full break-all rounded px-2 py-1 text-left hover:bg-stone-100 dark:hover:bg-slate-800" onClick={()=>select(file.path)}>{file.path.split("/").at(-1)}</button></li>)}</ul>;}
function FileView({file}:{file:File}){let text:string|undefined,bytes=0;try{const raw=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0));bytes=raw.length;const decoded=new TextDecoder("utf-8",{fatal:true}).decode(raw);if(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded))text=decoded;}catch{}
 return <div className="min-w-0"><h3 className="mb-3 break-all font-semibold">{file.path}{file.executable?" · executable":""}</h3>{text===undefined?<p>Binary file · {bytes} bytes. Text preview unavailable.</p>:<pre tabIndex={0} aria-label={`Contents of ${file.path}`} className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-sm">{text}</pre>}</div>;
}
export function SkillDirectory({skillId,revision}:{skillId:string;revision:number}){
 const [selected,setSelected]=useState<string>();
 const query=useQuery({queryKey:["skills","files",skillId,revision],staleTime:60_000,retry:false,queryFn:async()=>{const {data,error}=await api.GET("/api/v1/skills/{skillId}/files",{params:{path:{skillId}}});if(!data||error||!Array.isArray(data.files))throw new Error(messageOf(error));return data;}});
 const file=query.data?.files.find(file=>file.path===selected);
 return <Card className="mt-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2>Skill directory</h2><Button disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh files</Button></div>{query.isPending&&<p role="status">Loading files…</p>}{query.error&&<p role="alert">{query.data?`Refresh failed; showing cached revision ${query.data.revision}. `:""}{query.error.message}</p>}{query.data&&<><p className="mb-4 text-xs text-slate-500">Revision {query.data.revision}{query.data.commit?` · Commit ${query.data.commit.slice(0,12)}`:""}</p><div className="grid min-w-0 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]"><nav aria-label="Skill files" className="min-w-0 text-sm"><TreeView tree={treeOf(query.data.files)} select={setSelected}/></nav>{file?<FileView file={file}/>:<p className="text-sm text-slate-500">Choose a file to view its contents.</p>}</div></>}</Card>;
}

import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {Env} from "./types";
import type {PiLease} from "./postgres/pi-session-repository";
import type {PersistedRun} from "./postgres/run-repository";
import {issueHostedRunCredential} from "./hosted-run-auth";
import worker from "./worker";
import {SKILLS_EXTENSION} from "./mcp-skills";

export type McpFetch=(request:Request)=>Promise<Response>;
const metadata={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{name:"factorize-pi",version:"1.5.2"},"io.modelcontextprotocol/clientCapabilities":{}};
/** Model tools adapt protocol messages, never call application service methods. */
export class PiMcpClient {
 private sequence=0;
 constructor(private origin:string,private fetch:McpFetch,private credential:()=>Promise<string>){}
 async request(method:string,params:Record<string,unknown>={},signal?:AbortSignal):Promise<any>{
  const token=await this.credential(),name=method==="tools/call"?String(params.name):method==="resources/read"?String(params.uri):undefined;
  const headers:Record<string,string>={"Content-Type":"application/json",Accept:"application/json, text/event-stream","Mcp-Method":method,Host:new URL(this.origin).host,Authorization:"Bearer "+token};
  if(name)headers["Mcp-Name"]=/^[\x20-\x7e]*$/.test(name)?name:`=?base64?${btoa(String.fromCharCode(...new TextEncoder().encode(name)))}?=`;
  const response=await this.fetch(new Request(new URL("/mcp",this.origin),{method:"POST",headers,body:JSON.stringify({jsonrpc:"2.0",id:++this.sequence,method,params:{...params,_meta:metadata}}),signal}));
  const text=await response.text();
  if(!response.ok)throw new Error(`MCP request failed (${response.status}).`);
  const body=JSON.parse(text.startsWith("{")?text:text.split("\n").find(line=>line.startsWith("data: "))?.slice(6)??"null");
  if(!body||body.error)throw new Error(body?.error?.message??"Invalid MCP response.");
  return body.result;
 }
 async tools():Promise<AgentTool<any>[]>{
  const discovery=await this.request("server/discover");
  const tools:AgentTool<any>[]=[];let cursor:string|undefined;
  do{
   const page=await this.request("tools/list",cursor?{cursor}:{});
   for(const tool of page.tools??[])tools.push({name:tool.name,label:tool.title??tool.name,description:tool.description??tool.name,parameters:tool.inputSchema,execute:async(_id,args,signal)=>{
    const result=await this.request("tools/call",{name:tool.name,arguments:args},signal);
    return {content:contentForPi(result.content),details:{mcp:result},isError:result.isError===true};
   }});
   cursor=page.nextCursor;
  }while(cursor);
  if(discovery.capabilities?.resources)tools.push({name:"mcp_read_resource",label:"Read MCP resource",description:"Read a resource URI from this Factorize MCP session with standard resources/read. Skill files are ordinary resources.",parameters:{type:"object",properties:{uri:{type:"string"}},required:["uri"],additionalProperties:false},execute:async(_id,args,signal)=>{
   const result=await this.request("resources/read",args,signal);
   return {content:contentForPi((result.contents??[]).map((value:any)=>({type:"resource",resource:value}))),details:{mcp:result}};
  }});
  if(discovery.capabilities?.extensions?.[SKILLS_EXTENSION]){
   for(const [name,method,description,parameters] of [
    ["mcp_list_skills","skills/list","Discover build-shipped Factorize workflow skills. Team skills use list_skills/get_skill; pinned run inputs are resources.",{type:"object",properties:{cursor:{type:"string"}},additionalProperties:false}],
    ["mcp_get_skill","skills/get","Inspect a built-in workflow's frontmatter and file manifest by its SKILL.md URI.",{type:"object",properties:{uri:{type:"string"}},required:["uri"],additionalProperties:false}],
   ] as const)tools.push({name,label:name,description,parameters,execute:async(_id,args,signal)=>{const result=await this.request(method,args,signal);return {content:[{type:"text",text:JSON.stringify(result)}],details:{mcp:result}};}});
  }
  return tools;
 }
}
function contentForPi(content:any[]):({type:"text";text:string}|{type:"image";data:string;mimeType:string})[]{
 return (content??[]).map(block=>{
  if(block.type==="image")return {type:"image",data:block.data,mimeType:block.mimeType};
  if(block.type==="resource" && typeof block.resource?.blob==="string" && String(block.resource?.mimeType).startsWith("image/"))return {type:"image",data:block.resource.blob,mimeType:block.resource.mimeType};
  if(block.type==="text")return {type:"text",text:block.text};
  if(block.type==="resource" && typeof block.resource?.text==="string")return {type:"text",text:block.resource.text};
  return {type:"text",text:JSON.stringify(block)};
 });
}
export async function createPiMcpTools(env:Env,_run:PersistedRun,lease:PiLease,context?:Pick<ExecutionContext,"waitUntil">):Promise<AgentTool<any>[]>{
 const background:Promise<unknown>[]=[];
 const ctx=context ?? {waitUntil:(promise:Promise<unknown>)=>{background.push(promise);}};
 const client=new PiMcpClient(env.APP_ORIGIN,async request=>{
  const response=await worker.fetch!(request,env,ctx as ExecutionContext);
  if(!context)await Promise.all(background.splice(0));
  return response;
 },()=>issueHostedRunCredential(lease,env.SESSION_SIGNING_SECRET));
 return client.tools();
}

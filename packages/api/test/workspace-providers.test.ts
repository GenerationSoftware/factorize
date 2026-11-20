import {describe,it,expect,vi} from "vitest";
import {exeWorkspace,flyWorkspace} from "../src/workspace-providers";
const runId="11111111-1111-4111-8111-111111111111",tenantId="22222222-2222-4222-8222-222222222222";
describe("documented workspace provider transports",()=>{
 it("uses exe.dev NDJSON for exact exit status and preserves combined output",async()=>{
  let created=false,removed=false;const commands:string[]=[];
  const fetcher:typeof fetch=vi.fn(async(_url,init)=>{
   const command=String(init?.body);commands.push(command);
   if(command==="integrations list --json")return Response.json([]);
   if(command.startsWith("ls"))return Response.json(created&&!removed?[{name:`factorize-${runId}`,comment:`Factorize VM factorize-${runId}`}]:[]);
   if(command.startsWith("new"))created=true;if(command.startsWith("rm"))removed=true;
   if(command.startsWith("ssh")){expect(new Headers(init?.headers).get("Accept")).toBe("application/x-ndjson");return new Response('{"stdout":"b3V0"}\n{"stderr":"ZXJy"}\n{"exit_code":7}\n');}
   return new Response("{}");
  });
  const provider=exeWorkspace({runId,backendOrigin:"https://app.test",token:"secret",fetcher}),handle=provider.reserve();
  await provider.provision(handle,async()=>{});await provider.verify(handle);expect(await provider.execute(handle,"false")).toEqual({output:"outerr",exitCode:7});
  await provider.remove(handle);expect(commands.some(command=>command.startsWith("new"))).toBe(true);expect(commands.some(command=>command.includes("codex")||command.includes("pi "))).toBe(false);
 });
 it("refuses truncated command outcomes and foreign exe.dev VMs",async()=>{
  const provider=exeWorkspace({runId,backendOrigin:"https://app.test",token:"secret",fetcher:async(_url,init)=>String(init?.body)==="integrations list --json"?Response.json([]):String(init?.body).startsWith("ls")?Response.json([{name:`factorize-${runId}`,comment:"Someone else's VM"}]):new Response('{"stdout":"b3V0"}\n')});
  await expect(provider.execute(provider.reserve(),"work")).rejects.toThrow("without an exit status");await expect(provider.provision(provider.reserve(),async()=>{})).rejects.toThrow("ownership mismatch");
 });
 it("refuses shared Factorize proxy attachments and never treats an inventory error as confirmed deletion",async()=>{
  const commands:string[]=[];let inventoryError=false;
  const provider=exeWorkspace({runId,backendOrigin:"https://app.test",token:"secret",tags:["shared"],fetcher:async(_url,init)=>{const command=String(init?.body);commands.push(command);return Response.json(command==="integrations list --json"?[{type:"http-proxy",target:"https://app.test/mcp",attachments:["tag:shared"]}]:inventoryError?{error:"permission denied"}:[]);}});
  await expect(provider.provision(provider.reserve(),async()=>{})).rejects.toThrow("shared Factorize");expect(commands.some(command=>command.startsWith("new"))).toBe(false);
  inventoryError=true;await expect(provider.remove(provider.reserve())).rejects.toThrow("could not confirm");
 });
 it("waits for Fly started state, uses operation ownership and removes only its own Machine",async()=>{
  const requests:string[]=[];let machine:any=null;
  const fetcher:typeof fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname,method=init?.method??"GET";requests.push(method+" "+path);
   if(path.endsWith("/exec"))return Response.json({stdout:"ready",stderr:"",exit_code:0});
   if(path.endsWith("/machines")&&method==="GET")return Response.json(machine?[machine]:[]);
   if(path.endsWith("/machines")&&method==="POST"){const body=JSON.parse(String(init?.body));machine={id:"machine-1",state:"started",config:body.config};return Response.json(machine);}
   if(path.endsWith("/machines/machine-1")&&method==="GET")return machine?Response.json(machine):new Response("",{status:404});
   if(path.endsWith("/stop")){machine.state="stopped";return Response.json({});}
   if(method==="DELETE"){machine=null;return Response.json({});}
   return Response.json({name:`factorize-run-${tenantId.replaceAll("-","")}`,organization:{slug:"fixture"}});
  };
  const provider=flyWorkspace({runId,tenantId,organization:"fixture",token:"secret",image:"fixture:v1",region:"ord",size:"shared-cpu-1x",fetcher}),handle=provider.reserve();let saved=false;
  await provider.provision(handle,async()=>{saved=true;});expect(saved).toBe(true);await provider.verify(handle);expect(await provider.execute(handle,"pwd")).toEqual({output:"ready",exitCode:0});
  machine.config.metadata.factorize_run_id="foreign";await expect(provider.remove(handle)).rejects.toThrow("ownership mismatch");machine.config.metadata.factorize_run_id=runId;await provider.remove(handle);expect(requests.some(request=>request.startsWith("DELETE"))).toBe(true);
 });
});

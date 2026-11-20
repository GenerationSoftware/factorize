import {test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {Miniflare} from "miniflare";

test("bundled Pi streams and executes a validated tool in the Factorize Worker runtime",async()=>{
 const source=`import {Agent} from '@earendil-works/pi-agent-core';
 import {piProvider} from './packages/api/src/pi-provider.ts';
 export default {async fetch(){
  const provider=piProvider({providerUrl:'https://model.fixture/v1',apiKey:'fixture-key',contextWindow:32000,maxTokens:1000},'fixture');
  const requests=[],events=[];
  const modelFetch=async(input,init)=>{
   const body=JSON.parse(init?.body??await input.text());requests.push(body);
   const done=body.messages.some(message=>message.role==='tool');
   const delta=done?{content:'Worker Pi completed'}:{tool_calls:[{index:0,id:'workerd-tool',type:'function',function:{name:'count',arguments:'{"value":7}'}}]};
   const chunk=(delta,finish_reason=null)=>'data: '+JSON.stringify({id:'worker-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\\n\\n';
   return new Response(chunk({role:'assistant'})+chunk(delta)+chunk({},done?'stop':'tool_calls')+'data: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const agent=new Agent({initialState:{model:provider.model,tools:[{name:'count',label:'Count',description:'Count a value',parameters:{type:'object',properties:{value:{type:'number'}},required:['value']},execute:async(id,args)=>({content:[{type:'text',text:String(args.value+1)}],details:{}})}]},streamFn:(model,context,options)=>provider.models.streamSimple(model,context,{...options,fetch:modelFetch})});
  agent.subscribe(event=>{events.push(event.type);});await agent.prompt('Count seven');
  return Response.json({requests:requests.length,events,messages:agent.state.messages});
 }};`;
 const result=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,platform:"browser",format:"esm",external:["node:*"],write:false});
 const worker=new Miniflare({workers:[{config:{name:"hosted-pi",type:"worker",manifest:{mainModule:"hosted-pi.js",modules:{"hosted-pi.js":{type:"esm",contents:result.outputFiles[0].text}}},compatibilityDate:"2026-09-10",compatibilityFlags:["nodejs_compat"]}}]});
 try{
  const response=await worker.dispatchFetch("https://hosted-pi.test");const text=await response.text();assert.equal(response.status,200,text);const body=JSON.parse(text);
  assert.equal(body.requests,2);assert.ok(body.events.includes("message_update"));assert.ok(body.events.includes("tool_execution_end"));
  assert.equal(body.messages.find(message=>message.role==="toolResult").content[0].text,"8");assert.equal(body.messages.at(-1).content[0].text,"Worker Pi completed");
 }finally{await worker.dispose();}
});

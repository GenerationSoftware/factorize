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

test("direct OpenAI uses Pi's Responses provider with reasoning, tools, and the saved credential", async () => {
 const source = `import {Agent} from '@earendil-works/pi-agent-core';
 import {piProvider} from './packages/api/src/pi-provider.ts';
 export default {async fetch() {
  const {models, model} = piProvider({
   providerUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test-fixture', contextWindow: 32000, maxTokens: 1000,
  }, 'gpt-6-luna', 'high');
  const requests = [];
  const modelFetch = async (input, init) => {
   const request = new Request(input, init);
   const body = await request.json();
   requests.push({url: request.url, authorization: request.headers.get('authorization'), body});
   const done = body.input.some(item => item.type === 'function_call_output');
   const item = done
    ? {id: 'msg_fixture', type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Hello world', annotations: []}]}
    : {id: 'fc_fixture', type: 'function_call', call_id: 'call_fixture', name: 'count', arguments: '{}'};
   const events = [
    {type: 'response.output_item.added', output_index: 0, item},
    {type: 'response.output_item.done', output_index: 0, item},
    {type: 'response.completed', response: {id: 'fixture', status: 'completed', output: [item]}},
   ];
   const stream = events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join('');
   return new Response(stream, {headers: {'Content-Type': 'text/event-stream'}});
  };
  const tools = [{name: 'count', label: 'Count', description: 'Count a value', parameters: {type: 'object', properties: {}},
   execute: async () => ({content: [{type: 'text', text: '1'}], details: {}})}];
  const agent = new Agent({initialState: {model, thinkingLevel: 'high', tools},
   streamFn: (model, context, options) => models.streamSimple(model, context, {...options, fetch: modelFetch})});
  await agent.prompt('Say hello world');
  return Response.json({requests, result: agent.state.messages.at(-1)});
 }};`;
 const bundle = await build({stdin: {contents: source, resolveDir: process.cwd()}, bundle: true, platform: "browser", format: "esm", external: ["node:*"], write: false});
 const worker = new Miniflare({workers: [{config: {name: "hosted-pi", type: "worker", manifest: {mainModule: "hosted-pi.js", modules: {"hosted-pi.js": {type: "esm", contents: bundle.outputFiles[0].text}}}, compatibilityDate: "2026-09-10", compatibilityFlags: ["nodejs_compat"]}}]});
 try {
  const response = await worker.dispatchFetch("https://hosted-pi.test");
  const {requests, result} = await response.json();
  assert.equal(requests.length, 2, result?.errorMessage);
  const [request] = requests;
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.authorization, "Bearer sk-test-fixture");
  assert.equal(request.body.model, "gpt-6-luna");
  assert.equal(request.body.max_output_tokens, 1000);
  const reasoningUpdate = request.body.input.find(item => item.type === "configuration_update");
  assert.equal(reasoningUpdate?.reasoning.effort ?? request.body.reasoning?.effort, "high");
  const declaredTools = request.body.tools ?? request.body.input.find(item => item.type === "additional_tools")?.tools;
  assert.ok(declaredTools?.some(tool => tool.name === "count"));
  const toolOutput = requests[1].body.input.find(item => item.type === "function_call_output");
  assert.equal(toolOutput?.output, "1");
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(result.content.find(part => part.type === "text")?.text, "Hello world");
 } finally {
  await worker.dispose();
 }
});

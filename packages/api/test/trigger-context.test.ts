import {describe,it,expect,vi} from "vitest";
import {InvocationService,renderTriggerPrompt,renderRunName,eventRenderingContext,composeTriggerContext,type Trigger,type Event,type TriggerRepository} from "../src/job-domain";
const event=(kind:Event["kind"],template?:string):Event=>({id:kind,triggerId:"trigger",kind,slug:"event-1",enabled:true,config:{},template,createdAt:"now",updatedAt:"now"});
const trigger=(changes:Partial<Trigger>={}):Trigger=>({id:"trigger",name:"work",slug:"work",prompt:"",executionConfig:{connectionId:"vm",workspace:"",cwd:"",agentKind:"pi"},model:"model",enabled:true,concurrencyLimit:1,events:[event("manual")],createdAt:"now",updatedAt:"now",...changes});
const skill={id:"skill",key:"guide",revision:1,position:0,body:"Skill literal {{untouched}}"};
function invoker(value:Trigger){
 const insert=vi.fn(async()=>true),encrypt=vi.fn(async(text:string)=>"encrypted:"+text);
 const repository={getTrigger:async()=>value,findInvocation:async()=>null,insertInvocationAndRun:insert,countActiveRuns:async()=>0,markRunRunning:vi.fn()} as TriggerRepository;
 return {service:new InvocationService(repository,encrypt),insert,encrypt};
}
describe("single-skill context and optional Event templates",()=>{
 it("composes one literal skill, literal prompt, rendered Event and literal manual instructions in order",()=>{
  const value=trigger({skill,prompt:"Base literal {{untouched}}",events:[event("manual","Selected {{data.id}}") ]});
  expect(renderTriggerPrompt(value,{"event-1":{data:{id:7},prompt:"Caller literal {{untouched}}"}},"manual")).toBe("Skill literal {{untouched}}\n\nBase literal {{untouched}}\n\nSelected 7\n\nCaller literal {{untouched}}");
 });
 it("contributes no untemplated webhook data while run names retain structured access",()=>{
  const value=trigger({prompt:"Do work",events:[event("webhook")]});
  const context={"event-1":{prompt:"Untrusted payload text",title:"Issue",massive:"x".repeat(200000)}};
  expect(renderTriggerPrompt(value,context,"webhook","")).toBe("Do work");
  expect(renderRunName("{{webhook.title}} / {{event-1.title}}",eventRenderingContext(value,context,"webhook").values,"fallback")).toBe("Issue / Issue");
 });
 it("includes the full object only when the Event template selects it",()=>{
  const value=trigger({events:[event("webhook","{{webhook}}")]});
  expect(renderTriggerPrompt(value,{"event-1":{z:null,title:"Issue",nested:[1,"<&"]}},"webhook","")).toBe('{"nested":[1,"<&"],"title":"Issue","z":null}');
 });
 for(const mode of ["skill","prompt","event","manual"] as const) it(`accepts ${mode}-only agent input`,async()=>{
  const value=trigger({skill:mode==="skill"?skill:undefined,prompt:mode==="prompt"?"Base":"",events:[event("manual",mode==="event"?"Event {{data.id}}":undefined)]});
  const f=invoker(value);
  const result=await f.service.invoke(value.id,{source:"manual",eventId:"manual",claimKey:mode,context:{"event-1":{data:{id:7},prompt:mode==="manual"?"Caller":""}}});
  expect(f.insert).toHaveBeenCalledTimes(1);expect(result.run.encryptedPrompt).not.toBe("encrypted:");
 });
 it("rejects empty effective input and invalid Event templates before encrypting or inserting",async()=>{
  for(const template of [undefined,"{{#unclosed}}"]){
   const f=invoker(trigger({events:[event("manual",template)]}));
   await expect(f.service.invoke("trigger",{source:"manual",eventId:"manual",claimKey:"empty",context:{"event-1":{prompt:""}}})).rejects.toMatchObject({code:template?"invalid_template":"invalid_invocation"});
   expect(f.encrypt).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();
  }
 });
 it("does not interpret payload prompt fields as manual caller instructions for webhooks",async()=>{
  const f=invoker(trigger({prompt:"Base",events:[event("webhook")]}));
  const result=await f.service.invoke("trigger",{source:"webhook",eventId:"webhook",claimKey:"webhook",context:{"event-1":{prompt:"Do not append",webhook:{}}}});
  expect(result.run.encryptedPrompt).toBe("encrypted:Base");
 });
 it("uses the same context composition for previews",()=>{
  expect(composeTriggerContext("Base","Event {{webhook.id}}",{webhook:{id:4}},"Caller",skill)).toEqual({eventText:"Event 4",prompt:"Skill literal {{untouched}}\n\nBase\n\nEvent 4\n\nCaller"});
 });
});

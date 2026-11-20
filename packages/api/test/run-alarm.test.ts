import {describe,it,expect,vi,beforeEach} from "vitest";
const mocks=vi.hoisted(()=>({process:vi.fn(),hosted:vi.fn(),find:vi.fn(),next:vi.fn()}));
vi.mock("cloudflare:workers",()=>({DurableObject:class{constructor(public ctx:any,public env:any){}}}));
vi.mock("../src/postgres/database",()=>({databaseFor:()=>({})}));
vi.mock("../src/postgres/run-scheduler",()=>({RunScheduler:class{process=mocks.process;processHosted=mocks.hosted;}}));
vi.mock("../src/postgres/run-repository",()=>({RunRepository:class{find=mocks.find;nextWakeAt=mocks.next;}}));
import {AlarmCoordinator} from "../src/alarm-coordinator";
const identity={tenantId:"11111111-1111-4111-8111-111111111111",runId:"22222222-2222-4222-8222-222222222222"};
function fixture(){const values=new Map<string,any>();let alarm:number|null=null;const storage={get:vi.fn(async(key:string)=>values.get(key)),put:vi.fn(async(key:string,value:any)=>{values.set(key,value);}),getAlarm:vi.fn(async()=>alarm),setAlarm:vi.fn(async(value:number)=>{alarm=value;})};return {storage,object:new AlarmCoordinator({storage} as any,{} as any)};}
beforeEach(()=>{vi.clearAllMocks();mocks.find.mockResolvedValue({state:"running"});mocks.next.mockResolvedValue(null);mocks.hosted.mockResolvedValue(undefined);mocks.process.mockResolvedValue(undefined);});
describe("independent durable hosted-run alarms",()=>{
 it("persists a quick idempotent wakeup, rejects identity replacement and dispatches only its own run",async()=>{
  const {storage,object}=fixture();const wake=()=>object.fetch(new Request("https://scheduler/run",{method:"POST",body:JSON.stringify(identity)}));
  expect((await wake()).status).toBe(200);expect((await wake()).status).toBe(200);expect(mocks.hosted).not.toHaveBeenCalled();
  expect((await object.fetch(new Request("https://scheduler/run",{method:"POST",body:JSON.stringify({...identity,runId:identity.tenantId})}))).status).toBe(409);
  await object.alarm();expect(mocks.hosted).toHaveBeenCalledWith(identity.tenantId,identity.runId);expect(mocks.process).not.toHaveBeenCalled();expect(storage.setAlarm).toHaveBeenCalledTimes(2);
 });
 it("retries an interrupted run alarm and stops scheduling terminal runs",async()=>{
  const {storage,object}=fixture();await object.fetch(new Request("https://scheduler/run",{method:"POST",body:JSON.stringify(identity)}));mocks.hosted.mockRejectedValueOnce(new Error("Interrupted alarm"));
  await expect(object.alarm()).rejects.toThrow("Interrupted");expect(storage.setAlarm).toHaveBeenCalledTimes(2);mocks.find.mockResolvedValue({state:"succeeded"});await object.alarm();expect(storage.setAlarm).toHaveBeenCalledTimes(2);
 });
 it("keeps global admission and maintenance on the global alarm",async()=>{const {object,storage}=fixture();await object.alarm();expect(mocks.process).toHaveBeenCalledOnce();expect(mocks.hosted).not.toHaveBeenCalled();expect(storage.setAlarm).toHaveBeenCalledOnce();});
});

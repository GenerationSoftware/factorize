import {nextPhoenixWake} from "./phoenix";
import {processProxyOperation} from "./proxy-operations";
import { DurableObject } from "cloudflare:workers";
import { databaseFor } from "./postgres/database";
import { RunRepository } from "./postgres/run-repository";
import { RunScheduler } from "./postgres/run-scheduler";
import type { Env } from "./types";

/** Reliable global admission/maintenance and independent hosted-run wakeups. */
export class AlarmCoordinator extends DurableObject<Env> {
  private static readonly MAINTENANCE_INTERVAL_MS = 15 * 60_000;
  async fetch(request: Request): Promise<Response> {
    if(request.method==="POST" && new URL(request.url).pathname==="/operation"){
      let input:any;try{input=await request.json();}catch{return new Response("Invalid operation",{status:400});}
      const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
      if(!uuid.test(input?.tenantId)||!uuid.test(input?.operationId))return new Response("Invalid operation",{status:400});
      const current=await this.ctx.storage.get<{tenantId:string;operationId:string}>("operation");
      if(current&&(current.tenantId!==input.tenantId||current.operationId!==input.operationId))return new Response("Operation identity conflict",{status:409});
      await this.ctx.storage.put("operation",{tenantId:input.tenantId,operationId:input.operationId});
      if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+100);
      return Response.json({scheduled:true});
    }
    if(request.method==="POST" && new URL(request.url).pathname==="/run"){
      let input:any;try{input=await request.json();}catch{return new Response("Invalid run wakeup",{status:400});}
      const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
      if(!uuid.test(input?.tenantId) || !uuid.test(input?.runId))return new Response("Invalid run wakeup",{status:400});
      const current=await this.ctx.storage.get<{tenantId:string;runId:string}>("run");
      if(current&&(current.tenantId!==input.tenantId||current.runId!==input.runId))return new Response("Run identity conflict",{status:409});
      await this.ctx.storage.put("run",{tenantId:input.tenantId,runId:input.runId});
      const alarm=await this.ctx.storage.getAlarm();if(alarm===null || alarm>Date.now()+100)await this.ctx.storage.setAlarm(Date.now()+100);
      return Response.json({scheduled:true});
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake") return new Response("Not found", { status: 404 });
    await this.schedule(); return Response.json({ scheduled: true });
  }
  async alarm(): Promise<void> {
    const operation=await this.ctx.storage.get<{tenantId:string;operationId:string}>("operation");
    if(operation){await processProxyOperation(this.env,operation.tenantId,operation.operationId);return;}
    const run=await this.ctx.storage.get<{tenantId:string;runId:string}>("run");
    if(run){
      try{await new RunScheduler(databaseFor(this.env),this.env,undefined,this.ctx).processHosted(run.tenantId,run.runId);}
      finally{const current=await new RunRepository(databaseFor(this.env)).find(run.tenantId,run.runId);if(current&&["starting","running","stopping"].includes(current.state))await this.ctx.storage.setAlarm(Date.now()+3000);}
      return;
    }
    try { await new RunScheduler(databaseFor(this.env), this.env,undefined,this.ctx).process(); } finally { await this.schedule(); } }
  private async schedule() {
    const next = await new RunRepository(databaseFor(this.env)).nextWakeAt(), current = await this.ctx.storage.getAlarm();
    // Keep a maintenance heartbeat even with no queued runs or schedules.
    // Scheduler wakes still take precedence when they occur sooner.
    const now = Date.now();
    const maintenance = now + AlarmCoordinator.MAINTENANCE_INTERVAL_MS;
    const desired = Math.max(now + 100, Math.min(next?.getTime() ?? maintenance, this.env.SCHEDULER?(await nextPhoenixWake(this.env))?.getTime()??maintenance:maintenance, maintenance));
    if (current === null || current > desired) await this.ctx.storage.setAlarm(desired);
  }
}

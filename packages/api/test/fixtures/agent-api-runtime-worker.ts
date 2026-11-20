export { SkillPushWorkflow } from "../../src/cloudflare-entry";
import { RunScheduler } from "../../src/postgres/run-scheduler";
import { databaseFor } from "../../src/postgres/database";
import type {ExecutionBackend, TriggerResultReader} from "../../src/execution";
import { cleanupVmGrants } from "../../src/vm-grants";
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "../../src/worker";
import { cleanupAgentResponses } from "../../src/agent-api";
import type { Env } from "../../src/types";
export { AlarmCoordinator } from "../../src/worker";

// Miniflare's Node fetch bridge replaces Host with its private listener address.
// The HTTPS fixture verifies the external host; restore it before the production
// Hono boundary. This wrapper is bundled only by agent-api-runtime.test.mjs.
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const headers = new Headers(request.headers);
    headers.set("Host",new URL(env.APP_ORIGIN).host);
    return worker.fetch(new Request(request,{headers}),env,ctx);
  },
};
// A test-only entrypoint drives the exact production heartbeat cleanup against
// real PostgreSQL/R2, without adding a deployment endpoint or waiting 24 hours.
export class AgentApiMaintenance extends WorkerEntrypoint<Env> {
  async fetch(request:Request) {
    if (new URL(request.url).pathname === "/run-tick") {
      const launches:string[]=[];
      const backend:ExecutionBackend & TriggerResultReader={
        kind:"exe-vm", capabilities:["stop"],
        async launch(request) {
          launches.push(request.runId);
          if (request.prompt.startsWith("Simulate a launch failure")) throw new Error("Fixture VM unavailable");
          return {handle:{backendKind:"exe-vm",id:request.runId},destinationUrl:"https://fixture.invalid/",capabilities:["stop"],observation:{state:"running"}};
        },
        async inspect(){return {state:"succeeded"};}, async stop(){return {state:"stopped"};},
        async readTriggerResult(){return JSON.stringify({status:"succeeded",summary:"Review complete"});}
      };
      const database=databaseFor(this.env);
      const pending=await database.pool.query("SELECT id FROM app.runs WHERE execution_backend_kind='hosted-pi' AND state IN ('queued','reserved') AND execution_handle IS NULL");
      await new RunScheduler(database,this.env,()=>backend).process();
      for(const row of pending.rows){const current=await database.pool.query("SELECT 1 FROM app.runs WHERE id=$1 AND execution_handle IS NOT NULL",[row.id]);if(current.rowCount)launches.push(row.id);}
      return Response.json(launches);
    }
    await cleanupAgentResponses(this.env); await cleanupVmGrants(this.env); return new Response("done"); }
}

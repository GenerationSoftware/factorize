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
  async fetch() { await cleanupAgentResponses(this.env); return new Response("done"); }
}

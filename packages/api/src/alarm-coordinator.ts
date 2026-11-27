import { processProxyOperation } from "./proxy-operations";
import { DurableObject } from "cloudflare:workers";
import { AutomationScheduler } from "./triggers/application/automation-scheduler";
import { databaseFor } from "./postgres/database";
import { cleanupAgentResponses } from "./agent-api";
import { maintainProxyOperations } from "./proxy-operations";
import type { Env } from "./types";
import { dispatchMcpEvents, mcpEventDispatchBatchSize, nextMcpDeliveryDelay } from "./subscriptions/application/mcp-event-subscriptions";

/** Wakes provider and schedule Triggers and maintains bounded proxy records. */
export class AlarmCoordinator extends DurableObject<Env> {
  protected eventEnv(): Env { return this.env; }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/operation") {
      let input: any; try { input = await request.json(); } catch { return new Response("Invalid operation", { status: 400 }); }
      const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
      if (!uuid.test(input?.tenantId) || !uuid.test(input?.operationId)) return new Response("Invalid operation", { status: 400 });
      const current = await this.ctx.storage.get<{ tenantId: string; operationId: string }>("operation");
      if (current && (current.tenantId !== input.tenantId || current.operationId !== input.operationId)) return new Response("Operation identity conflict", { status: 409 });
      await this.ctx.storage.put("operation", { tenantId: input.tenantId, operationId: input.operationId });
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 100);
      return Response.json({ scheduled: true });
    }
    if (request.method === "POST" && path === "/mcp-events") {
      await this.schedule(100);
      return Response.json({ scheduled: true });
    }
    if (request.method !== "POST" || path !== "/wake") return new Response("Not found", { status: 404 });
    await this.schedule(); return Response.json({ scheduled: true });
  }
  async alarm(): Promise<void> {
    const operation = await this.ctx.storage.get<{ tenantId: string; operationId: string }>("operation");
    if (operation) { await processProxyOperation(this.env, operation.tenantId, operation.operationId); return; }
    let backlog = false;
    try {
      try {
        await new AutomationScheduler(databaseFor(this.env), this.eventEnv()).process();
        await maintainProxyOperations(this.env);
        await cleanupAgentResponses(this.env);
      } finally {
        backlog = await dispatchMcpEvents(this.eventEnv()) === mcpEventDispatchBatchSize;
      }
    } finally {
      const delay = backlog ? 100 : await nextMcpDeliveryDelay(this.eventEnv()).catch(() => 60_000);
      await this.schedule(Math.min(60_000, delay));
    }
  }
  private async schedule(delay = 60_000) {
    const current = await this.ctx.storage.getAlarm(), desired = Date.now() + delay;
    if (current === null || current > desired) await this.ctx.storage.setAlarm(desired);
  }
}

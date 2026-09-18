import { DurableObject } from "cloudflare:workers";
import { databaseFor } from "./postgres/database";
import { RunRepository } from "./postgres/run-repository";
import { RunScheduler } from "./postgres/run-scheduler";
import type { Env } from "./types";

/** The sole remaining Durable Object responsibility: reliable wakeups. */
export class AlarmCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake") return new Response("Not found", { status: 404 });
    await this.schedule(); return Response.json({ scheduled: true });
  }
  async alarm(): Promise<void> { try { await new RunScheduler(databaseFor(this.env), this.env).process(); } finally { await this.schedule(); } }
  private async schedule() {
    const next = await new RunRepository(databaseFor(this.env)).nextWakeAt(), current = await this.ctx.storage.getAlarm();
    if (!next) return;
    const desired = Math.max(Date.now() + 100, next.getTime());
    if (current === null || current > desired) await this.ctx.storage.setAlarm(desired);
  }
}

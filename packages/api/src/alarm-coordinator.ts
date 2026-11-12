import { DurableObject } from "cloudflare:workers";
import { databaseFor } from "./postgres/database";
import { RunRepository } from "./postgres/run-repository";
import { RunScheduler } from "./postgres/run-scheduler";
import type { Env } from "./types";

/** The sole remaining Durable Object responsibility: reliable wakeups. */
export class AlarmCoordinator extends DurableObject<Env> {
  private static readonly MAINTENANCE_INTERVAL_MS = 15 * 60_000;
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake") return new Response("Not found", { status: 404 });
    await this.schedule(); return Response.json({ scheduled: true });
  }
  async alarm(): Promise<void> { try { await new RunScheduler(databaseFor(this.env), this.env).process(); } finally { await this.schedule(); } }
  private async schedule() {
    const next = await new RunRepository(databaseFor(this.env)).nextWakeAt(), current = await this.ctx.storage.getAlarm();
    // Keep a maintenance heartbeat even with no queued runs or schedules.
    // Scheduler wakes still take precedence when they occur sooner.
    const now = Date.now();
    const maintenance = now + AlarmCoordinator.MAINTENANCE_INTERVAL_MS;
    const desired = Math.max(now + 100, Math.min(next?.getTime() ?? maintenance, maintenance));
    if (current === null || current > desired) await this.ctx.storage.setAlarm(desired);
  }
}

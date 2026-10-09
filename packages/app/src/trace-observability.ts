import type { TraceEvent } from "./trace";

/** Structured counters only: never log artifact bytes, grants, or parser payloads. */
export function traceMetric(name: string, tenantId: string, runId: string, values: Record<string, string | number | boolean | null> = {}): void {
  console.info(JSON.stringify({ component: "trace", metric: name, tenantId, runId, ...values }));
}
export function traceCounts(events: TraceEvent[]) {
  return { events: events.length, parseWarnings: events.filter(event => event.type === "warning").length,
    unknownEvents: events.filter(event => /^Unknown (Codex|Claude|entry:|message role:)/.test(event.title)).length };
}

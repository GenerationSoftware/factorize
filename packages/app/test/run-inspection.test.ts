import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { Tenant } from "../src/tenant";

function tenantWithRows(rows: (query: string, ...params: unknown[]) => Record<string, unknown>[]): Tenant {
  const tenant = Object.create(Tenant.prototype) as Tenant;
  (tenant as any).rows = rows;
  return tenant;
}

describe("run invocation inspection", () => {
  it("preserves trigger slugs across edits and reordering", () => {
    const tenant = Object.create(Tenant.prototype) as Tenant;
    const existing = new Map([
      ["manual", { id: "manual", slug: "trigger-1" }],
      ["schedule", { id: "schedule", slug: "trigger-2" }],
      ["webhook", { id: "webhook", slug: "trigger-3" }],
    ]);
    const triggers = (tenant as any).normalizedTriggers([
      { id: "webhook", kind: "webhook", config: { provider: "custom" } },
      { id: "manual", kind: "manual", config: {} },
      { kind: "schedule", config: { cron: "0 * * * *", timezone: "UTC" } },
    ], existing);
    expect(triggers.map((trigger: any) => trigger.slug)).toEqual(["trigger-3", "trigger-1", "trigger-4"]);
  });

  it("combines literal context search with run filters and returns only a bounded excerpt", async () => {
    let statement = "";
    let bindings: unknown[] = [];
    const tenant = tenantWithRows((query, ...params) => {
      statement = query;
      bindings = params;
      return [{
        id: "run-1", job_id: "job-1", state: "running", backend_kind: "amp", capabilities: "[]",
        created_at: "2026-09-16T12:00:00Z", updated_at: "2026-09-16T12:01:00Z",
        context_match_index: 100, context_length: 400, context_excerpt: "matching context window",
      }];
    });

    const response = (tenant as any).listRuns(new URL("https://tenant/v1/runs?jobId=job-1&state=running&contextQuery=%25_%5B.%2A%5D&limit=10")) as Response;
    const body = await response.json() as any;

    expect(statement).toContain("instr(lower(i.context), lower(?)) > 0");
    expect(statement).not.toContain("LIKE");
    expect(bindings).toEqual(["%_[.*]", "%_[.*]", "job-1", "running", "%_[.*]", 11]);
    expect(body.items[0]).toMatchObject({ state: "running", context_excerpt: "…matching context window…" });
    expect(body.items[0]).not.toHaveProperty("context");
    expect(body.items[0]).not.toHaveProperty("context_match_index");
  });

  it("returns full canonical invocation metadata and nulls for a legacy run", async () => {
    const canonical = tenantWithRows((query) => query.includes("FROM runs r") ? [{
      id: "run-1", job_id: "job-1", state: "queued", backend_kind: "amp", capabilities: "[]", result: null,
      context: '{"trigger-2":{"scheduled_at":"2026-09-16T12:00:00Z"}}', invocation_id: "inv-1", invocation_job_id: "job-1", invocation_source: "schedule", invocation_trigger_id: "schedule-1",
      invocation_claim_key: "schedule:occurrence-1",
      invocation_occurrence: '{"occurredAt":"2026-09-16T12:00:00Z"}', invocation_created_at: "2026-09-16T12:00:01Z",
    }] : []);
    const canonicalBody = await ((canonical as any).getRun("run-1") as Promise<Response>).then((response: Response) => response.json()) as any;
    expect(canonicalBody.context).toEqual({ "trigger-2": { scheduled_at: "2026-09-16T12:00:00Z" } });
    expect(canonicalBody.invocation).toEqual({
      id: "inv-1", job_id: "job-1", source: "schedule", trigger_id: "schedule-1", claim_key: "schedule:occurrence-1",
      context: { "trigger-2": { scheduled_at: "2026-09-16T12:00:00Z" } }, occurrence: { occurredAt: "2026-09-16T12:00:00Z" }, created_at: "2026-09-16T12:00:01Z",
    });

    const legacy = tenantWithRows((query) => query.includes("FROM runs r") ? [{ id: "legacy-1", job_id: "flow-1", state: "done", backend_kind: "exe-herdr", capabilities: "[]", result: null }] : []);
    const legacyBody = await ((legacy as any).getRun("legacy-1") as Promise<Response>).then((response: Response) => response.json()) as any;
    expect(legacyBody).toMatchObject({ context: null, invocation: null });
  });
});

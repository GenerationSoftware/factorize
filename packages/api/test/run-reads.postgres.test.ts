import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { TraceRepository } from "../src/postgres/trace-repository";
import { runStatusResponse, revisionTracePage } from "../src/run-read-contracts";
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("lightweight status and revision-bound traces", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(url!); });
  afterAll(async () => f?.cleanup());
  it("reads status in one data query, without prompt/context/activity/artifact assembly", async () => {
    const query = vi.spyOn(f.db.pool, "query");
    try {
      const status = await new ApiService(f.env, f.auth).getRunStatus(f.runId);
      expect(runStatusResponse.safeParse(status).success).toBe(true);
      expect(query).toHaveBeenCalledTimes(2); // authorization plus status
      expect(JSON.stringify(status)).not.toMatch(/Prompt|context|diagnostics|encrypted/);
      await expect(new ApiService(f.env, { ...f.auth, tenantId: f.otherTenant }).getRunStatus(f.runId)).rejects.toMatchObject({ status: 401 });
    } finally { query.mockRestore(); }
  });
  it("resets pages after canonical replacement even if sequence numbers repeat", async () => {
    const traces = new TraceRepository(f.db, f.tenantId);
    const events = Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, sequence: i + 1, type: "reasoning" as const, title: "Thinking", preview: "Text", display: {} }));
    await traces.replace(f.runId, events);
    const first = (await traces.revisionPage(f.runId, 0, 2))!;
    expect(revisionTracePage.safeParse(first).success).toBe(true);
    expect(first.nextCursor).toBe(2); expect(first.reset).toBe(false);
    const next = (await traces.revisionPage(f.runId, 2, 2, first.revision))!;
    expect(next.items.map(e => e.sequence)).toEqual([3, 4]); expect(next.reset).toBe(false);
    await f.db.transaction(async client => {
      await client.query("DELETE FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
      await client.query("INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text,display_data) VALUES ($1,$2,1,'new','assistant_message','Assistant','New result','{}')", [f.tenantId, f.runId]);
      await client.query("INSERT INTO app.run_trace_projections(tenant_id,run_id,source_kind,artifact_sha256,parser_version,reconciliation) VALUES ($1,$2,'native_session',$3,'test','{}')", [f.tenantId, f.runId, "a".repeat(64)]);
    });
    const reset = (await traces.revisionPage(f.runId, 4, 2, first.revision))!;
    expect(reset.reset).toBe(true); expect(reset.items.map(e => e.id)).toEqual(["new"]); expect(reset.nextCursor).toBeNull();
    expect(reset.revision).not.toBe(first.revision);
    expect(await new TraceRepository(f.db, f.otherTenant).revisionPage(f.runId, 0, 2)).toBeNull();
    expect((await new ApiService(f.env, f.auth).getRunStatus(f.runId)).trace_revision).toBe(reset.revision);
  });
  it("returns real recent and before pages without dropping or repeating boundaries", async () => {
    const traces = new TraceRepository(f.db, f.tenantId);
    await traces.replace(f.runId, Array.from({ length: 162 }, (_, i) => ({ id: `page-${i + 1}`, sequence: i + 1, type: "assistant_message" as const, title: `Event ${i + 1}`, preview: "Text", display: {} })));

    const recent = (await traces.revisionPage(f.runId, 0, 100, undefined, undefined, true))!;
    expect(recent.items.map(event => event.sequence)).toEqual(Array.from({ length: 100 }, (_, i) => i + 63));
    expect(recent.previousCursor).toBe(63);

    const older = (await traces.revisionPage(f.runId, 0, 100, recent.revision, recent.previousCursor!))!;
    expect(older.items.map(event => event.sequence)).toEqual(Array.from({ length: 62 }, (_, i) => i + 1));
    expect(older.previousCursor).toBeNull();
    expect(new Set([...recent.items, ...older.items].map(event => event.sequence)).size).toBe(162);
  });
  it("distinguishes terminal execution from finalization and accepts legacy done filters", async () => {
    await f.db.pool.query("UPDATE app.job_runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='succeeded',artifact_state='collecting',vm_cleanup_complete=false WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const service = new ApiService(f.env, f.auth);
    expect(await service.getRunStatus(f.runId)).toMatchObject({ state: "succeeded", finalizing: true });
    expect((await service.listRuns(new URLSearchParams({ state: "done" }))).items.map(r => r.id)).toContain(f.runId);
    await f.db.pool.query("UPDATE app.runs SET artifact_state='stored',vm_cleanup_complete=true WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect(await service.getRunStatus(f.runId)).toMatchObject({ state: "succeeded", finalizing: false });
  });
  it("paginates before duration enrichment and preserves terminal and active duration values", async () => {
    const completedId = (await f.db.pool.query<any>("SELECT id FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state='succeeded' AND id<>$3", [f.tenantId, (await f.db.pool.query<any>("SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0].job_id, f.runId])).rows[0].id;
    const runningId = (await f.db.pool.query<any>("SELECT id FROM app.job_runs WHERE tenant_id=$1 AND job_id=(SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2) AND state='running'", [f.tenantId, f.runId])).rows[0].id;
    await f.db.pool.query("UPDATE app.job_runs SET state='stopped',started_at='2029-01-01T00:00:00Z',updated_at='2029-01-01T00:00:40Z' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='stopped',created_at='2030-01-03T00:00:00Z' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.job_runs SET started_at='2029-01-01T00:00:00Z',updated_at='2029-01-01T00:00:10Z' WHERE tenant_id=$1 AND id=$2", [f.tenantId, completedId]);
    await f.db.pool.query("UPDATE app.runs SET state='succeeded',created_at='2030-01-02T00:00:00Z' WHERE tenant_id=$1 AND id=$2", [f.tenantId, completedId]);
    await f.db.pool.query("UPDATE app.runs SET created_at='2030-01-01T00:00:00Z' WHERE tenant_id=$1 AND id=$2", [f.tenantId, runningId]);

    const query = vi.spyOn(f.db.pool, "query");
    const service = new ApiService(f.env, f.auth);
    try {
      const first = await service.listRuns(new URLSearchParams({ limit: "2", jobId: (await f.db.pool.query<any>("SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0].job_id }));
      expect(first.items.map(run => run.id)).toEqual([runningId, f.runId]);
      expect(first.items.map(run => run.elapsed_time)).toEqual([{ low: 10, high: 40 }, { duration: 40 }]);
      expect(first.nextCursor).not.toBeNull();
      const statement = query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("duration_jobs AS MATERIALIZED"))?.[0] as string;
      expect(statement).toContain("selected AS MATERIALIZED");
      expect(statement).toContain("SELECT DISTINCT job_id FROM page");
      expect(statement).not.toContain("LEFT JOIN LATERAL");

      const second = await service.listRuns(new URLSearchParams({ limit: "2", jobId: (await f.db.pool.query<any>("SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0].job_id, cursor: first.nextCursor! }));
      expect(second.items.map(run => run.id)).toEqual([completedId]);
      expect(second.items[0].elapsed_time).toEqual({ duration: 10 });
      expect(second.nextCursor).toBeNull();

      await f.db.pool.query("UPDATE app.job_runs SET started_at=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [f.tenantId, [f.runId, completedId]]);
      const noDurations = await service.listRuns(new URLSearchParams({ limit: "10", jobId: (await f.db.pool.query<any>("SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0].job_id }));
      expect(noDurations.items.find(run => run.id === runningId)?.elapsed_time).toBeNull();
    } finally { query.mockRestore(); }
  });
});

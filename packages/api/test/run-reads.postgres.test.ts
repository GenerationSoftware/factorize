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
  it("distinguishes terminal execution from finalization and accepts legacy done filters", async () => {
    await f.db.pool.query("UPDATE app.job_runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='succeeded',artifact_state='collecting',vm_cleanup_complete=false WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const service = new ApiService(f.env, f.auth);
    expect(await service.getRunStatus(f.runId)).toMatchObject({ state: "succeeded", finalizing: true });
    expect((await service.listRuns(new URLSearchParams({ state: "done" }))).items.map(r => r.id)).toContain(f.runId);
    await f.db.pool.query("UPDATE app.runs SET artifact_state='stored',vm_cleanup_complete=true WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect(await service.getRunStatus(f.runId)).toMatchObject({ state: "succeeded", finalizing: false });
  });
});

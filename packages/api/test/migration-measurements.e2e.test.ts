import { describe, it, expect, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { encrypt } from "../src/crypto";
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("migration API measurements", () => {
  it("records the same small/large fixtures with full legacy and additive bounded reads", async () => {
    const report: unknown[] = [];
    for (const size of [10, 205]) {
      const f = await loadingFixture(url!);
      try {
        if (size > 10) {
          const cipher = await encrypt("p".repeat(50000), f.env.CREDENTIAL_ENCRYPTION_KEY);
          await f.db.pool.query("UPDATE app.jobs SET encrypted_prompt_template=$2 WHERE tenant_id=$1", [f.tenantId, cipher]);
          await f.db.pool.query(`INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit)
            SELECT $1,gen_random_uuid(),'Large Job '||i,'large-job-'||i,$2,'{"connectionId":"local","agentKind":"codex"}',1 FROM generate_series(1,195) i`, [f.tenantId, cipher]);
          await f.db.pool.query("UPDATE app.job_runs SET encrypted_prompt=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, cipher]);
          await f.db.pool.query(`UPDATE app.invocations SET context=jsonb_build_object('data',repeat('c',50000)) WHERE tenant_id=$1`, [f.tenantId]);
          await f.db.pool.query(`INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text,display_data)
            SELECT $1,$2,i,'event-'||i,'reasoning','Thinking',repeat('t',500),'{}' FROM generate_series(1,20000) i`, [f.tenantId, f.runId]);
        }
        const service = new ApiService(f.env, f.auth);
        const cases: [string, () => Promise<unknown>, number][] = [
          ["legacy_jobs", () => service.listJobs(), 1],
          ["summary_jobs", () => service.listJobSummaries({ limit: 30, q: "" }), 1],
          ["job_detail", () => service.getJob(f.jobIds[0]), 1],
          ["legacy_editor_job_and_all_jobs", async () => Promise.all([service.getJob(f.jobIds[0]), service.listJobs()]), 2],
          ["bounded_editor_job_and_selector", async () => Promise.all([service.getJob(f.jobIds[0]), service.listJobSummaries({ limit: 30, q: "" }, true)]), 2],
          ["static_editor_configuration", async () => Promise.all([service.getJob(f.jobIds[0]), service.listExecutionTargets(), service.listJobTriggerAvailability(), service.triggerContextMetadata()]), 4],
          ["static_lifecycle_selector", async () => service.listJobSummaries({ limit: 30, q: "" }, true), 1],
          ["legacy_run_poll", () => service.getRun(f.runId), 1],
          ["lightweight_status_poll", () => service.getRunStatus(f.runId), 1],
          ["revision_trace_page", () => service.getRevisionTrace(f.runId, 0, 100), 1],
        ];
        for (const [name, operation, requests] of cases) {
          const timings: number[] = [], queries: number[] = [], bytes: number[] = [];
          await operation(); // warmup
          const spy = vi.spyOn(f.db.pool, "query");
          try { for (let i = 0; i < 5; i++) {
            spy.mockClear(); const started = performance.now(); const result = await operation();
            timings.push(performance.now() - started); queries.push(spy.mock.calls.length); bytes.push(new TextEncoder().encode(JSON.stringify(result)).length);
          } } finally { spy.mockRestore(); }
          const median = (values: number[]) => Number([...values].sort((a,b)=>a-b)[2].toFixed(2));
          report.push({ jobs: size, trace_events: size > 10 ? 20000 : 0, operation: name, requests, queries: median(queries), bytes: median(bytes), median_ms: median(timings), range_ms: [Math.min(...timings), Math.max(...timings)].map(n=>Number(n.toFixed(2))) });
          if (name === "summary_jobs" || name === "bounded_editor_job_and_selector") expect(median(bytes)).toBeLessThan(70000);
          if (name === "summary_jobs" || name === "lightweight_status_poll" || name === "revision_trace_page") expect(median(queries)).toBe(2);
        }
      } finally { await f.cleanup(); }
    }
    await writeFile(new URL("../performance/gen-2157-feature-reads.json", import.meta.url), JSON.stringify({ date: "2026-10-09", node: process.version, samples: 5, warmup: 1, database: "local PostgreSQL 16, no injected latency", scope: "Service-level calls incl authorization; requests are equivalent API requests, not browser navigation measurements. Large fixture: 205 jobs/50k prompts/50k run context/20k trace events.", report }, null, 2) + "\n");
  }, 60000);
});

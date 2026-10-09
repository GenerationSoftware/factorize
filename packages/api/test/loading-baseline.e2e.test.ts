import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class { constructor(private options: any) {} fetch(request: Request, env: any, ctx: any) { return this.options.defaultHandler.fetch(request, env, ctx); } }, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
// Explicit opt-in: creates and removes an isolated database, never uses production credentials.
describe.skipIf(!databaseUrl)("cookie loading baseline", () => {
  let browser: Browser;
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  const delayMs = Number(process.env.LOADING_QUERY_DELAY_MS ?? 20);
  beforeAll(async () => {
    fixture = await loadingFixture(databaseUrl!);
    browser = await chromium.launch({ headless: true });
    const query = fixture.db.pool.query.bind(fixture.db.pool);
    vi.spyOn(fixture.db.pool, "query").mockImplementation((async (...args: any[]) => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return (query as any)(...args);
    }) as any);
  });
  afterAll(async () => { await browser?.close(); vi.restoreAllMocks(); await fixture?.cleanup(); });
  it("records endpoint latency and navigation-to-useful-content for requested authenticated screens", async () => {
    const cases = [
      { name: "Jobs", page: "/jobs", endpoint: "/api/v1/jobs", selector: "main a[href^='/jobs/']" },
      { name: "Job detail", page: `/jobs/${fixture.jobIds[0]}`, endpoint: `/api/v1/jobs/${fixture.jobIds[0]}`, selector: "main h1" },
      { name: "Run detail", page: `/job-runs/${fixture.runId}`, endpoint: `/api/v1/runs/${fixture.runId}`, selector: "main h1" },
      { name: "Job create", page: "/jobs/new", endpoint: "/api/v1/execution-targets", selector: "main select option[value='local']" },
      { name: "Job edit", page: `/jobs/${fixture.jobIds[0]}/edit`, endpoint: `/api/v1/jobs/${fixture.jobIds[0]}`, selector: "main select option[value='local']" },
      { name: "Integrations", page: "/settings/integrations", endpoint: "/api/v1/integrations", selector: "main h1" },
      { name: "API Keys", page: "/settings/api-keys", endpoint: "/api/v1/access-tokens", selector: "main h1" },
    ];
    const report: any[] = [];
    const summarize = (samples: number[]) => ({ median_ms: Number([...samples].sort((a,b)=>a-b)[Math.floor(samples.length/2)].toFixed(1)), range_ms: [Math.min(...samples), Math.max(...samples)].map(v=>Number(v.toFixed(1))) });
    for (const scenario of cases) {
      const api: number[] = [], content: number[] = [];
      for (let i = 0; i < 5; i++) {
        let started = performance.now();
        const response = await fixture.request(scenario.endpoint); expect(response.status).toBe(200); await response.text(); api.push(performance.now()-started);
        const context = await browser.newContext();
        try {
          await context.addCookies([{ name: "factorize_session", value: fixture.cookie.slice("factorize_session=".length), domain: "factorize.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
          await context.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
            const response = await fixture.request(url.pathname + url.search, await route.request().headerValue("cookie") ?? "");
            const headers: Record<string, string> = {};
            response.headers.forEach((value, name) => { headers[name] = value; });
            await route.fulfill({ status: response.status, headers, body: await response.text() });
          });
          const page = await context.newPage();
          started = performance.now();
          await page.goto("https://factorize.test" + scenario.page);
          await page.locator(scenario.selector).first().waitFor({ state: "attached", timeout: 5000 });
          content.push(performance.now()-started);
          expect(await page.getByRole("alert").count()).toBe(0);
        } finally { await context.close(); }
      }
      report.push({ screen: scenario.name, endpoint: summarize(api), useful_content: summarize(content) });
    }
    const indexes = (await fixture.db.pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='app' AND tablename='job_runs' ORDER BY indexname")).rows;
    const batchedSql = (vi.mocked(fixture.db.pool.query).mock.calls as any[]).map(args => args[0]).find(sql => typeof sql === "string" && sql.includes("WITH selected_runs"));
    const oldSql = "SELECT count(*) FILTER (WHERE state IN ('starting','running','blocked','stopping'))::text running_count,(array_agg(state ORDER BY created_at DESC))[1] last_run_state FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2";
    const plans: Record<string, unknown> = {};
    for (const [name, sql, values] of [["old_single_job", oldSql, [fixture.tenantId, fixture.jobIds[0]]], ...(batchedSql ? [["new_batch", batchedSql, [fixture.tenantId, fixture.jobIds]]] : [])] as [string, string, unknown[]][]) {
      plans[name] = (await fixture.db.pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, values)).rows[0]["QUERY PLAN"];
    }
    const result = { samples: 5, query_delay_ms: delayMs, environment: "Disposable local PostgreSQL; signed cookie Worker dispatch; headless Chromium with compiled static assets; intercepted HTTP, no Cloudflare/Hyperdrive/network transit", results: report, indexes, plans };
    console.log(JSON.stringify(result));
    if (process.env.LOADING_REPORT_PATH) await writeFile(process.env.LOADING_REPORT_PATH, JSON.stringify(result,null,2)+"\n");
  }, 120000);
});

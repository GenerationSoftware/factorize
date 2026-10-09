import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { loadingFixture } from "./helpers/loading-fixture";
import worker from "../src/worker";
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("compiled React + actual Worker API + PostgreSQL", () => {
  it("authenticates, navigates jobs, invokes once, refreshes the run and resets a projected trace", async () => {
    const f = await loadingFixture(url!), browser = await chromium.launch({ headless: true });
    const failures: string[] = [], calls: string[] = [];
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: "factorize_session", value: f.cookie.slice("factorize_session=".length), domain: "factorize.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      await context.route("**/*", async route => {
        const request = route.request(), target = new URL(request.url());
        if (target.pathname.startsWith("/api/v1/")) {
          calls.push(`${request.method()} ${target.pathname}`);
          const headers = await request.allHeaders();
          const response = await worker.fetch(new Request(target.toString(), { method: request.method(), headers, ...(request.postData() ? { body: request.postData()! } : {}) }), f.env, { waitUntil() {} } as any);
          const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, name) => { responseHeaders[name] = value; });
          return route.fulfill({ status: response.status, headers: responseHeaders, body: await response.text() });
        }
        if (target.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
        const asset = target.pathname.startsWith("/assets/") ? target.pathname : "/index.html";
        return route.fulfill({ contentType: asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : "text/html", body: await readFile(new URL("../../app/dist" + asset, import.meta.url)) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", error => failures.push(error.message));
      await page.goto("https://factorize.test/jobs");
      await page.getByRole("link", { name: "Job-1", exact: true }).click();
      await page.getByLabel("Prompt", { exact: true }).fill("Real invocation");
      await page.getByLabel("JSON data (optional)").fill('{"number":7}');
      await page.getByRole("button", { name: "Invoke", exact: true }).click();
      await page.getByRole("heading", { name: "Trace", exact: true }).waitFor();
      const runId = new URL(page.url()).pathname.split("/").at(-1)!;
      expect(calls.filter(call => call === `POST /api/v1/jobs/${f.jobIds[1]}/invocations`)).toHaveLength(1);
      const row = (await f.db.pool.query("SELECT i.context,jr.state FROM app.invocations i JOIN app.job_runs jr ON jr.tenant_id=i.tenant_id AND jr.invocation_id=i.id WHERE jr.tenant_id=$1 AND jr.id=$2", [f.tenantId, runId])).rows[0];
      expect(row).toMatchObject({ state: "queued", context: { manual: { prompt: "Real invocation", data: { number: 7 } } } });
      await page.reload(); await page.getByText("No trace events yet.", { exact: true }).waitFor();
      await f.db.transaction(async client => {
        await client.query("INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text,display_data) VALUES ($1,$2,1,'canonical','assistant_message','Final output','Safe output','{}')", [f.tenantId, runId]);
        await client.query("INSERT INTO app.run_trace_projections(tenant_id,run_id,source_kind,artifact_sha256,parser_version,reconciliation) VALUES ($1,$2,'native_session',$3,'test','{}')", [f.tenantId, runId, "b".repeat(64)]);
        await client.query("UPDATE app.job_runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, runId]);
        await client.query("UPDATE app.runs SET state='succeeded',artifact_state='stored',vm_cleanup_complete=true WHERE tenant_id=$1 AND id=$2", [f.tenantId, runId]);
      });
      await page.getByText("Final output · assistant_message", { exact: true }).waitFor();
      expect(calls.some(call => call === `GET /api/v1/runs/${runId}/status`)).toBe(true);
      expect(calls.some(call => call === `GET /api/v1/runs/${runId}`)).toBe(false);
      expect(failures).toEqual([]);
      await context.close();
    } finally { await browser.close(); await f.cleanup(); }
  }, 30000);
});

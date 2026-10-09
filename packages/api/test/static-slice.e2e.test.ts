import { jobResponse } from "../src/job-contracts";
import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { loadingFixture } from "./helpers/loading-fixture";
import worker from "../src/worker";
import { ApiService } from "../src/flow-service";
import { decrypt } from "../src/crypto";
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
        const response = await worker.fetch(new Request(target.toString()), f.env, { waitUntil() {} } as any);
        const headers: Record<string, string> = {}; response.headers.forEach((value, name) => { headers[name] = value; });
        return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", error => failures.push(error.message));
      await page.goto("https://factorize.test/jobs");
      await page.locator("header img").waitFor();
      expect(await page.locator("header img").evaluate("image => image.complete && image.naturalWidth > 0")).toBe(true);
      expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
      expect(await page.locator("body").evaluate("element => getComputedStyle(element).backgroundColor")).toBe("rgb(252, 251, 246)");
      await page.getByRole("link", { name: "Job-1", exact: true }).click();
      await page.getByRole("button", { name: "Run job", exact: true }).click();
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
      await page.getByLabel("Continuous virtualized trace").check();
      const continuous = page.getByRole("region", { name: "Continuous trace" });
      await continuous.getByText("Final output · assistant_message", { exact: true }).waitFor();
      expect(await continuous.locator("li").count()).toBe(1);
      expect(failures).toEqual([]);
      await context.close();
    } finally { await browser.close(); await f.cleanup(); }
  }, 30000);
  it("edits a real job with a racing write, reconciles safely and creates/revokes a real API key", async () => {
    const f = await loadingFixture(url!), browser = await chromium.launch({ headless: true });
    try {
      const service = new ApiService(f.env, f.auth);
      const job = await service.createJob({ name: "Editor fixture", slug: "editor-fixture", promptTemplate: "Original", executionTargetId: "local", concurrencyLimit: 1, triggers: [{ kind: "manual", enabled: true, config: {} }] });
      expect(jobResponse.safeParse(job).success).toBe(true);
      const context = await browser.newContext();
      await context.addCookies([{ name: "factorize_session", value: f.cookie.slice("factorize_session=".length), domain: "factorize.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      await context.route("**/*", async route => {
        const request = route.request(), target = new URL(request.url());
        if (target.pathname.startsWith("/api/v1/")) {
          const response = await worker.fetch(new Request(target.toString(), { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData()! } : {}) }), f.env, { waitUntil() {} } as any);
          return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
        }
        if (target.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
        const response = await worker.fetch(new Request(target.toString()), f.env, { waitUntil() {} } as any);
        const headers: Record<string, string> = {}; response.headers.forEach((value, name) => { headers[name] = value; });
        return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      await page.goto(`https://factorize.test/jobs/${job.id}/edit`);
      await page.getByLabel("Prompt template", { exact: true }).fill("My edited prompt");
      await service.updateJob(job.id, { name: "Concurrent name", slug: job.slug, promptTemplate: job.promptTemplate, executionTargetId: job.executionTargetId, concurrencyLimit: 1, triggers: [{ id: job.triggers[0].id, slug: job.triggers[0].slug, kind: "manual", enabled: true, config: {} }], expectedUpdatedAt: job.updatedAt });
      await page.getByRole("button", { name: "Save job", exact: true }).click();
      await page.getByRole("button", { name: "Reconcile my changes" }).click();
      expect(await page.getByLabel("Name", { exact: true }).inputValue()).toBe("Concurrent name");
      await page.getByRole("button", { name: "Save job", exact: true }).click(); await page.waitForURL(`**/jobs/${job.id}`);
      const saved = await service.getJob(job.id); expect(saved.name).toBe("Concurrent name"); expect(saved.promptTemplate).toBe("My edited prompt"); expect(saved.triggers[0].id).toBe(job.triggers[0].id);
      const row = (await f.db.pool.query("SELECT encrypted_prompt_template FROM app.jobs WHERE tenant_id=$1 AND id=$2", [f.tenantId, job.id])).rows[0]; expect(await decrypt(row.encrypted_prompt_template, f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe("My edited prompt");
      await page.goto("https://factorize.test/settings/api-keys"); await page.getByLabel("Key name").fill("Real key"); await page.getByRole("button", { name: "Create key" }).click(); await page.getByText("Copy this key now. It will only be displayed once.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Dismiss key" }).click(); await page.reload(); await page.getByText("Real key", { exact: true }).waitFor();
      page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Revoke key" }).click(); await page.getByText("Revoked", { exact: true }).waitFor();
      expect((await f.db.pool.query("SELECT revoked_at FROM app.access_tokens WHERE tenant_id=$1", [f.tenantId])).rows[0].revoked_at).not.toBeNull();
      await context.close();
    } finally { await browser.close(); await f.cleanup(); }
  }, 30000);

});

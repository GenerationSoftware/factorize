// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { jobRunPage } from "../src/ui";
import { InvocationService, type Job } from "../src/job-domain";

declare const document: any;

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("displays the persisted manual name as the run title and breadcrumb", async () => {
  const name = "GEN-2106 — Fix <issue>";
  const job = { id: "job-1", name: "dev", enabled: true, promptTemplate: "", runNameTemplate: "Template" } as Job;
  let persisted: any;
  const service = new InvocationService({
    getJob: async () => job,
    findInvocation: async () => null,
    insertInvocationAndRun: async (invocation, run) => { persisted = structuredClone(run); return true; },
    countActiveRuns: async () => 0,
    markRunRunning: async () => { throw new Error("Unexpected start"); },
  }, async value => value);
  await service.invoke(job.id, { source: "manual", name, triggerId: "manual-1", claimKey: "manual:issue", context: {} });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/trace")) return Response.json({ items: [], nextCursor: null });
    if (url.includes("/api/v1/jobs/")) return Response.json(job);
    return Response.json({ id: persisted.id, job_id: job.id, run_name: persisted.runName, state: "succeeded", created_at: persisted.createdAt });
  }));
  const html = jobRunPage({ email: "owner@example.com" }, persisted.id);
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
  new Function(script)();
  await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe(name));
  expect(document.title).toBe(name + " — Factorize");
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(name);
  expect(document.querySelector("h1 issue")).toBeNull();
});

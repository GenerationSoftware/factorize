import { describe, expect, it } from "vitest";
import { InvocationService, renderJobPrompt, renderRunName, type Invocation, type Job, type JobRepository, type JobRun } from "../src/job-domain";

const job = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1", name: "Triage", slug: "triage", promptTemplate: "{{trigger-1.prompt}} · {{trigger-2.issue.title}}",
  model: "",
  executionTarget: { connectionId: "exe-1", workspace: "triage", cwd: "/repo", agentKind: "codex" },
  concurrencyLimit: 1, enabled: true,
  triggers: [],
  createdAt: "now", updatedAt: "now", ...overrides,
});

class MemoryRepository implements JobRepository {
  jobs = new Map([["job-1", job()]]); claims = new Map<string, { invocation: Invocation; run: JobRun }>(); active = 0;
  async getJob(id: string) { return this.jobs.get(id) ?? null; }
  async findInvocation(jobId: string, claimKey: string) { return this.claims.get(`${jobId}:${claimKey}`) ?? null; }
  async insertInvocationAndRun(invocation: Invocation, run: JobRun) { const key = `${invocation.jobId}:${invocation.claimKey}`; if (this.claims.has(key)) return false; this.claims.set(key, { invocation, run }); return true; }
  async countActiveRuns() { return this.active; }
  async markRunRunning(runId: string, startedAt: string) { const value = [...this.claims.values()].find(entry => entry.run.id === runId)!; value.run = { ...value.run, state: "running", startedAt, updatedAt: startedAt }; this.active++; return value.run; }
}

describe("job invocation domain", () => {
  it("renders run names with active and inactive trigger conditionals", () => {
    expect(renderRunName("{{#trigger-2}}{{trigger-2.issue.identifier}}{{/trigger-2}}{{^trigger-2}}manual{{/trigger-2}}", { "trigger-1": { prompt: "go" }, "trigger-2": false }, "fallback")).toBe("manual");
    expect(renderRunName("{{#trigger-2}}{{trigger-2.issue.identifier}}{{/trigger-2}}", { "trigger-1": false, "trigger-2": { issue: { identifier: "GEN-1" } } }, "fallback")).toBe("GEN-1");
  });
  it("renders structured trigger paths and empty missing values", () => {
    expect(renderJobPrompt(job(), { "trigger-1": { prompt: "Fix it" }, "trigger-2": { issue: { title: "Bug" } } })).toBe("Fix it · Bug");
    expect(renderJobPrompt(job(), { "trigger-1": { prompt: "Fix it" } })).toBe("Fix it · ");
    expect(renderJobPrompt({ promptTemplate: "{{trigger-1.data.name}} ({{trigger-1.data.priority}})" }, { "trigger-1": { prompt: "", data: { name: "Ticket run", priority: 1 } } })).toBe("Ticket run (1)");
  });

  it("queues one encrypted run for a claim regardless of source retries", async () => {
    const repository = new MemoryRepository(); let ids = 0;
    const service = new InvocationService(repository, async value => `encrypted:${value}`, () => `id-${++ids}`, () => "2026-09-16T00:00:00.000Z");
    const request = { source: "webhook" as const, triggerId: "webhook-1", claimKey: "delivery-7", context: { "trigger-2": { issue: { title: "Issue payload" } } }, occurrence: { externalId: "evt-7", metadata: { provider: "linear" } } };
    const first = await service.invoke("job-1", request), retry = await service.invoke("job-1", request);
    expect(first.duplicate).toBe(false); expect(retry.duplicate).toBe(true);
    expect(retry.run.id).toBe(first.run.id); expect(first.run.encryptedPrompt).toBe("encrypted: · Issue payload");
    expect(JSON.stringify(first)).not.toContain('"prompt":"Hi');
  });

  it("renders and persists the configured run name at invocation time", async () => {
    const repository = new MemoryRepository(); repository.jobs.set("job-1", job({ runNameTemplate: "Review {{trigger-2.issue.identifier}}" }));
    const service = new InvocationService(repository, async value => value, () => crypto.randomUUID(), () => "2026-09-16T00:00:00.000Z");
    const result = await service.invoke("job-1", { source: "webhook", triggerId: "webhook-1", claimKey: "delivery-name", context: { "trigger-2": { issue: { identifier: "GEN-2113" } } } });
    expect(result.run.runName).toBe("Review GEN-2113");
  });

  it("starts queued runs only while the job has capacity", async () => {
    const repository = new MemoryRepository(); const service = new InvocationService(repository, async value => value, undefined, () => "then");
    const first = await service.invoke("job-1", { source: "manual", triggerId: "manual-1", claimKey: "one", context: { "trigger-1": { prompt: "go" } } });
    const second = await service.invoke("job-1", { source: "schedule", triggerId: "schedule-1", claimKey: "two", context: { "trigger-3": { scheduled_at: "2026-09-16T01:00:00Z" } }, occurrence: { occurredAt: "2026-09-16T01:00:00Z" } });
    expect((await service.startIfCapacity(first.run))?.state).toBe("running");
    expect(await service.startIfCapacity(second.run)).toBeNull();
  });

});

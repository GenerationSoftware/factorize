import { describe, expect, it } from "vitest";
import { InvocationService, JOB_SCHEMA, renderJobPrompt, type Invocation, type Job, type JobRepository, type JobRun } from "../src/job-domain";

const job = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1", name: "Triage", promptTemplate: "{{greeting}}, {{name}}!\n{{context}}",
  parameterDefaults: { greeting: "Hello", name: "world" },
  executionTarget: { connectionId: "exe-1", workspace: "triage", cwd: "/repo", agentKind: "codex" },
  concurrencyLimit: 1, enabled: true,
  trigger: { id: "trigger-1", jobId: "job-1", kind: "manual", config: {}, createdAt: "now", updatedAt: "now" },
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
  it("applies defaults, overrides, and the reserved context", () => {
    expect(renderJobPrompt(job(), { parameters: { name: "Ada" }, context: "Fix GEN-2000" })).toBe("Hello, Ada!\nFix GEN-2000");
    expect(() => renderJobPrompt(job({ parameterDefaults: { context: "not allowed" } }), {})).toThrow(/reserved/);
    expect(() => renderJobPrompt(job(), { parameters: { context: "not allowed" } })).toThrow(/reserved/);
  });

  it("queues one encrypted run for a claim regardless of source retries", async () => {
    const repository = new MemoryRepository(); let ids = 0;
    const service = new InvocationService(repository, async value => `encrypted:${value}`, () => `id-${++ids}`, () => "2026-09-16T00:00:00.000Z");
    const request = { source: "webhook" as const, claimKey: "delivery-7", context: "Issue payload", parameters: { greeting: "Hi" }, occurrence: { externalId: "evt-7", metadata: { provider: "linear" } } };
    const first = await service.invoke("job-1", request), retry = await service.invoke("job-1", request);
    expect(first.duplicate).toBe(false); expect(retry.duplicate).toBe(true);
    expect(retry.run.id).toBe(first.run.id); expect(first.run.encryptedPrompt).toBe("encrypted:Hi, world!\nIssue payload");
    expect(JSON.stringify(first)).not.toContain('"prompt":"Hi');
  });

  it("starts queued runs only while the job has capacity", async () => {
    const repository = new MemoryRepository(); const service = new InvocationService(repository, async value => value, undefined, () => "then");
    const first = await service.invoke("job-1", { source: "manual", claimKey: "one" });
    const second = await service.invoke("job-1", { source: "schedule", claimKey: "two", occurrence: { occurredAt: "2026-09-16T01:00:00Z" } });
    expect((await service.startIfCapacity(first.run))?.state).toBe("running");
    expect(await service.startIfCapacity(second.run)).toBeNull();
  });

  it("defines exactly one trigger per job and durable claims in the clean schema", () => {
    expect(JOB_SCHEMA).toContain("job_id TEXT NOT NULL UNIQUE");
    expect(JOB_SCHEMA).toContain("UNIQUE(job_id, claim_key)");
    expect(JOB_SCHEMA).not.toContain("pipes");
  });
});

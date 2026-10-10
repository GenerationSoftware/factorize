import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobInputSchema, manualInvocationSchema, triggerSchema } from "../src/flow-schemas";
import { jobUpdateInput } from "../src/job-contracts";
import { executionTargetResponse } from "../src/editor-contracts";
import { ApiService } from "../src/flow-service";
import { InvocationService, type Invocation, type Job, type JobRun } from "../src/job-domain";
import { validateScheduleConfig, nextOccurrence } from "../src/schedule";
import { evaluateWebhookConditions } from "../src/webhook-conditions";

const guide = (path: string) => readFileSync(new URL(`../../docs/${path}.mdx`, import.meta.url), "utf8");
const examples = (path: string) => [...guide(path).matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!));

describe("maintained hosted documentation examples", () => {
  it("first-job discovery/create/invoke renders the actual prompt and deduplicates a lost response", async () => {
    const [create, invocation] = examples("quickstart");
    const target = executionTargetResponse.parse({ id: "TARGET_ID", kind: "exe-vm", name: "Ephemeral exe.dev VMs", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: "codex", capabilities: ["stop"] });
    const input = jobInputSchema.parse(create);
    expect(input.executionTargetId).toBe(target.id);
    const service = new ApiService({} as any, {} as any);
    const triggers = (service as any).normalizedTriggers(input.triggers);
    expect(triggers[0].slug).toBe("trigger-1");
    const job: Job = { ...input, id: "JOB_ID", model: "", enabled: true, triggers, executionTarget: { connectionId: target.id, agentKind: target.agentKind, workspace: target.workspace, cwd: target.cwd }, createdAt: "now", updatedAt: "now" };
    const stored = new Map<string, { invocation: Invocation; run: JobRun }>();
    const repository = {
      getJob: async () => job,
      findInvocation: async (_jobId: string, key: string) => stored.get(key) ?? null,
      insertInvocationAndRun: async (value: Invocation, run: JobRun) => { stored.set(value.claimKey, { invocation: value, run }); return true; },
      countActiveRuns: async () => 0,
      markRunRunning: async () => { throw new Error("not used"); },
    };
    const { jobId, ...request } = invocation;
    const parsed = manualInvocationSchema.parse(request);
    const invoker = new InvocationService(repository, async text => text);
    const call = { source: "manual" as const, triggerId: triggers[0].id, claimKey: `manual:${parsed.idempotencyKey}`, context: { [triggers[0].slug]: { prompt: parsed.prompt, data: parsed.data ?? {} } } };
    const first = await invoker.invoke(jobId, call);
    const retry = await invoker.invoke(jobId, call);
    expect(first.run.encryptedPrompt).toContain("https://github.com/YOUR_ORG/YOUR_REPO.git");
    expect(first.run.encryptedPrompt).toContain("Review now");
    expect(retry.duplicate).toBe(true);
    expect(retry.run.id).toBe(first.run.id);
    expect(stored.size).toBe(1);
  });

  it("scheduled, Linear, GitHub, ClickUp and lifecycle recipe configurations satisfy current schemas", () => {
    for (const path of ["recipes/scheduled-review", "recipes/linear-job", "recipes/chaining", "integrations/github", "integrations/clickup"]) {
      for (const example of examples(path)) triggerSchema.parse(example);
    }
    const schedule = examples("recipes/scheduled-review")[0].config;
    validateScheduleConfig(schedule);
    expect(nextOccurrence(schedule, new Date("2026-10-09T09:01:00Z")).toISOString()).toBe("2026-10-12T09:00:00.000Z");
  });

  it("reference create/replacement/invocation and conditions examples are actionable", async () => {
    const blocks = examples("mcp/tools");
    const create = blocks.find(value => value.promptTemplate && !value.jobId && !value.id);
    jobInputSchema.parse(create);
    jobUpdateInput.extend({ jobId: jobInputSchema.shape.executionTargetId }).parse(blocks.find(value => value.expectedUpdatedAt));
    const invoke = blocks.find(value => value.idempotencyKey);
    const { jobId, ...request } = invoke;
    expect(jobId).toBe("JOB_ID");
    manualInvocationSchema.parse(request);
    expect(manualInvocationSchema.safeParse({ idempotencyKey: "manual:internal" }).success).toBe(false);
    const condition = blocks.find(value => value.conditions);
    expect((await evaluateWebhookConditions(condition.conditions, condition.webhook)).decision).toBe("match");
  });

  it("documented current limitations match implementation rather than stale tool descriptions", () => {
    const service = readFileSync(new URL("../src/flow-service.ts", import.meta.url), "utf8");
    const scheduler = readFileSync(new URL("../src/postgres/automation-scheduler.ts", import.meta.url), "utf8");
    expect(service).toContain("killRun(runId: string) { return this.stopRun(runId); }");
    for (const key of ["sourceRunId", "sourceJobId", "completedAt", "occurredAt"]) {
      expect(scheduler).toContain(key);
      expect(guide("work/prompts")).toContain(key);
    }
    expect(guide("mcp/tools")).toContain("does not include `output`");
    expect(guide("work/stop-retry")).toContain("does not return `invocation.idempotency_key`");
  });
});

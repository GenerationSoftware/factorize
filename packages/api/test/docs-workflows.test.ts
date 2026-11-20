import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { triggerInputSchema, manualInvocationSchema, eventSchema } from "../src/flow-schemas";
import { triggerUpdateInput } from "../src/job-contracts";
import {exeConnection} from "../src/settings-contracts";
import { ApiService } from "../src/flow-service";
import { InvocationService, type Invocation, type Trigger, type TriggerRun } from "../src/job-domain";
import { validateScheduleConfig, nextOccurrence } from "../src/schedule";
import { evaluateWebhookConditions } from "../src/webhook-conditions";

const guide = (path: string) => readFileSync(new URL(`../../docs/${path}.mdx`, import.meta.url), "utf8");
const examples = (path: string) => [...guide(path).matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!));

describe("maintained hosted documentation examples", () => {
  it("first-trigger discovery/create/invoke renders the actual prompt and deduplicates a lost response", async () => {
    const [create, invocation] = examples("quickstart");
    const target=exeConnection.parse({connectionId:"TARGET_ID",credentialStatus:"connected",accountTags:[]});
    const input=triggerInputSchema.parse(create);
    expect(input.requiresVm).toBe(true);expect(input.executionConfigId).toBeUndefined();
    const service = new ApiService({} as any, {} as any);
    const events = (service as any).normalizedEvents(input.events);
    expect(events[0].slug).toBe("event-1");
    const trigger: Trigger = { ...input, slug: input.name, concurrencyLimit: input.concurrencyLimit ?? 1, id: "JOB_ID", model: "", enabled: true, events, executionConfig: { connectionId: target.connectionId, agentKind: "pi", workspace: "ephemeral", cwd: "/home/exedev/workspace" }, createdAt: "now", updatedAt: "now" };
    const stored = new Map<string, { invocation: Invocation; run: TriggerRun }>();
    const repository = {
      getTrigger: async () => trigger,
      findInvocation: async (_triggerId: string, key: string) => stored.get(key) ?? null,
      insertInvocationAndRun: async (value: Invocation, run: TriggerRun) => { stored.set(value.claimKey, { invocation: value, run }); return true; },
      countActiveRuns: async () => 0,
      markRunRunning: async () => { throw new Error("not used"); },
    };
    const { triggerId, ...request } = invocation;
    const parsed = manualInvocationSchema.parse(request);
    const invoker = new InvocationService(repository, async text => text);
    const call = { source: "manual" as const, eventId: events[0].id, claimKey: `manual:${parsed.idempotencyKey}`, context: { [events[0].slug]: { prompt: parsed.prompt, data: parsed.data ?? {} } } };
    const first = await invoker.invoke(triggerId, call);
    const retry = await invoker.invoke(triggerId, call);
    expect(first.run.encryptedPrompt).toContain("https://github.com/YOUR_ORG/YOUR_REPO.git");
    expect(first.run.encryptedPrompt).toContain("Review now");
    expect(retry.duplicate).toBe(true);
    expect(retry.run.id).toBe(first.run.id);
    expect(stored.size).toBe(1);
  });

  it("scheduled, Linear, GitHub, ClickUp and lifecycle recipe configurations satisfy current schemas", () => {
    for (const path of ["recipes/scheduled-review", "recipes/linear-trigger", "recipes/chaining", "integrations/github", "integrations/clickup"]) {
      for (const example of examples(path)) eventSchema.parse(example);
    }
    const schedule = examples("recipes/scheduled-review")[0].config;
    validateScheduleConfig(schedule);
    expect(nextOccurrence(schedule, new Date("2026-10-09T09:01:00Z")).toISOString()).toBe("2026-10-12T09:00:00.000Z");
  });

  it("reference create/replacement/invocation and conditions examples are actionable", async () => {
    const blocks = examples("mcp/tools");
    const create = blocks.find(value => value.prompt && !value.triggerId && !value.id);
    triggerInputSchema.parse(create);
    triggerUpdateInput.extend({ triggerId: triggerInputSchema.shape.executionConfigId }).parse(blocks.find(value => value.expectedUpdatedAt));
    const invoke = blocks.find(value => value.idempotencyKey);
    const { triggerId, ...request } = invoke;
    expect(triggerId).toBe("JOB_ID");
    manualInvocationSchema.parse(request);
    expect(manualInvocationSchema.safeParse({ idempotencyKey: "manual:internal" }).success).toBe(false);
    const condition = blocks.find(value => value.conditions);
    expect((await evaluateWebhookConditions(condition.conditions, condition.webhook)).decision).toBe("match");
  });

  it("documented current limitations match implementation rather than stale tool descriptions", () => {
    const service = readFileSync(new URL("../src/flow-service.ts", import.meta.url), "utf8");
    const scheduler = readFileSync(new URL("../src/postgres/automation-scheduler.ts", import.meta.url), "utf8");
    expect(service).toContain("killRun(runId: string) { return this.stopRun(runId); }");
    for (const key of ["sourceRunId", "sourceTriggerId", "completedAt", "occurredAt"]) {
      expect(scheduler).toContain(key);
      expect(guide("work/prompts")).toContain(key);
    }
    expect(guide("mcp/tools")).toContain("does not include `output`");
    expect(guide("work/stop-retry")).toContain("does not return `invocation.idempotency_key`");
  });
});

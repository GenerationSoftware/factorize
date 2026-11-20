import { describe, expect, it } from "vitest";
import Mustache from "mustache";
import { InvocationService, composeTriggerContext, renderRunName, type Invocation, type Trigger, type TriggerRepository, type TriggerRun } from "../src/job-domain";

const renderEventTemplate=(value:{prompt:string},context:Record<string,unknown>)=>composeTriggerContext("",value.prompt,context).prompt;

const trigger = (overrides: Partial<Trigger> = {}): Trigger => ({
  id: "trigger-1", name: "triage", slug: "triage", prompt: "",
  model: "",
  executionConfig: { connectionId: "exe-1", workspace: "triage", cwd: "/repo", agentKind: "codex" },
  concurrencyLimit: 1, enabled: true,
  events: [
    {id:"manual-1",triggerId:"trigger-1",slug:"event-1",kind:"manual",enabled:true,config:{},template:"{{event-1.prompt}} · {{event-2.issue.title}}",createdAt:"now",updatedAt:"now"},
    {id:"webhook-1",triggerId:"trigger-1",slug:"event-2",kind:"webhook",enabled:true,config:{},template:"{{event-1.prompt}} · {{event-2.issue.title}}",createdAt:"now",updatedAt:"now"},
    {id:"schedule-1",triggerId:"trigger-1",slug:"event-3",kind:"schedule",enabled:true,config:{},template:"Scheduled",createdAt:"now",updatedAt:"now"},
    {id:"event",triggerId:"trigger-1",slug:"event-4",kind:"triggerLifecycle",enabled:true,config:{},template:"Automatic",createdAt:"now",updatedAt:"now"},
  ],
  createdAt: "now", updatedAt: "now", ...overrides,
});

class MemoryRepository implements TriggerRepository {
  triggers = new Map([["trigger-1", trigger()]]); claims = new Map<string, { invocation: Invocation; run: TriggerRun }>(); active = 0;
  async getTrigger(id: string) { return this.triggers.get(id) ?? null; }
  async findInvocation(triggerId: string, claimKey: string) { return this.claims.get(`${triggerId}:${claimKey}`) ?? null; }
  async insertInvocationAndRun(invocation: Invocation, run: TriggerRun) { const key = `${invocation.triggerId}:${invocation.claimKey}`; if (this.claims.has(key)) return false; this.claims.set(key, { invocation, run }); return true; }
  async countActiveRuns() { return this.active; }
  async markRunRunning(runId: string, startedAt: string) { const value = [...this.claims.values()].find(entry => entry.run.id === runId)!; value.run = { ...value.run, state: "running", startedAt, updatedAt: startedAt }; this.active++; return value.run; }
}

describe("trigger invocation domain", () => {
  it("preserves plain text without decoding literal entities or changing HTML renderers", () => {
    const value = 'https://linear.app/generation/issue/GEN-2108/run-page?a=1&b=2\n{"title":"Fix it"} <script>alert("x")</script> `code` = &amp; &#x2F;';
    const context = { "event-1": { prompt: value }, "event-2": false };
    for (const substitution of ["{{event-1.prompt}}", "{{{event-1.prompt}}}", "{{&event-1.prompt}}"]) {
      expect(renderEventTemplate({ prompt: "{{#event-1}}<task>\n" + substitution + "\n</task>{{/event-1}}{{^event-2}} done{{/event-2}}" }, context))
        .toBe("<task>\n" + value + "\n</task> done");
    }
    expect(renderRunName("Review {{event-1.prompt}}", context, "fallback")).toBe("Review " + value);
    expect(Mustache.render("{{value}}", { value: "<script>&" })).toBe("&lt;script&gt;&amp;");
  });

  it("renders complete contexts and nested JSON in prompts and run names", () => {
    const data = { z: null, items: [{ b: 2, a: "<&" }, [true, null]], a: { y: 2, x: 1 } };
    const context = { "event-1": { prompt: "go", data } };
    const dataJson = '{"a":{"x":1,"y":2},"items":[{"a":"<&","b":2},[true,null]],"z":null}';
    const cases = [
      ["event-1", '{"data":' + dataJson + ',"prompt":"go"}'],
      ["event-1.data", dataJson],
      ["event-1.data.a", '{"x":1,"y":2}'],
      ["event-1.data.items", '[{"a":"<&","b":2},[true,null]]'],
      ["event-1.data.items.0", '{"a":"<&","b":2}'],
      ["event-1.data.z", ""],
      ["event-1.missing", ""],
    ];
    for (const [path, expected] of cases) {
      for (const template of ["{{" + path + "}}", "{{{" + path + "}}}", "{{&" + path + "}}"]) {
        expect(renderEventTemplate({ prompt: "value:" + template }, context)).toBe("value:" + expected);
        expect(renderRunName("value:" + template, context, "fallback")).toBe("value:" + expected);
      }
    }
    expect(renderEventTemplate({ prompt: "{{event-1.data}}" }, { "event-1": { data: { a: { x: 1, y: 2 }, items: data.items, z: null } } })).toBe(dataJson);
    expect(context["event-1"].data).toBe(data);
  });

  it("preserves primitives, sections, array iteration, and empty collections", () => {
    const context = { text: "<&", number: 0, yes: true, no: false, nil: null, empty: {}, list: [], rows: [{ name: "A" }, { name: "B" }] };
    const template = "{{text}}|{{number}}|{{yes}}|{{no}}|{{nil}}|{{empty}}|{{list}}|{{#rows}}{{name}}:{{.}};{{/rows}}{{^nil}}nil{{/nil}}{{^list}}empty{{/list}}{{#empty}}object{{/empty}}";
    const expected = '<&|0|true|false||{}|[]|A:{"name":"A"};B:{"name":"B"};nilemptyobject';
    expect(renderEventTemplate({ prompt: template }, context)).toBe(expected);
    expect(renderRunName(template, context, "fallback")).toBe(expected);
  });

  it("preserves invalid-template errors and run-name fallbacks", () => {
    expect(() => renderEventTemplate({ prompt: "{{#broken}}" }, {})).toThrow("The Event template is not valid Mustache.");
    for (const template of ["", "   ", "{{#broken}}", "{{missing}}", "{{nil}}"]) {
      expect(renderRunName(template, { nil: null }, "fallback")).toBe("fallback");
    }
  });

  it("encrypts and persists the original manual task text at invocation time", async () => {
    const repository = new MemoryRepository();
    repository.triggers.set("trigger-1", trigger({ prompt: "Base literal {{keep}}", events:trigger().events.map(event=>({...event,template:undefined})) }));
    const service = new InvocationService(repository, async value => `encrypted:${value}`);
    const prompt = 'https://linear.app/generation/issue/GEN-2108/run-page\n{"task":"Fix quotes & slashes"}';
    const result = await service.invoke("trigger-1", { source: "manual", eventId: "manual-1", claimKey: "plain-text", context: { "event-1": { prompt } } });
    expect(result.run.encryptedPrompt).toBe(`encrypted:Base literal {{keep}}\n\n${prompt}`);
    expect(repository.claims.get("trigger-1:plain-text")?.run.encryptedPrompt).toBe(result.run.encryptedPrompt);
  });

  it("renders run names with active and inactive event conditionals", () => {
    expect(renderRunName("{{#event-2}}{{event-2.issue.identifier}}{{/event-2}}{{^event-2}}manual{{/event-2}}", { "event-1": { prompt: "go" }, "event-2": false }, "fallback")).toBe("manual");
    expect(renderRunName("{{#event-2}}{{event-2.issue.identifier}}{{/event-2}}", { "event-1": false, "event-2": { issue: { identifier: "GEN-1" } } }, "fallback")).toBe("GEN-1");
  });
  it("renders structured event paths and empty missing values", () => {
    expect(renderEventTemplate({prompt:trigger().events[0].template!}, { "event-1": { prompt: "Fix it" }, "event-2": { issue: { title: "Bug" } } })).toBe("Fix it · Bug");
    expect(renderEventTemplate({prompt:trigger().events[0].template!}, { "event-1": { prompt: "Fix it" } })).toBe("Fix it · ");
    expect(renderEventTemplate({ prompt: "{{event-1.data.name}} ({{event-1.data.priority}})" }, { "event-1": { prompt: "", data: { name: "Ticket run", priority: 1 } } })).toBe("Ticket run (1)");
  });

  it("queues one encrypted run for a claim regardless of source retries", async () => {
    const repository = new MemoryRepository(); let ids = 0;
    const service = new InvocationService(repository, async value => `encrypted:${value}`, () => `id-${++ids}`, () => "2026-09-16T00:00:00.000Z");
    const request = { source: "webhook" as const, eventId: "webhook-1", claimKey: "delivery-7", context: { "event-2": { issue: { title: "Issue payload" } } }, occurrence: { externalId: "evt-7", metadata: { provider: "linear" } } };
    const first = await service.invoke("trigger-1", request), retry = await service.invoke("trigger-1", request);
    expect(first.duplicate).toBe(false); expect(retry.duplicate).toBe(true);
    expect(retry.run.id).toBe(first.run.id); expect(first.run.encryptedPrompt).toBe("encrypted: · Issue payload");
    expect(JSON.stringify(first)).not.toContain('"prompt":"Hi');
  });

  it("renders and persists the configured run name at invocation time", async () => {
    const repository = new MemoryRepository(); repository.triggers.set("trigger-1", trigger({ runNameTemplate: "Review {{event-2.issue.identifier}}" }));
    const service = new InvocationService(repository, async value => value, () => crypto.randomUUID(), () => "2026-09-16T00:00:00.000Z");
    const result = await service.invoke("trigger-1", { source: "webhook", eventId: "webhook-1", claimKey: "delivery-name", context: { "event-2": { issue: { identifier: "GEN-2113" } } } });
    expect(result.run.runName).toBe("Review GEN-2113");
  });

  it("persists explicit manual names and returns the original name on replay", async () => {
    const repository = new MemoryRepository();
    repository.triggers.set("trigger-1", trigger({ runNameTemplate: "Template name" }));
    const service = new InvocationService(repository, async value => value);
    const request = { source: "manual" as const, name: "GEN-2106 — Issue title", eventId: "manual-1", claimKey: "manual:issue", context: { "event-1": { data: { identifier: "GEN-2106" } } } };
    const first = await service.invoke("trigger-1", request);
    expect((await repository.findInvocation("trigger-1", request.claimKey))?.run.runName).toBe(request.name);
    const retry = await service.invoke("trigger-1", { ...request, name: "Changed name" });
    expect(retry).toEqual({ ...first, duplicate: true });
  });

  it.each(["webhook", "schedule", "triggerLifecycle"] as const)("keeps %s names template-derived", async source => {
    const repository = new MemoryRepository();
    repository.triggers.set("trigger-1", trigger({ runNameTemplate: "Automatic" }));
    const result = await new InvocationService(repository, async value => value).invoke("trigger-1", { source, name: "Manual override", eventId: "event", claimKey: "event", context: {} });
    expect(result.run.runName).toBe("Automatic");
  });

  it.each(["", "   "])("uses the template for an empty manual domain name %j", async name => {
    const repository = new MemoryRepository();
    repository.triggers.set("trigger-1", trigger({ runNameTemplate: "{{event-1.data.identifier}}" }));
    const result = await new InvocationService(repository, async value => value).invoke("trigger-1", { source: "manual", name, eventId: "manual-1", claimKey: "event", context: { "event-1": { data: { identifier: "GEN-2106" } } } });
    expect(result.run.runName).toBe("GEN-2106");
  });

  it("starts queued runs only while the trigger has capacity", async () => {
    const repository = new MemoryRepository(); const service = new InvocationService(repository, async value => value, undefined, () => "then");
    const first = await service.invoke("trigger-1", { source: "manual", eventId: "manual-1", claimKey: "one", context: { "event-1": { prompt: "go" } } });
    const second = await service.invoke("trigger-1", { source: "schedule", eventId: "schedule-1", claimKey: "two", context: { "event-3": { scheduled_at: "2026-09-16T01:00:00Z" } }, occurrence: { occurredAt: "2026-09-16T01:00:00Z" } });
    expect((await service.startIfCapacity(first.run))?.state).toBe("running");
    expect(await service.startIfCapacity(second.run)).toBeNull();
  });

});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONDITION_LIMITS, evaluateWebhookConditions, validateConditions } from "../src/webhook-conditions";
import { webhookTriggerConfigSchema } from "../src/flow-schemas";
const build = JSON.parse(readFileSync(new URL("../migrations/build-manager-conditions.json", import.meta.url), "utf8"));
export const leaf = (path: string, operator: string, value: unknown) => ({ fact: "webhook", path, operator, value });
const decision = async (conditions: unknown, webhook: Record<string, unknown>) => (await evaluateWebhookConditions(conditions, webhook)).decision;
describe("shared webhook conditions", () => {
  it("preserves all Build Manager exclusions and accepted/missing/null/wrong-type cases", async () => {
    for (const conclusion of [undefined, null, "success", "skipped", "failure"])
      for (const branch of [undefined, null, 123, "main", "feature", "gh-readonly-queue/main/test"])
        for (const sender of [undefined, null, "github-merge-queue[bot]", "human"])
          for (const app of [undefined, null, "mintlify", "github-actions"]) {
            const excluded = (conclusion === "success" && typeof branch === "string" && branch.startsWith("gh-readonly-queue/")) || (conclusion === "success" && branch === "main" && sender === "github-merge-queue[bot]") || (conclusion === "skipped" && app === "mintlify");
            expect(await decision(build, { action: "completed", check_suite: { conclusion, head_branch: branch, app: { slug: app } }, sender: { login: sender } })).toBe(excluded ? "no-match" : "match");
          }
    for (const check_suite of [undefined, null, false, "invalid"])
      expect(await decision(build, { action: "completed", check_suite })).toBe("match");
  });
  it("uses strict equality and documented missing-field semantics", async () => {
    expect(await decision(undefined, {})).toBe("match");
    expect(await decision(leaf("$.missing", "notEqual", "x"), {})).toBe("match");
    expect(await decision(leaf("$.missing", "equal", null), {})).toBe("no-match");
    expect(await decision(leaf("$.id", "equal", 42), { id: "42" })).toBe("no-match");
    expect(await decision(leaf("$.id", "equal", null), { id: null })).toBe("match");
    for (const value of [undefined, null, 1, [], {}]) expect(await decision(leaf("$.branch", "startsWith", "gh-"), { branch: value })).toBe("no-match");
  });
  it("supports scalar/index/quoted property and wildcard paths with Boolean nesting", async () => {
    const context = { items: [{ tag: "a" }, { tag: "b" }], tags: ["a", "b"], "quoted-key": "yes", "literal.*": "scalar" };
    for (const path of ["$.items[0].tag", "$['items'][0].tag", '$["items"][0].tag']) expect(await decision(leaf(path, "equal", "a"), context)).toBe("match");
    expect(await decision(leaf('$["literal.*"]', "equal", "scalar"), context)).toBe("match");
    for (const path of ["$.items[*].tag", "$.tags", "$.items.*.tag"]) expect(await decision(leaf(path, "contains", "b"), context)).toBe("match");
    expect(await decision({ not: { any: [{ all: [leaf("$.tags", "doesNotContain", "b"), leaf("$.items[0].tag", "in", ["a", "c"])] }, leaf("$.items[0].tag", "notIn", ["a"])] } }, context)).toBe("match");
    expect(await decision(leaf("$.items[*].missing", "contains", "x"), context)).toBe("no-match");
    expect(await decision(leaf("$.text", "contains", "x"), { text: "xxx" })).toBe("no-match");
  });
  it("requires finite numeric operands rather than lexical/coerced comparison", async () => {
    for (const operator of ["lessThan", "lessThanInclusive", "greaterThan", "greaterThanInclusive"]) {
      expect(() => validateConditions(leaf("$.n", operator, "10"))).toThrow();
      expect(await decision(leaf("$.n", operator, 10), { n: "2" })).toBe("no-match");
      expect(await decision(leaf("$.n", operator, 10), { n: null })).toBe("no-match");
    }
    expect(await decision(leaf("$.n", "lessThan", 10), { n: 2 })).toBe("match");
  });
  it("rejects executable paths, unknown operators/facts, mixed groups and user engine options", async () => {
    const invalid = [null, {}, [], { all: [] }, { any: [] }, { not: {} }, { all: [leaf("$.x", "equal", true)], any: [] }, { ...leaf("$.x", "equal", true), priority: 2 }, { ...leaf("$.x", "equal", true), fact: "network" }, leaf("$.x", "unknown", true), leaf("$.x", "in", "abc"), leaf("$.x", "equal", { fact: "network" }), leaf("$.x", "startsWith", 1)];
    for (const path of ["x", "$..x", "$.a[?(@.x)]", "$.a[(@.length-1)]", "$.a[0:2]", "$.a[0,1]", "$.a[", "$.a()"] ) invalid.push(leaf(path, "equal", true));
    for (const value of invalid) { expect(() => validateConditions(value)).toThrow(); expect(await decision(value, {})).toBe("error"); }
  });
  it("bounds byte size, depth and nodes", async () => {
    expect(() => validateConditions(leaf("$.x", "equal", "x".repeat(CONDITION_LIMITS.bytes)))).toThrow("byte");
    expect(() => validateConditions({ all: Array.from({ length: CONDITION_LIMITS.nodes }, () => leaf("$.x", "equal", true)) })).toThrow("node");
    let nested: unknown = leaf("$.x", "equal", true);
    for (let i = 0; i < CONDITION_LIMITS.depth; i++) nested = { not: nested };
    expect(() => validateConditions(nested)).toThrow("depth");
    expect(() => validateConditions({ all: Array.from({ length: CONDITION_LIMITS.nodes - 1 }, () => leaf("$.x", "equal", true)) })).not.toThrow();
  });
  it("returns plain result objects and leaves context intact", async () => {
    const webhook = { id: "a", payload: { x: 1 } }, original = structuredClone(webhook);
    const result = await evaluateWebhookConditions({ any: [leaf("$.id", "equal", "a"), leaf("$.id", "equal", "b")] }, webhook);
    expect(result.decision).toBe("match"); expect(typeof result.details[0]).toBe("object");
    expect(typeof result.details[0].conditions).toBe("object");
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result); expect(webhook).toEqual(original);
  });
  it("validates conditions for every provider and rejects legacy requests", () => {
    const configs = [{ provider: "linear", projectId: "p", matchRules: [{ type: "status", targetId: "done" }] }, { provider: "clickup", listId: "l", matchRules: [{ type: "status", targetId: "done" }] }, { provider: "github", installationId: 1, repositoryId: 2, event: "check_suite", action: "completed" }, { provider: "cloudflareTail", integrationId: "tail" }];
    for (const config of configs) {
      expect(webhookTriggerConfigSchema.parse({ ...config, conditions: build })).toEqual({ ...config, conditions: build });
      expect(() => webhookTriggerConfigSchema.parse({ ...config, handlerCode: "removed" })).toThrow();
    }
  });
});

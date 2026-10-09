import { Engine, Operator, OperatorDecorator, type TopLevelCondition } from "json-rules-engine";
import { JSONPath } from "jsonpath-plus";
import { z } from "zod";

export const CONDITION_LIMITS = { bytes: 16_384, depth: 16, nodes: 128, contextBytes: 262_144 } as const;
type Scalar = string | number | boolean | null;
export type WebhookConditions = { all: WebhookConditions[] } | { any: WebhookConditions[] } | { not: WebhookConditions } | { fact: "webhook"; path: string; operator: string; value: Scalar | Scalar[] };
export type ConditionDecision = { decision: "match" | "no-match" | "error"; error?: string; details: Record<string, unknown>[] };
const numeric = new Set(["lessThan", "lessThanInclusive", "greaterThan", "greaterThanInclusive"]);
const operators = new Set(["equal", "notEqual", "in", "notIn", "contains", "doesNotContain", "startsWith", ...numeric]);
// Deliberately excludes recursive descent, unions, slices, filters and scripts.
const pathPattern = /^\$(?:(?:\.[A-Za-z_][A-Za-z0-9_-]*)|(?:\[\d+\])|(?:\[\*\])|(?:\.\*)|(?:\['[^'\\\x00-\x1f]+'\])|(?:\["[^"\\\x00-\x1f]+"\]))*$/;
const scalar = (value: unknown): value is Scalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function validateConditions(input: unknown): asserts input is WebhookConditions {
  let count = 0;
  function visit(value: unknown, depth: number): void {
    if (depth > CONDITION_LIMITS.depth || ++count > CONDITION_LIMITS.nodes) throw new Error("Conditions exceed the depth or node limit.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each condition must be an object.");
    const node = value as Record<string, unknown>, keys = Object.keys(node);
    const group = ["all", "any", "not"].find(key => Object.hasOwn(node, key));
    if (group) {
      if (keys.length !== 1) throw new Error("Boolean groups accept only all, any, or not.");
      if (group === "not") visit(node.not, depth + 1);
      else {
        const children = node[group];
        if (!Array.isArray(children) || !children.length) throw new Error("Condition groups must not be empty.");
        for (const child of children) visit(child, depth + 1);
      }
      return;
    }
    if (keys.length !== 4 || !["fact", "path", "operator", "value"].every(key => Object.hasOwn(node, key))) throw new Error("Leaf conditions require only fact, path, operator, and value.");
    if (node.fact !== "webhook") throw new Error("Only the webhook fact is allowed.");
    if (typeof node.path !== "string" || node.path.length > 512 || !pathPattern.test(node.path)) throw new Error("Unsupported JSONPath; use properties, indexes, and wildcards.");
    if (typeof node.operator !== "string" || !operators.has(node.operator)) throw new Error("Unsupported condition operator.");
    if (numeric.has(node.operator)) {
      if (typeof node.value !== "number" || !Number.isFinite(node.value)) throw new Error("Numeric operators require a finite number.");
    } else if (node.operator === "startsWith") {
      if (typeof node.value !== "string") throw new Error("startsWith requires a string.");
    } else if (["in", "notIn"].includes(node.operator)) {
      if (!Array.isArray(node.value) || !node.value.every(scalar)) throw new Error("in and notIn require an array of scalar values.");
    } else if (!scalar(node.value)) throw new Error("This operator requires a scalar value.");
  }
  visit(input, 1);
  if (bytes(input) > CONDITION_LIMITS.bytes) throw new Error("Conditions exceed the 16384 byte limit.");
}
export const conditionsSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  try { validateConditions(value); } catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); }
});
export const preparedWebhookSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (bytes(value) > CONDITION_LIMITS.contextBytes) ctx.addIssue({ code: "custom", message: "Prepared webhook exceeds the 262144 byte limit." });
});
function engineConditions(node: WebhookConditions): TopLevelCondition {
  function convert(value: WebhookConditions): any {
    if ("all" in value) return { all: value.all.map(convert) };
    if ("any" in value) return { any: value.any.map(convert) };
    if ("not" in value) return { not: convert(value.not) };
    return { ...value, operator: numeric.has(value.operator) ? `finiteNumber:${value.operator}` : value.operator };
  }
  const converted = convert(node);
  return "fact" in node ? { all: [converted] } : converted;
}
/** A fresh engine with one supplied fact. No callbacks, network facts, or invocation. */
export async function evaluateWebhookConditions(conditions: unknown, webhook: Record<string, unknown>): Promise<ConditionDecision> {
  try {
    if (conditions === undefined) return { decision: "match", details: [] };
    validateConditions(conditions);
    const engine = new Engine([], { pathResolver: (json, path) => JSONPath({ path, json, eval: false, wrap: /\.\*|\[\*\]/.test(path) }) });
    engine.addOperator(new Operator("startsWith", (a, b) => typeof a === "string" && typeof b === "string" && a.startsWith(b)));
    // Constrain runtime operands while preserving the library's comparison semantics.
    engine.addOperatorDecorator(new OperatorDecorator("finiteNumber", (a, b, next) => typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b) && next(a, b)));
    engine.addRule({ conditions: engineConditions(conditions), event: { type: "factorize-match" } });
    const result = await engine.run({ webhook });
    const details = [...result.results, ...result.failureResults].map(rule => {
      const plain = JSON.parse(JSON.stringify(rule.toJSON(false))) as Record<string, unknown>;
      function display(node: any): void {
        if (node.all) node.all.forEach(display);
        else if (node.any) node.any.forEach(display);
        else if (node.not) display(node.not);
        else if (typeof node.operator === "string") node.operator = node.operator.replace(/^finiteNumber:/, "");
      }
      display(plain.conditions);
      return plain;
    });
    return { decision: result.events.length ? "match" : "no-match", details };
  } catch {
    // Never persist arbitrary payloads or library exceptions in runtime diagnostics.
    return { decision: "error", error: "Invalid webhook conditions or evaluation failure.", details: [] };
  }
}

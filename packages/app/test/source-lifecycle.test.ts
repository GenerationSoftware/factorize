import { describe, expect, it } from "vitest";
import { preparePublicSource, publicSource, resolveContextTemplate, renderSourcePrompt, TAIL_CONTEXT_TEMPLATE } from "../src/source-lifecycle";

describe("source lifecycle", () => {
  it("prepares the default Tail handler and preserves its secret on update", async () => {
    const created = await preparePublicSource("tenant", "flow", { kind: "cloudflareTail" });
    expect(created).toMatchObject({ kind: "custom", origin: "cloudflare", handlerDeployment: { state: "ready" } });
    const updated = await preparePublicSource("tenant", "flow", { kind: "cloudflareTail", handlerCode: (created as any).handlerCode }, created);
    expect((updated as any).tail.signingSecret).toBe((created as any).tail.signingSecret);
    expect(publicSource(updated)).not.toHaveProperty("tail");
    expect(publicSource(updated)).not.toHaveProperty("handlerDeployment");
  });

  it("renders Tail data through its stored Mustache template", async () => {
    const source = await preparePublicSource("tenant", "flow", { kind: "cloudflareTail" });
    expect(resolveContextTemplate({ kind: "cloudflareTail" })).toBe(TAIL_CONTEXT_TEMPLATE);
    expect(renderSourcePrompt(source, "{{flow.name}}/{{deliveryId}}/{{eventJson}}", { outcome: "exception" }, "Tail", "d1")).toContain("Tail/d1/");
    expect(() => resolveContextTemplate({ kind: "cloudflareTail" }, "{{#broken}}")).toThrow("invalid Mustache");
  });
});

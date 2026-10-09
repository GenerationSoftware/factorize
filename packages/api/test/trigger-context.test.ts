import { describe, expect, it } from "vitest";
import { reflectTriggerContext, triggerContextCatalog } from "../src/trigger-context";

describe("trigger context reflection", () => {
  it("defines typed nested paths for every built-in kind and provider", () => {
    expect(Object.keys(triggerContextCatalog)).toEqual(expect.arrayContaining(["manual", "schedule", "linear", "github", "cloudflareTail", "jobLifecycle"]));
    expect(triggerContextCatalog).not.toHaveProperty("custom");
    for (const paths of Object.values(triggerContextCatalog)) {
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every(path => path.path && path.type && path.description)).toBe(true);
    }
    expect(triggerContextCatalog.linear).toContainEqual(expect.objectContaining({ path: "issue.title", type: "string" }));
    expect(triggerContextCatalog.github).toContainEqual(expect.objectContaining({ path: "pull_request.number", type: "number" }));
    expect(triggerContextCatalog.github).toContainEqual(expect.objectContaining({ path: "issue.title", type: "string" }));
  });

  it("preserves the slug and explicitly marks unknown handler output", () => {
    const reflected = reflectTriggerContext({ slug: "trigger-7", kind: "webhook", config: { provider: "linear", handlerCode: "function handler() { return {}; }" } });
    expect(reflected).toMatchObject({ slug: "trigger-7", provider: "linear", dynamic: true });
    expect(reflected.paths).toEqual([{ path: "*", type: "unknown", description: expect.any(String) }]);
  });
});

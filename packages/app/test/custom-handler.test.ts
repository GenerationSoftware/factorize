import { describe, expect, it } from "vitest";
import { invokeCustomHandler, userWorkerModule, validateHandlerCode } from "../src/custom-handler";

describe("custom handlers", () => {
  const runAdapter = async (body: string) => {
    const source = userWorkerModule(`function handler(webhook) { ${body} }`);
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${crypto.randomUUID()}`);
    const response = await module.default.fetch(new Request("https://handler.internal", { method: "POST", body: "{}" }));
    return response.json();
  };

  it("accepts only the complete synchronous function contract", () => {
    expect(validateHandlerCode("function handler(webhook) { return webhook.type === 'Issue'; }")).toContain("function handler");
    for (const code of ["return true", "const handler = () => true", "async function handler(webhook) { return true; }", "function other(webhook) { return true; }"]) {
      expect(() => validateHandlerCode(code)).toThrow("complete function handler(webhook)");
    }
  });

  it("pins an adapter that rejects thenables and invalid return types without exposing errors", () => {
    const module = userWorkerModule("function handler(webhook) { return true; }");
    expect(module).toContain('typeof result.then === "function"');
    expect(module).toContain('typeof result === "boolean"');
    expect(module).toContain("Array.isArray(result)");
    expect(module).not.toContain("error.stack");
  });

  it("loads handlers without bindings or outbound network access", async () => {
    let loaded: WorkerLoaderWorkerCode | undefined;
    const loader = {
      load(code: WorkerLoaderWorkerCode) {
        loaded = code;
        return {
          getEntrypoint: () => ({
            fetch: async () => Response.json({ ok: true, decision: true }),
          }),
        };
      },
    } as unknown as WorkerLoader;
    const source = { handlerCode: "function handler(webhook) { return true; }" };

    await expect(invokeCustomHandler(loader, source, {})).resolves.toEqual({ ok: true, decision: true });
    expect(loaded?.env).toEqual({});
    expect(loaded?.globalOutbound).toBeNull();
    expect(loaded?.limits).toEqual({ cpuMs: 10, subRequests: 0 });
  });

  it("admits literal booleans and fails closed on invalid synchronous results", async () => {
    await expect(runAdapter("return true;")).resolves.toEqual({ ok: true, decision: true });
    await expect(runAdapter("return false;")).resolves.toEqual({ ok: true, decision: false });
    await expect(runAdapter("return 1;")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return Promise.resolve(true);")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return { then() {} };")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return { issue: { id: 'i1' } };")).resolves.toEqual({ ok: true, decision: { issue: { id: "i1" } } });
    await expect(runAdapter("return [1, 2];")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return null;")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return { missing: undefined };")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return { value: NaN };")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("return { value: 1n };")).resolves.toEqual({ ok: false, category: "invalid_return" });
    await expect(runAdapter("throw new Error('secret');")).resolves.toEqual({ ok: false, category: "handler_error" });
  });
});

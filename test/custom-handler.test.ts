import { describe, expect, it } from "vitest";
import { CUSTOM_HANDLER_MAX_CODE_BYTES, customScriptName, invokeCustomHandler, userWorkerModule, validateCustomHandler } from "../src/custom-handler";
import type { CustomSource } from "../src/types";

describe("custom handlers", () => {
  const runAdapter = async (body: string) => {
    const source = userWorkerModule(`function handler(webhook) { ${body} }`);
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${crypto.randomUUID()}`);
    const response = await module.default.fetch(new Request("https://handler.internal", { method: "POST", body: "{}" }));
    return response.json();
  };

  it("accepts only the complete synchronous function contract", () => {
    expect(validateCustomHandler("linear", "Issues", "function handler(webhook) { return webhook.type === 'Issue'; }").origin).toBe("linear");
    for (const code of ["return true", "const handler = () => true", "async function handler(webhook) { return true; }", "function other(webhook) { return true; }"]) {
      expect(() => validateCustomHandler("linear", "x", code)).toThrow("complete function handler(webhook)");
    }
  });

  it("enforces origin, name, and source size limits", () => {
    expect(validateCustomHandler("cloudflare", "Tail failures", "function handler(webhook) { return webhook.outcome === 'exception'; }").origin).toBe("cloudflare");
    expect(() => validateCustomHandler("slack", "x", "function handler(webhook) { return true; }")).toThrow("Linear, GitHub, or Cloudflare");
    expect(() => validateCustomHandler("github", "", "function handler(webhook) { return true; }")).toThrow("Handler name");
    expect(() => validateCustomHandler("github", "x", `function handler(webhook) { /*${"x".repeat(CUSTOM_HANDLER_MAX_CODE_BYTES)}*/ return true; }`)).toThrow("at most");
  });

  it("uses opaque stable names isolated by tenant and flow", async () => {
    const first = await customScriptName("tenant-a", "flow-a");
    expect(first).toMatch(/^fh-[a-f0-9]{40}$/);
    expect(first).toBe(await customScriptName("tenant-a", "flow-a"));
    expect(first).not.toBe(await customScriptName("tenant-b", "flow-a"));
    expect(first).not.toContain("tenant");
  });

  it("pins an adapter that rejects thenables and non-booleans without exposing errors", () => {
    const module = userWorkerModule("function handler(webhook) { return true; }");
    expect(module).toContain('typeof result.then === "function"');
    expect(module).toContain('typeof result !== "boolean"');
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
    const source: CustomSource = {
      kind: "custom",
      origin: "github",
      handlerName: "isolated",
      handlerCode: "function handler(webhook) { return true; }",
      handlerDeployment: { scriptName: "fh-0000000000000000000000000000000000000000", codeDigest: "0".repeat(64), state: "ready" },
    };

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
    await expect(runAdapter("throw new Error('secret');")).resolves.toEqual({ ok: false, category: "handler_error" });
  });
});

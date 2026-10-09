import { describe, expect, it } from "vitest";
import { agentDriver } from "../src/agent-driver";
import { sourceCommand, validateTraceSources, type TraceSource } from "../src/trace-source";
import { consumeTraceStream, parseTrace } from "../src/trace";

const source: TraceSource = { kind: "execution_stream", path: "/tmp/trace/events.jsonl", mediaType: "application/x-ndjson", provider: "codex", formatVersion: "1", harnessVersion: "test" };
export const record = JSON.stringify({ version: 1, id: "a", type: "assistant_message", title: "Assistant", preview: "hello 😀", display: { model: "test" } });

describe("execution stream contract", () => {
  it("declares Codex and Claude primary streams and preserves the Pi native driver", () => {
    for (const provider of ["codex", "claude", "pi"] as const) {
      const launch = agentDriver(provider).launch("run-1", {});
      expect(launch.traceSources?.primary).toMatchObject({ kind: provider === "pi" ? "native_session" : "execution_stream", mediaType: "application/x-ndjson", provider });
      validateTraceSources(launch.traceSources!);
    }
  });
  it("reserves JSONL paths and keeps native sessions separate", () => {
    expect(sourceCommand({ ...source, discoverCommand: "untrusted ignored discovery" })).toBe("printf '%s' '/tmp/trace/events.jsonl'");
    expect(() => validateTraceSources({ primary: { ...source, path: "/tmp/factorize.stderr" } })).toThrow("reserved");
    expect(() => validateTraceSources({ primary: source, nativeSession: { ...source, kind: "native_session" } })).toThrow("separate");
  });
  it("uses the same normalized events for every provider", () => {
    for (const provider of ["codex", "claude", "pi"] as const) expect(parseTrace(provider, record, "execution_stream")).toEqual([{ sequence: 1, id: "a", type: "assistant_message", title: "Assistant", preview: "hello 😀", display: { model: "test" } }]);
  });
  it("reconciles only complete records, including across UTF-8 byte boundaries", async () => {
    const bytes = new TextEncoder().encode(`${record}\n{"version":1`);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const events: any[] = [];
    expect(await consumeTraceStream("codex", stream, async items => { events.push(...items); }, 1, "execution_stream")).toBe(1);
    expect(events).toEqual(parseTrace("codex", record, "execution_stream"));
    const truncatedUtf8 = new Uint8Array([...new TextEncoder().encode(`${record}\n{"preview":"`), 240, 159]);
    const complete: any[] = [];
    await consumeTraceStream("codex", new Response(truncatedUtf8).body!, async items => { complete.push(...items); }, 250, "execution_stream");
    expect(complete).toEqual(events);
    expect(() => parseTrace("claude", "{}", "execution_stream")).toThrow("Invalid execution stream record");
    expect(() => parseTrace("claude", "invalid", "execution_stream")).toThrow("Invalid execution stream JSON");
  });
});


describe("deployment source gates", () => {
  it("canaries only selected tenants and restores native for new launches while retaining Pi", async () => {
    const { rolloutTraceSources } = await import("../src/trace-source");
    const { agentDriver } = await import("../src/agent-driver");
    for (const provider of ["codex", "claude", "pi"] as const) {
      const sources = agentDriver(provider).launch("run", {}).traceSources!;
      expect(rolloutTraceSources(sources, "canary", { TRACE_STREAM_TENANTS: "canary" }).primary.kind).toBe(provider === "pi" ? "native_session" : "execution_stream");
      expect(rolloutTraceSources(sources, "other", { TRACE_STREAM_TENANTS: "canary" }).primary.kind).toBe("native_session");
      expect(rolloutTraceSources(sources, "canary", { TRACE_PRIMARY_MODE: "native_session" }).primary.kind).toBe("native_session");
      expect(sources.primary.kind).toBe(provider === "pi" ? "native_session" : "execution_stream");
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consumeTraceStream, parseTrace, type TraceEvent } from "../src/trace";
import { agentDriver } from "../src/agent-driver";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/codex/${name}`, import.meta.url), "utf8");
describe("Codex traces", () => {
  it("launches raw stdout as the primary source with a separate native audit", () => {
    const launch = agentDriver("codex").launch("run-1", {});
    expect(launch.args).toContain("--json");
    expect(launch.traceSources?.primary).toMatchObject({ kind: "execution_stream", formatVersion: "codex-exec-jsonl" });
    expect(launch.traceSources?.nativeSession?.kind).toBe("native_session");
  });
  it("projects the captured CLI command immediately and correlates its completion", async () => {
    const transcript = fixture("exec-0.161.0.jsonl");
    const expected = parseTrace("codex", transcript, "execution_stream");
    const call = expected.find(item => item.type === "tool_call")!;
    const result = expected.find(item => item.type === "tool_result")!;
    expect(call.preview).toContain("printf trace-fixture");
    expect(result.parentId).toBe(call.id);
    expect(result.title).toBe(call.title);
    const bytes = new TextEncoder().encode(transcript);
    const actual: TraceEvent[] = [];
    await consumeTraceStream("codex", new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }), async batch => { actual.push(...batch); }, 1, "execution_stream");
    expect(actual).toEqual(expected);
    // Live chunks use the persisted sequence and need no process-local state.
    const live: TraceEvent[] = [];
    for (const line of transcript.trim().split("\n")) live.push(...parseTrace("codex", line, "execution_stream", live.length + 1));
    expect(live).toEqual(expected);
  });
  it("correlates current custom and legacy native calls across streamed records", async () => {
    const text = fixture("native-calls.jsonl");
    const expected = parseTrace("codex", text);
    expect(expected.map(item => item.type)).toEqual(["tool_call", "tool_result", "tool_call", "tool_result"]);
    expect(expected[1]).toMatchObject({ parentId: "custom-1", title: "exec_command" });
    expect(expected[3]).toMatchObject({ parentId: "legacy-1", title: "shell" });
    expect(expected[0].display.arguments).toEqual({ cmd: "printf test" });
    const actual: TraceEvent[] = [];
    await consumeTraceStream("codex", new Response(text).body!, async batch => { actual.push(...batch); }, 1);
    expect(actual).toEqual(expected);
  });
  it("handles every documented item, errors and future records without leaking secrets", () => {
    const records = [
      { type: "item.completed", item: { id: "r", type: "reasoning", text: "Thinking 😀" } },
      { type: "item.started", item: { id: "m", parent_id: "r", type: "mcp_tool_call", server: "test", tool: "read", arguments: { password: "sensitive-value" } } },
      { type: "item.completed", item: { id: "m", type: "mcp_tool_call", server: "test", tool: "read", result: { content: "ok" } } },
      { type: "item.completed", item: { id: "f", type: "file_change", changes: [{ path: "a", kind: "update" }] } },
      { type: "item.started", item: { id: "w", type: "web_search", query: "test" } },
      { type: "item.completed", item: { id: "p", type: "todo_list", items: [] } },
      { type: "turn.failed", error: { message: "failed" } },
      { type: "error", message: "Bearer abcdefghijklmnop" },
      { type: "future.event", secret: "sensitive-value" },
      { type: "item.completed", item: { id: "u", type: "future.item", secret: "sensitive-value" } },
      { type: "item.completed", item: { id: "a", type: "agent_message", text: "x".repeat(100000) } },
    ];
    const events = parseTrace("codex", records.map(record => JSON.stringify(record)).join("\n") + "\ninvalid\n" + JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }), "execution_stream");
    expect(events.at(-1)?.type).toBe("usage");
    expect(events.filter(item => item.type === "error")).toHaveLength(2);
    expect(events.find(item => item.type === "warning")).toBeDefined();
    expect(events[1].parentId).toBe("r");
    expect(JSON.stringify(events)).not.toContain("sensitive-value");
    expect(JSON.stringify(events)).not.toContain("abcdefghijklmnop");
    expect(events.every(item => item.preview.length <= 32768)).toBe(true);
  });
});

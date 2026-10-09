import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consumeTraceStream, parseTrace } from "../src/trace";
import { agentDriver } from "../src/agent-driver";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/pi/1.1.0/${name}.jsonl`, import.meta.url), "utf8");

describe("Pi 1.1.0 / native session v3", () => {
  it("pins the runtime and declares the native artifact with version provenance", () => {
    const launch = agentDriver("pi").launch("run", {});
    expect(launch.executable).toBe("/bin/sh");
    expect(launch.args[1]).toContain('test "$(pi --version)" = "1.1.0"');
    expect(launch.traceSources?.primary).toMatchObject({ kind: "native_session", provider: "pi", cliVersion: "1.1.0", formatVersion: "3" });
  });

  it("preserves native entry provenance and links multiple calls and results", () => {
    const events = parseTrace("pi", fixture("documented-v3"));
    const calls = events.filter(e => e.type === "tool_call");
    expect(calls.map(e => e.display.toolCallId)).toEqual(["call-1", "call-2"]);
    for (const call of calls) {
      expect(call.id).toBe("assistant");
      expect(call.parentId).toBe("user");
      expect(call.occurredAt).toBe("2024-12-03T14:00:00.000Z");
      expect(call.display.entryId).toBe("assistant");
      expect(call.display.messageTimestamp).toBe(1733234401000);
    }
    expect(events.find(e => e.id === "result")).toMatchObject({ type: "tool_result", parentId: "assistant", display: { toolCallId: "call-1", isError: false } });
    expect(events.find(e => e.id === "model")?.display.parentId).toBeNull();
    expect(events.find(e => e.id === "bash")).toMatchObject({ type: "command", display: { exitCode: 0, truncated: true, excludeFromContext: true } });
    expect(events.find(e => e.type === "usage")?.display.usage).toMatchObject({ totalTokens: 20 });
  });

  it("retains branches, compaction boundaries, prompt patches and custom/future metadata", () => {
    const events = parseTrace("pi", fixture("documented-v3"));
    expect(events.find(e => e.id === "compact")).toMatchObject({ type: "compaction", parentId: "bash", display: { firstKeptEntryId: "result", tokensBefore: 50000, systemMessage: { content: "Checkpoint" } } });
    expect(events.find(e => e.id === "branch")).toMatchObject({ type: "branch", parentId: "user", display: { fromId: "compact" } });
    for (const id of ["system", "custom", "custom-msg", "label", "info", "edit", "future"]) expect(events.find(e => e.id === id)?.type).toBe("metadata");
    expect(events.find(e => e.id === "system")?.display.metadata).toMatchObject({ sections: { skills: null }, toolsRemoved: [{ name: "write" }] });
    expect(events.find(e => e.id === "edit")?.display.metadata).toMatchObject({ targetId: "result", replacement: null });
    expect(events.find(e => e.id === "future")?.display.metadata).toMatchObject({ data: { unknown: "retained" } });
    expect(events.find(e => e.id === "usage")).toMatchObject({ type: "usage", display: { kind: "future-operation" } });
    expect(JSON.stringify(events)).not.toMatch(/BINARY_MUST_NOT_PROJECT|OPAQUE_MUST_NOT_PROJECT/);
  });

  it("projects actual deployed binary output and matches byte-stream parsing", async () => {
    const jsonl = fixture("native-session");
    const events = parseTrace("pi", jsonl);
    expect(events.find(e => e.type === "tool_call")).toMatchObject({ title: "bash", display: { toolCallId: "fixture-call", arguments: { command: "printf fixture-output" } } });
    expect(events.find(e => e.type === "tool_result")).toMatchObject({ preview: "fixture-output", display: { toolCallId: "fixture-call", isError: false } });
    expect(events.some(e => e.type === "usage")).toBe(true);
    const bytes = new TextEncoder().encode(jsonl);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17)); controller.close(); } });
    const streamed: typeof events = [];
    await consumeTraceStream("pi", stream, async batch => { streamed.push(...batch); }, 2);
    expect(streamed).toEqual(events);
  });

  it("marks legacy sessions as unmigrated without inventing tree ancestry", () => {
    for (const version of [undefined, 1, 2]) {
      const events = parseTrace("pi", [
        { type: "session", id: "legacy", version },
        { type: "message", id: "legacy-entry", message: { role: "hookMessage", content: "legacy extension" } },
      ].map(record => JSON.stringify(record)).join("\n"));
      expect(events[0]?.display).toMatchObject({ version: version ?? 1, compatibility: "best_effort_unmigrated" });
      expect(events[1]).toMatchObject({ id: "legacy-entry", type: "metadata", title: "Custom message" });
      expect(events[1]?.parentId).toBeUndefined();
      expect(events[1]?.display.parentId).toBeNull();
    }
  });

  it("bounds arguments/results and tolerates unknown blocks, roles and invalid values", () => {
    const records = [
      null, [], { type: "constructor", id: "prototype-name" }, { type: "session", version: 99, id: "future" },
      { type: "message", id: "a", timestamp: "invalid", message: { role: "assistant", content: [null, { type: "future-block", data: "x".repeat(100000) }, { type: "toolCall", id: "c", name: "tool", arguments: { large: "x".repeat(100000) } }, { type: "thinking", redacted: true, thinkingSignature: "opaque" }], stopReason: "error", errorMessage: "failure" } },
      { type: "message", id: "r", message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "x".repeat(100000) }], isError: true, details: { large: "x".repeat(100000) } } },
      { type: "message", message: { role: "future-role", content: "safe" } },
      { type: "message", message: { role: "hookMessage", content: "legacy" } },
    ];
    const events = parseTrace("pi", records.map(r => JSON.stringify(r)).join("\n"));
    expect(events.find(e => e.id === "future")?.display.compatibility).toBe("best_effort_unmigrated");
    expect(events.every(e => e.preview.length < 33000)).toBe(true);
    expect(JSON.stringify(events.find(e => e.type === "tool_call")?.display.arguments).length).toBeLessThan(34000);
    expect(events.find(e => e.type === "tool_result")?.display.isError).toBe(true);
    expect(events.find(e => e.type === "reasoning")?.preview).toBe("[Redacted thinking]");
    expect(events.find(e => e.id === "a")?.occurredAt).toBeUndefined();
    expect(events.some(e => e.type === "error")).toBe(true);
    expect(events.at(-1)?.title).toBe("Custom message");
  });
});

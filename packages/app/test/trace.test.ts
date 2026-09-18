import { describe, expect, it } from "vitest";
import { parseTrace } from "../src/trace";

describe("parseTrace", () => {
  it("normalizes Codex messages and tool activity", () => {
    const result = parseTrace("codex", [
      { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "s1", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] } },
      { type: "response_item", payload: { type: "function_call", id: "c1", name: "shell", arguments: "{\"cmd\":\"pwd\"}" } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "/repo" } },
    ].map(value => JSON.stringify(value)).join("\n"));
    expect(result.map(item => item.type)).toEqual(["metadata", "user_message", "tool_call", "tool_result"]);
    expect(result[2]?.title).toBe("shell");
  });

  it("normalizes Claude content blocks", () => {
    const result = parseTrace("claude", JSON.stringify({ type: "assistant", uuid: "a1", message: { role: "assistant", content: [
      { type: "thinking", thinking: "inspect" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "x.ts" } }, { type: "text", text: "done" },
    ] } }));
    expect(result.map(item => item.type)).toEqual(["reasoning", "tool_call", "assistant_message"]);
  });

  it("normalizes Pi tree entries", () => {
    const result = parseTrace("pi", [
      { type: "session", version: 3, id: "p1", cwd: "/repo" },
      { type: "message", id: "m1", parentId: null, message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
      { type: "compaction", id: "m2", parentId: "m1", summary: "earlier work" },
    ].map(value => JSON.stringify(value)).join("\n"));
    expect(result.map(item => item.type)).toEqual(["metadata", "assistant_message", "compaction"]);
    expect(result[2]?.parentId).toBe("m1");
  });

  it("bounds previews and keeps parsing malformed records", () => {
    const result = parseTrace("pi", `{bad}\n${JSON.stringify({ type: "message", id: "m", message: { role: "user", content: "x".repeat(40_000) } })}`);
    expect(result[0]?.type).toBe("warning");
    expect(result[1]?.preview.length).toBeLessThan(33_000);
  });
});

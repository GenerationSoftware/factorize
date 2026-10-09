import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_STREAM_HARNESS } from "../src/claude-stream";
import { agentDriver } from "../src/agent-driver";
import { consumeTraceStream, parseTrace } from "../src/trace";

const fixture = (name: string) => readFile(new URL(`./fixtures/claude-2.1.293/${name}.jsonl`, import.meta.url), "utf8");
async function harness(input: string, code = 0) {
  const directory = await mkdtemp(join(tmpdir(), "claude-stream-")), path = join(directory, "trace.jsonl");
  try {
    // A fake CLI exercises the exact guest wrapper, byte framing, stdout/stderr and exit behavior.
    const child = spawn("python3", ["-u", "-c", CLAUDE_STREAM_HARNESS, path, "python3", "-u", "-c", `import sys\nsys.stdout.buffer.write(sys.stdin.buffer.read())\nsys.stderr.write('diagnostic stderr')\nsys.exit(${code})`]);
    child.stdin.end(input);
    let stderr = "", stdout = "";
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.stdout.on("data", bytes => { stdout += bytes; });
    const exit = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    const jsonl = await readFile(path, "utf8");
    return { exit, stderr, stdout, jsonl, events: parseTrace("claude", jsonl, "execution_stream") };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("Claude Code 2.1.293 stream-json boundary", () => {
  it("declares a primary stream with native recovery and no forwarded or partial duplicates", () => {
    const launch = agentDriver("claude").launch("run-1", { model: "sonnet", effort: "high" });
    expect(launch.args).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--verbose", "--model", "sonnet", "--effort", "high"]));
    expect(launch.args).not.toContain("--forward-subagent-text");
    expect(launch.args).not.toContain("--include-partial-messages");
    expect(launch.args).not.toContain("--json-schema");
    expect(launch.traceSources?.primary).toMatchObject({ kind: "execution_stream", formatVersion: "1", provider: "claude" });
    expect(launch.traceSources?.nativeSession?.kind).toBe("native_session");
  });
  it("projects calls/results, thinking, lifecycle and usage and reconciles identically", async () => {
    const result = await harness(await fixture("stream"));
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("diagnostic stderr");
    expect(result.events.filter(event => event.type === "tool_call").map(event => event.id)).toEqual(["tool-bash", "tool-agent"]);
    expect(result.events.filter(event => event.type === "tool_result")).toMatchObject([
      { title: "Bash", parentId: "tool-bash", display: { isError: false } },
      { title: "Agent", parentId: "tool-agent", display: { isError: true } },
    ]);
    expect(result.events.filter(event => event.preview === "Done")).toHaveLength(1);
    expect(result.events.some(event => event.type === "reasoning")).toBe(true);
    expect(result.events.filter(event => event.type === "usage")).toHaveLength(3);
    const bytes = new TextEncoder().encode(result.jsonl), live: any[] = [];
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    await consumeTraceStream("claude", stream, async batch => { live.push(...batch); }, 1, "execution_stream");
    expect(live).toEqual(result.events);
    expect(parseTrace("claude", result.jsonl, "execution_stream")).toEqual(result.events);
  });
  it("makes unknown, malformed, abort, result errors and incomplete records diagnosable", async () => {
    const input = 'null\n{"type":"new_event"}\nnot json\n{"type":"abort"}\n{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["failed"]}\n{"type":"assistant"';
    const result = await harness(input, 7);
    expect(result.exit).toBe(7);
    expect(result.events.map(event => event.type)).toEqual(["warning", "warning", "warning", "error", "error", "warning", "error"]);
    expect(result.events.some(event => event.preview.includes("Unterminated JSONL"))).toBe(true);
  });
  it("retains nested parents defensively without enabling forwarding", async () => {
    const result = await harness('{"type":"assistant","uuid":"nested","parent_tool_use_id":"tool-agent","message":{"content":[{"type":"text","text":"Child"}]}}\n');
    expect(result.events[0]).toMatchObject({ parentId: "tool-agent", preview: "Child" });
  });
  it("shows a tool result while the producing CLI is still running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-live-")), path = join(directory, "trace.jsonl");
    const input = (await fixture("stream")).split("\n").slice(0, 3).join("\n") + "\n";
    const child = spawn("python3", ["-u", "-c", CLAUDE_STREAM_HARNESS, path, "python3", "-u", "-c", `import sys\nsys.stdout.write(${JSON.stringify(input)})\nsys.stdout.flush()\nsys.stdin.read()`]);
    const closed = new Promise(resolve => child.on("close", resolve));
    try {
      let events: ReturnType<typeof parseTrace> = [];
      for (let i = 0; i < 100; i++) {
        try { events = parseTrace("claude", await readFile(path, "utf8"), "execution_stream"); } catch { /* File/record may still be arriving. */ }
        if (events.some(event => event.type === "tool_result")) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(child.exitCode).toBeNull();
      expect(events.some(event => event.type === "tool_result")).toBe(true);
    } finally { child.stdin.end(); await closed; await rm(directory, { recursive: true, force: true }); }
  });
  it("bounds oversized records and display data without rejecting the stream", async () => {
    const huge = "x".repeat(16 * 1024 * 1024 + 1);
    const result = await harness(huge + "\n" + JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "big-tool", name: "Bash", input: { command: "x".repeat(1024 * 1024) } }] } }) + "\n");
    expect(result.events[0]).toMatchObject({ type: "warning", title: "Oversized Claude stream record" });
    expect(result.events[1]).toMatchObject({ id: "big-tool", display: { truncated: true } });
    expect(result.events[1].preview.length).toBeLessThan(33000);
  });
  it("records spawn failures and forwards interruption with a nonzero exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-signal-")), path = join(directory, "trace.jsonl");
    try {
      const failed = spawnSync("python3", ["-u", "-c", CLAUDE_STREAM_HARNESS, path, "/missing-factorize-claude"], { encoding: "utf8" });
      expect(failed.status).toBe(127);
      expect(parseTrace("claude", await readFile(path, "utf8"), "execution_stream")[0].title).toBe("Claude launch failed");
      await rm(path);
      const child = spawn("python3", ["-u", "-c", CLAUDE_STREAM_HARNESS, path, "python3", "-u", "-c", `import sys\nsys.stdout.write('{"type":"system","subtype":"init"}\\n')\nsys.stdout.flush()\nsys.stdin.read()`]);
      const closed = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          try { ready = (await readFile(path, "utf8")).includes("init"); } catch { /* Wait for init. */ }
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(ready).toBe(true);
        child.kill("SIGTERM");
        expect(await closed).toBe(143);
        expect(parseTrace("claude", await readFile(path, "utf8"), "execution_stream")).toMatchObject([
          { type: "metadata" }, { type: "error", title: "Claude interrupted" }, { type: "error", title: "Claude process exited" },
        ]);
      } finally { child.stdin.end(); child.kill(); await closed; }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("parses native fallback tools and preserves IDs and errors across chunks", async () => {
    const input = await fixture("native"), expected = parseTrace("claude", input);
    expect(expected).toMatchObject([{ id: "native-bash", title: "Bash", type: "tool_call" }, { parentId: "native-bash", title: "Bash", type: "tool_result", display: { isError: true } }]);
    const events: any[] = [];
    await consumeTraceStream("claude", new Response(input).body!, async batch => { events.push(...batch); }, 1);
    expect(events).toEqual(expected);
  });
});

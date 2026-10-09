import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { ExeVmBackend } from "../src/exe-vm-backend";
import type { TraceSource } from "../src/trace-source";

afterEach(() => vi.unstubAllGlobals());

it("tails the declared stream before exit, resumes by offset, and detects truncation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "factorize-trace-"));
  const path = join(directory, "stream.jsonl"), captured = join(directory, "captured"), headers = join(directory, "headers");
  try {
    writeFileSync(path, '{"version":1}\n');
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      // Exercise the exact generated guest command, replacing only transport/upload.
      const shim = `ssh() { bash -c "$2"; }; export -f curl; curl() { printf '%s\\n' "$@" > '${headers}'; for arg in "$@"; do case "$arg" in @*) cat "\${arg#@}" > '${captured}';; esac; done; }; export -f curl;`;
      const result = spawnSync("bash", ["-c", shim + String(init.body)], { encoding: "utf8" });
      return new Response(result.stdout + result.stderr, { headers: { "X-Exe-Exit": String(result.status) } });
    }));
    const source: TraceSource = { kind: "execution_stream", path, mediaType: "application/x-ndjson", provider: "codex" };
    const backend = new ExeVmBackend({ apiToken: "test", tags: [] }), handle = { backendKind: "exe-vm", id: "factorize-test" };
    const request = { source, uploadUrl: "https://app.example/chunk", generation: null as string | null, offset: 0, previousHash: "0".repeat(64) };
    expect((await backend.collectTraceChunk(handle, request)).ok).toBe(true);
    expect(readFileSync(captured, "utf8")).toBe('{"version":1}\n');
    request.generation = readFileSync(headers, "utf8").match(/X-Trace-Generation: ([^\n]+)/)![1];
    request.offset = readFileSync(path).length;
    appendFileSync(path, '{"version":2}\n');
    expect((await backend.collectTraceChunk(handle, request)).ok).toBe(true);
    expect(readFileSync(captured, "utf8")).toBe('{"version":2}\n');
    writeFileSync(path, '{}\n');
    expect((await backend.collectTraceChunk(handle, request)).ok).toBe(true);
    expect(readFileSync(headers, "utf8")).toContain("X-Trace-Start: 0");
    expect(readFileSync(captured, "utf8")).toBe('{}\n');
    const generation = readFileSync(headers, "utf8").match(/X-Trace-Generation: ([^\n]+)/)![1];
    expect(generation).not.toBe(request.generation);
    request.generation = generation;
    request.offset = 3;
    appendFileSync(path, '{}\n');
    expect((await backend.collectTraceChunk(handle, request)).ok).toBe(true);
    expect(readFileSync(headers, "utf8")).toContain(`X-Trace-Generation: ${generation}`);
    expect(readFileSync(headers, "utf8")).toContain("X-Trace-Start: 3");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createFlyGuestTransport, FlyGuestError } from "../src/fly-guest-transport.js";

function fixture(handler: (args: string[]) => Promise<{ code: number | null; stdout?: string; stderr?: string }>) {
  const calls: { executable: string; args: string[]; env: NodeJS.ProcessEnv; stdin: Buffer }[] = [];
  const spawnProcess = ((executable: string, args: string[], options: any) => {
    const call = { executable, args: [...args], env: options.env, stdin: Buffer.alloc(0) };
    calls.push(call);
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on("data", (chunk: Buffer) => { call.stdin = Buffer.concat([call.stdin, chunk]); });
    child.kill = () => { queueMicrotask(() => child.emit("close", null)); return true; };
    void handler(args).then(result => {
      if (result.stdout) child.stdout.write(result.stdout);
      if (result.stderr) child.stderr.write(result.stderr);
      queueMicrotask(() => child.emit("close", result.code));
    });
    return child;
  }) as any;
  return { calls, spawnProcess };
}

const base = { app: "fixture-app", machine: "machine-1", token: "redacted-test-token", timeoutMs: 1000, outputLimitBytes: 128, fileLimitBytes: 1024 };

describe("Fly guest command and file transport", () => {
  it("passes arguments literally and returns a nonzero process exit", async () => {
    const f = fixture(async () => ({ code: 17, stdout: "guest output", stderr: "guest error" }));
    const transport = createFlyGuestTransport({ ...base, spawnProcess: f.spawnProcess });
    const result = await transport.run(["printf", "%s", "$(touch /tmp/not-run); ' quote"], "prompt bytes");
    expect(result).toEqual({ ok: false, exitCode: 17, stdout: "guest output", stderr: "guest error" });
    expect(f.calls[0].args).toEqual(["machine", "exec", "machine-1", "--app", "fixture-app", "--no-container", "--timeout", "1", "--", "printf", "%s", "$(touch /tmp/not-run); ' quote"]);
    expect(f.calls[0].env.FLY_API_TOKEN).toBe(base.token);
    expect(f.calls[0].stdin.toString()).toBe("prompt bytes");
  });

  it("bounds the operation deadline and captured output", async () => {
    const hanging = fixture(() => new Promise(() => undefined));
    const transport = createFlyGuestTransport({ ...base, timeoutMs: 15, spawnProcess: hanging.spawnProcess });
    await expect(transport.run(["sleep", "forever"])).rejects.toMatchObject({ kind: "timeout" });

    const noisy = fixture(async () => ({ code: 0, stdout: "x".repeat(129) }));
    await expect(createFlyGuestTransport({ ...base, spawnProcess: noisy.spawnProcess }).run(["emit"])).rejects.toMatchObject({ kind: "output_limit" });
  });

  it("reports a disconnected guest transport distinctly", async () => {
    const f = fixture(async () => ({ code: null }));
    await expect(createFlyGuestTransport({ ...base, spawnProcess: f.spawnProcess }).run(["true"])).rejects.toMatchObject({ kind: "disconnect" });
  });

  it("uploads and downloads bytes through SFTP argv without shell interpolation", async () => {
    let uploaded = new Uint8Array();
    const downloaded = Buffer.from([0, 1, 2, 255]);
    const f = fixture(async args => {
      const mode = args[1];
      if (mode === "put") uploaded = new Uint8Array(await readFile(args[2]));
      if (mode === "get") await writeFile(args[3], downloaded);
      return { code: 0 };
    });
    const transport = createFlyGuestTransport({ ...base, spawnProcess: f.spawnProcess });
    await transport.upload("/tmp/file;$(id)", new Uint8Array([3, 4, 5]));
    expect([...uploaded]).toEqual([3, 4, 5]);
    expect(f.calls[0].args.slice(0, 2)).toEqual(["sftp", "put"]);
    expect(f.calls[0].args[3]).toBe("/tmp/file;$(id)");
    expect([...await transport.download("/tmp/result")]).toEqual([0, 1, 2, 255]);
    expect(f.calls[1].args.slice(0, 3)).toEqual(["sftp", "get", "/tmp/result"]);
  });

  it("rejects unsafe guest paths and oversized transfers", async () => {
    const f = fixture(async () => ({ code: 0 }));
    const transport = createFlyGuestTransport({ ...base, spawnProcess: f.spawnProcess });
    await expect(transport.download("/tmp/../secret")).rejects.toThrow();
    await expect(transport.upload("relative", new Uint8Array())).rejects.toThrow();
    await expect(transport.upload("/tmp/large", new Uint8Array(1025))).rejects.toMatchObject({ kind: "file_limit" } satisfies Partial<FlyGuestError>);
    expect(f.calls).toHaveLength(0);
    expect(() => createFlyGuestTransport({ ...base, timeoutMs: 10 * 60_000 + 1 })).toThrow(/10 minutes/);
    expect(() => createFlyGuestTransport({ ...base, outputLimitBytes: 16 * 1024 * 1024 + 1 })).toThrow(/supported bounds/);
  });
});

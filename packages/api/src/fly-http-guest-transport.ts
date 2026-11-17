import { Buffer } from "node:buffer";
import type { JobGuest } from "./machine-job-execution-backend";

type Options = {app: string; machine: string; token: string; apiOrigin?: string; fetcher?: typeof fetch; timeoutMs?: number; outputLimitBytes?: number; fileLimitBytes?: number};
function path(value: string): string {
  if (!value.startsWith("/") || /[\r\n\0]/.test(value) || value.split("/").some(part => part === "." || part === "..")) throw new TypeError("Invalid guest file path");
  return value;
}
function failure(): Error { return new Error("Fly guest HTTP transport unavailable"); }

/** Worker-compatible guest transport using the documented Machines exec API,
 * including stdin. No host CLI, subprocess, filesystem or credential-bearing
 * argv is required in the Factorize backend. */
export function createFlyHttpGuestTransport(options: Options): Required<JobGuest> {
  if (!/^[a-z0-9-]+$/.test(options.app) || !/^[A-Za-z0-9-]+$/.test(options.machine) || !options.token) throw new TypeError("Invalid Fly guest identity");
  const origin = options.apiOrigin ?? "https://api.machines.dev";
  const timeoutMs = options.timeoutMs ?? 30_000, outputLimit = options.outputLimitBytes ?? 64 * 1024, fileLimit = options.fileLimitBytes ?? 16 * 1024 * 1024;
  if (new URL(origin).origin !== origin || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000
      || !Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 16 * 1024 * 1024
      || !Number.isSafeInteger(fileLimit) || fileLimit < 1 || fileLimit > 64 * 1024 * 1024) throw new TypeError("Invalid Fly guest transport limits");
  async function execute(command: readonly string[], input: string | Uint8Array | undefined, limit: number) {
    if (!command.length || command.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("Invalid Fly guest command");
    const stdin = typeof input === "string" || input === undefined ? input : new TextDecoder("utf8", {fatal: true}).decode(input);
    try {
      const response = await (options.fetcher ?? fetch)(`${origin}/v1/apps/${encodeURIComponent(options.app)}/machines/${encodeURIComponent(options.machine)}/exec`, {
        method: "POST", headers: {Authorization: `Bearer ${options.token}`, "Content-Type": "application/json", Accept: "application/json"},
        body: JSON.stringify({command, ...(stdin !== undefined ? {stdin} : {}), timeout: Math.max(1, Math.ceil(timeoutMs/1000))}),
        redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.byteLength;
        // JSON can escape each output byte as six characters.
        if (size > limit * 6 + 65_536) { await reader.cancel(); throw failure(); }
        chunks.push(value);
      }
      const data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}
      const result = JSON.parse(new TextDecoder().decode(data));
      if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || !Number.isInteger(result.exit_code)
          || new TextEncoder().encode(result.stdout).byteLength + new TextEncoder().encode(result.stderr).byteLength > limit) throw failure();
      return {ok: result.exit_code === 0, exitCode: result.exit_code as number, stdout: result.stdout as string, stderr: result.stderr as string};
    } catch { throw failure(); }
  }
  return {
    run: (command, input) => execute(command, input, outputLimit),
    async upload(remotePath, bytes) {
      remotePath = path(remotePath);
      if (bytes.byteLength > fileLimit) throw new Error("Fly guest upload exceeds its limit");
      const result = await execute(["/bin/sh", "-c", 'umask 077; base64 -d > "$1"', "factorize-upload", remotePath], Buffer.from(bytes).toString("base64"), outputLimit);
      if (!result.ok) throw failure();
    },
    async download(remotePath) {
      remotePath = path(remotePath);
      const result = await execute(["python3", "-c", "import base64,sys; data=open(sys.argv[1],'rb').read(int(sys.argv[2])+1); sys.exit(3) if len(data)>int(sys.argv[2]) else sys.stdout.write(base64.b64encode(data).decode('ascii'))", remotePath, String(fileLimit)], undefined, Math.ceil(fileLimit*4/3)+1024);
      if (!result.ok || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.stdout)) throw failure();
      const bytes = Uint8Array.from(atob(result.stdout), c => c.charCodeAt(0));
      if (bytes.byteLength > fileLimit) throw failure();
      return bytes;
    },
  };
}

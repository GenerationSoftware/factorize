import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type FlyGuestErrorKind = "timeout" | "output_limit" | "disconnect" | "transport" | "file_limit";

/** Sanitized transport errors never include CLI output, command arguments, or credentials. */
export class FlyGuestError extends Error {
  constructor(readonly kind: FlyGuestErrorKind) {
    super(`Fly guest transport ${kind.replace("_", " ")}`);
    this.name = "FlyGuestError";
  }
}

export type FlyGuestCommandResult = { ok: boolean; exitCode: number; stdout: string; stderr: string };
export type FlyGuestTransportOptions = {
  app: string;
  machine: string;
  token: string;
  cliPath?: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
  fileLimitBytes?: number;
  /** Subprocess injection is used by deterministic local protocol fixtures. */
  spawnProcess?: typeof spawn;
};

function pathSegment(value: string, name: string): string {
  if (!value || value === "." || value === ".." || /[\0/\r\n]/.test(value)) throw new TypeError(`${name} must be a path segment`);
  return value;
}

function guestPath(value: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.includes("\r") || value.includes("\n") || value.split("/").some(part => part === "." || part === "..")) {
    throw new TypeError("Guest file path must be absolute and normalized");
  }
  return value;
}

export function createFlyGuestTransport(options: FlyGuestTransportOptions) {
  pathSegment(options.app, "app");
  pathSegment(options.machine, "machine");
  if (!options.token) throw new TypeError("Fly token is required");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const outputLimitBytes = options.outputLimitBytes ?? 1024 * 1024;
  const fileLimitBytes = options.fileLimitBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) throw new TypeError("timeoutMs must be between 1ms and 10 minutes");
  if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1 || outputLimitBytes > 16 * 1024 * 1024 || !Number.isSafeInteger(fileLimitBytes) || fileLimitBytes < 1 || fileLimitBytes > 64 * 1024 * 1024) throw new TypeError("transport limits exceed the supported bounds");
  const spawnProcess = options.spawnProcess ?? spawn;
  const base = ["--app", options.app, "--machine", options.machine];

  async function invoke(args: string[], limit = outputLimitBytes, input?: string | Uint8Array): Promise<FlyGuestCommandResult> {
    return new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), settled = false, exceeded = false;
      const child = spawnProcess(options.cliPath ?? "fly", args, { env: { ...process.env, FLY_API_TOKEN: options.token }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      const killTree = () => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { child.kill("SIGKILL"); }
      };
      const finishError = (error: FlyGuestError) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        killTree();
        reject(error);
      };
      const collect = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = limit - stdout.byteLength - stderr.byteLength;
        if (chunk.byteLength > remaining) {
          exceeded = true;
          return Buffer.concat([current, chunk.subarray(0, Math.max(0, remaining))]);
        }
        return Buffer.concat([current, chunk]);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); if (exceeded) finishError(new FlyGuestError("output_limit")); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); if (exceeded) finishError(new FlyGuestError("output_limit")); });
      child.on("error", () => finishError(new FlyGuestError("transport")));
      const deadline = setTimeout(() => finishError(new FlyGuestError("timeout")), timeoutMs);
      child.stdin.end(input);
      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (code === null) return reject(new FlyGuestError("disconnect"));
        resolve({ ok: code === 0, exitCode: code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") });
      });
    });
  }

  return {
    /** Arguments are passed as an argv vector after `--`; no shell parses guest input. */
    run(command: readonly string[], input?: string | Uint8Array): Promise<FlyGuestCommandResult> {
      if (!command.length || command.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("Guest command must contain valid arguments");
      return invoke(["machine", "exec", options.machine, "--app", options.app, "--no-container", "--timeout", String(Math.max(1, Math.ceil(timeoutMs / 1000))), "--", ...command], outputLimitBytes, input);
    },
    async upload(remotePath: string, bytes: Uint8Array): Promise<void> {
      remotePath = guestPath(remotePath);
      if (bytes.byteLength > fileLimitBytes) throw new FlyGuestError("file_limit");
      const directory = await mkdtemp(join(tmpdir(), "factorize-fly-upload-"));
      const localPath = join(directory, "payload");
      try {
        await writeFile(localPath, bytes, { mode: 0o600 });
        const result = await invoke(["sftp", "put", localPath, remotePath, ...base, "--no-container", "--user", "root"], 64 * 1024);
        if (!result.ok) throw new FlyGuestError("transport");
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async download(remotePath: string): Promise<Uint8Array> {
      remotePath = guestPath(remotePath);
      const directory = await mkdtemp(join(tmpdir(), "factorize-fly-download-"));
      const localPath = join(directory, "payload");
      try {
        const result = await invoke(["sftp", "get", remotePath, localPath, ...base, "--no-container", "--user", "root"], 64 * 1024);
        if (!result.ok) throw new FlyGuestError("transport");
        const size = (await stat(localPath)).size;
        if (size > fileLimitBytes) throw new FlyGuestError("file_limit");
        return new Uint8Array(await readFile(localPath));
      } catch (error) {
        if (error instanceof FlyGuestError) throw error;
        throw new FlyGuestError("transport");
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

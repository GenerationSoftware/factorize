import { createServer } from "node:http";
import { spawn } from "node:child_process";
import process from "node:process";

const signalNumber = (signal) => ({
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
})[signal] ?? 1;

function signalTree(child, signal) {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

/** Run a subprocess with a deadline, abort support, and process-group cleanup. */
export function runProcess(command, args = [], {
  timeoutMs,
  signal,
  cwd,
  env = process.env,
  onSpawn,
  onOutput,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let cause;
    let forceKill;
    let finished = false;
    let childError;
    let closed;

    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };
    const terminate = (reason) => {
      if (cause) return;
      cause = reason;
      signalTree(child, "SIGTERM");
      forceKill = setTimeout(() => {
        try { signalTree(child, "SIGKILL"); } catch (error) { childError ??= error; }
        forceKill = undefined;
        if (closed) complete();
      }, 500);
    };
    const abort = () => terminate(signal.reason || "SIGTERM");
    const deadline = setTimeout(() => terminate("timeout"), timeoutMs);

    child.stdout.on("data", (chunk) => onOutput?.("stdout", chunk));
    child.stderr.on("data", (chunk) => onOutput?.("stderr", chunk));
    child.once("spawn", () => {
      onSpawn?.(child);
      if (signal?.aborted) abort();
    });
    child.once("error", (error) => { childError = error; });
    const complete = () => {
      if (!closed) return;
      const { code, signal: childSignal } = closed;
      if (cause === "timeout") finish({ code: 124, signal: childSignal, timedOut: true, error: childError });
      else if (cause) finish({ code: 128 + signalNumber(cause), signal: cause, aborted: true, error: childError });
      else finish({ code: childError ? 127 : (code ?? 1), signal: childSignal, error: childError });
    };
    child.once("close", (code, childSignal) => {
      closed = { code, signal: childSignal };
      if (!forceKill) complete();
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Bind a local HTTP server to an OS-selected port for isolated tests. */
export async function createEphemeralHttpServer(handler, host = "127.0.0.1") {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine ephemeral server port");
  return {
    server,
    port: address.port,
    origin: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

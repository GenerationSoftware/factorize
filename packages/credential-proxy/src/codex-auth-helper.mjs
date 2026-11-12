import { mkdir, lstat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { spawn as spawnDefault } from "node:child_process";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PINNED_VERSION = "codex-cli 0.167.1";
const METHODS = new Set(["device-login", "account-status", "refresh", "cancel", "logout"]);

function accountHome(root, accountId) {
  if (typeof accountId !== "string" || !UUID.test(accountId)) throw new TypeError("invalid model account id");
  const base = resolve(root);
  const home = resolve(base, accountId);
  if (!home.startsWith(`${base}${sep}`)) throw new TypeError("invalid model account id");
  return { base, home };
}

/**
 * Narrow in-process adapter for Codex authentication commands. Callers must
 * keep this object on the proxy's private control channel; it is not a job API.
 * Each account gets its own normal Codex credential home.
 */
export function createCodexAuthHelper({
  codexPath = "/usr/local/bin/codex",
  accountHomeRoot = "/var/lib/factorize/codex-accounts",
  spawnProcess = spawnDefault,
  expectedVersion = PINNED_VERSION,
} = {}) {
  const logins = new Map();

  async function prepareHome(accountId) {
    const { base, home } = accountHome(accountHomeRoot, accountId);
    await mkdir(base, { recursive: true, mode: 0o700 });
    await mkdir(home, { recursive: true, mode: 0o700 });
    const stat = await lstat(home);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Codex account home is not a private directory");
    return home;
  }

  function run(accountId, args, { timeoutMs = 10_000, input, onStdout } = {}) {
    return prepareHome(accountId).then(home => new Promise((resolveRun, rejectRun) => {
      let stdout = "", stderr = "", settled = false;
      const child = spawnProcess(codexPath, args, {
        env: { PATH: process.env.PATH ?? "", CODEX_HOME: home, HOME: home },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectRun(error);
        else resolveRun(result);
      };
      const collect = (current, chunk, limit) => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next) > limit) {
          child.kill("SIGTERM");
          finish(new Error("Codex authentication helper output exceeded its limit"));
          return current;
        }
        return next;
      };
      child.stdout.on("data", chunk => {
        stdout = collect(stdout, chunk, 16_384);
        if (!settled) onStdout?.(chunk.toString("utf8"));
      });
      child.stderr.on("data", chunk => { stderr = collect(stderr, chunk, 16_384); });
      child.once("error", () => finish(new Error("Codex authentication helper could not start")));
      child.once("close", (code, signal) => {
        if (code === 0) finish(null, { code, stdout, stderr });
        else finish(new Error(signal ? `Codex authentication helper stopped (${signal})` : `Codex authentication helper failed (${code ?? "unknown"})`));
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("Codex authentication helper timed out"));
      }, timeoutMs);
      timer.unref?.();
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
      return child;
    }));
  }

  async function checkVersion(accountId) {
    // `--version` is the only non-authentication command accepted by this helper.
    const result = await run(accountId, ["--version"]);
    if (result.stdout.trim() !== expectedVersion) throw new Error("Unsupported Codex version for model account authentication");
  }

  async function invoke(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)
      || !METHODS.has(request.method) || Object.keys(request).some(key => !["method", "accountId"].includes(key))) {
      throw new TypeError("unsupported Codex authentication operation");
    }
    const { accountId } = request;
    accountHome(accountHomeRoot, accountId);
    await checkVersion(accountId);
    if (request.method === "device-login") {
      if (logins.has(accountId)) throw new Error("device authorization is already running for this account");
      const home = await prepareHome(accountId);
      let child;
      const challenge = {};
      const completion = new Promise((resolveRun, rejectRun) => {
        child = spawnProcess(codexPath, ["login", "--device-auth"], {
          env: { PATH: process.env.PATH ?? "", CODEX_HOME: home, HOME: home },
          stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        });
        let stdout = "";
        const timer = setTimeout(() => { child.kill("SIGTERM"); rejectRun(new Error("Codex device authorization timed out")); }, 15 * 60_000);
        timer.unref?.();
        child.stdout.on("data", chunk => {
          stdout = (stdout + chunk.toString("utf8")).slice(-16_384);
          const url = stdout.match(/https:\/\/auth\.openai\.com\/codex\/device(?:\b|\/)/u)?.[0];
          const code = stdout.match(/\b(?:user\s+)?code\s*:\s*([A-Z0-9]{4,6}-[A-Z0-9]{4,6}|[A-Z0-9]{8,12})\b/iu)?.[1];
          if (url) challenge.verificationUrl = "https://auth.openai.com/codex/device";
          if (code) challenge.userCode = code.toUpperCase();
        });
        child.stderr.on("data", chunk => {
          // Retain no provider error text, which could include device details.
          if (chunk.byteLength > 16_384) child.kill("SIGTERM");
        });
        child.once("error", () => { clearTimeout(timer); rejectRun(new Error("Codex authentication helper could not start")); });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (code === 0) resolveRun({ state: "authorized", output: stdout });
          else rejectRun(new Error(signal ? `Codex device authorization stopped (${signal})` : `Codex device authorization failed (${code ?? "unknown"})`));
        });
      });
      const entry = { child, completion };
      logins.set(accountId, entry);
      completion.finally(() => { if (logins.get(accountId) === entry) logins.delete(accountId); }).catch(() => {});
      return { state: "pending", challenge, completion };
    }
    if (request.method === "cancel") {
      const login = logins.get(accountId);
      if (!login) return { state: "idle" };
      login.child.kill("SIGTERM");
      logins.delete(accountId);
      return { state: "canceled" };
    }
    if (request.method === "logout") {
      const login = logins.get(accountId);
      if (login) {
        login.child.kill("SIGTERM");
        logins.delete(accountId);
      }
      await run(accountId, ["logout"]);
      return { state: "logged-out" };
    }
    if (request.method === "account-status") {
      const result = await run(accountId, ["login", "status"]);
      return { state: result.stdout.trim() ? "authenticated" : "unauthenticated" };
    }
    // Codex owns refresh semantics in its authentication manager. A status call
    // exercises that manager without opening the agent command surface.
    const result = await run(accountId, ["login", "status"]);
    return { state: result.stdout.trim() ? "refreshed" : "reauthentication-required" };
  }

  return Object.freeze({ invoke });
}

export { PINNED_VERSION as CODEX_AUTH_HELPER_VERSION };

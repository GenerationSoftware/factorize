import { spawn } from "node:child_process";
import type { JobMachines, JobGuest } from "./machine-job-execution-backend";

/** Host-only test infrastructure. Never import this module into a Worker runner. */
export function createDockerJobInfrastructure(options: { testMode: true; network: string; namespace: string; additionalNetworks?: string[]; mounts?: { source: string; target: string }[]; publishBrowserPort?: boolean; beforeDestroy?: (id: string) => Promise<void>; observeGuestInput?: (command: readonly string[], input?: string | Uint8Array) => void }) {
  if (options.testMode !== true || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.namespace)
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(options.network)) {
    throw new TypeError("Explicit test mode and isolated Docker namespace/network are required");
  }
  const label = "sh.factorize.test.namespace";
  const operationLabel = "sh.factorize.test.operation";
  const limit = 16 * 1024 * 1024;
  async function invoke(args: string[], input?: string | Uint8Array) {
    return new Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let bytes = 0;
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        child.kill("SIGKILL");
        clearTimeout(timer);
        reject(new Error("Docker transport failed or exceeded its deadline/output limit"));
      };
      const timer = setTimeout(fail, 30_000);
      child.on("error", fail);
      child.stdin.on("error", () => {}); // An early guest exit may close stdin.
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
        stream.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 24 * 1024 * 1024) fail();
          else chunks.push(chunk);
        });
      }
      child.on("close", code => {
        clearTimeout(timer);
        if (failed) return;
        if (code === null) return fail();
        resolve({ ok: code === 0, exitCode: code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      child.stdin.end(input);
    });
  }
  async function checked(args: string[], input?: string | Uint8Array) {
    const result = await invoke(args, input);
    if (!result.ok) throw new Error("Docker operation failed"); // Never expose payloads or CLI diagnostics.
    return result.stdout.trim();
  }
  async function inspect(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new TypeError("Invalid Docker container identity");
    const observed = await invoke(["inspect", id]);
    if (!observed.ok) {
      // Prove absence using a successful daemon query; transport failure is not absence.
      const present = await checked(["ps", "-aq", "--no-trunc", "--filter", `id=${id}`]);
      if (!present) return { id, state: "destroyed" };
      throw new Error("Docker inspection failed");
    }
    const data = JSON.parse(observed.stdout)[0];
    if (data.Config.Labels[label] !== options.namespace) throw new Error("Container belongs to another namespace");
    return { id, config: { metadata: Object.fromEntries(Object.entries(data.Config.Labels).filter(([key]) => key.startsWith("factorize_"))) as Record<string, string> }, state: data.State.Running ? "started" : data.State.Status === "created" ? "created" : "stopped" };
  }
  const machines: JobMachines = {
    async findMachineByOperationId(_app, operationId) {
      const ids = (await checked(["ps", "-aq", "--no-trunc", "--filter", `label=${label}=${options.namespace}`, "--filter", `label=${operationLabel}=${operationId}`])).split("\n").filter(Boolean);
      if (ids.length > 1) throw new Error("Ambiguous Docker operation identity");
      return ids[0] ? inspect(ids[0]) : undefined;
    },
    async createMachine(app, config, operationId) {
      const previous = await machines.findMachineByOperationId!(app, operationId);
      if (previous) return previous;
      if (!/^[a-f0-9-]{36}$/.test(operationId) || typeof config.image !== "string") throw new TypeError("Invalid Docker operation");
      // Stable names make concurrent/ambiguous creation recoverable without duplicates.
      const extra: string[] = [];
      for (const [key, value] of Object.entries(config.metadata ?? {})) extra.push("--label", `${key}=${value}`);
      for (const [key, value] of Object.entries(config.env ?? {})) {
        if (typeof value !== "string") throw new TypeError("Invalid Docker environment");
        extra.push("--env", `${key}=${value}`);
      }
      for (const mount of options.mounts ?? []) extra.push("--mount", `type=bind,source=${mount.source},target=${mount.target},readonly`);
      if (options.publishBrowserPort) extra.push("--publish", "127.0.0.1::8080");
      const command = Array.isArray(config.cmd) ? config.cmd as string[] : ["/bin/sh", "-c", "exec sleep infinity"];
      const result = await invoke(["create", "--name", `${options.namespace}-${operationId}`,
        "--network", options.network, "--restart", "no",
        "--label", `${label}=${options.namespace}`, "--label", `${operationLabel}=${operationId}`,
        ...extra, "--entrypoint", command[0]!, config.image, ...command.slice(1)]);
      if (!result.ok) {
        const recovered = await machines.findMachineByOperationId!(app, operationId);
        if (recovered) return recovered;
        throw new Error("Docker creation failed");
      }
      const id = result.stdout.trim();
      for (const network of options.additionalNetworks ?? []) await checked(["network", "connect", network, id]);
      return inspect(id);
    },
    inspectMachine: (_app, id) => inspect(id),
    async startMachine(_app, id) { await inspect(id); await checked(["start", id]); },
    async stopMachine(_app, id) { await inspect(id); await checked(["stop", "--time", "5", id]); },
    async destroyMachine(_app, id) {
      if ((await inspect(id)).state !== "destroyed") { await options.beforeDestroy?.(id); await checked(["rm", id]); }
    },
  };
  function guest(id: string): JobGuest {
    const path = (value: string) => {
      if (!value.startsWith("/") || value.split("/").some(p => p === "." || p === "..") || /[\0\r\n]/.test(value)) throw new TypeError("Invalid guest path");
      return value;
    };
    const run: JobGuest["run"] = async (command, input) => {
      await inspect(id);
      if (!command.length || command.some(arg => arg.includes("\0"))) throw new TypeError("Invalid guest command");
      options.observeGuestInput?.(command, input);
      return invoke(["exec", "-i", "--user", "root", id, ...command], input);
    };
    return {
      run,
      async upload(destination, bytes) {
        path(destination);
        if (bytes.byteLength > limit) throw new Error("Docker file limit exceeded");
        const result = await run(["python3", "-c", "import sys; open(sys.argv[1], 'wb').write(sys.stdin.buffer.read())", destination], bytes);
        if (!result.ok) throw new Error("Docker upload failed");
      },
      async download(source) {
        path(source);
        const result = await run(["python3", "-c", "import sys,base64; f=open(sys.argv[1],'rb'); b=f.read(16777217); sys.exit(2) if len(b)>16777216 else sys.stdout.write(base64.b64encode(b).decode())", source]);
        if (!result.ok) throw new Error("Docker download failed");
        return new Uint8Array(Buffer.from(result.stdout, "base64"));
      },
    };
  }
  return { machines, guest, async address(id: string, network: string) {
    await inspect(id);
    return String(JSON.parse(await checked(["inspect", id]))[0].NetworkSettings.Networks[network].IPAddress);
  }, async browserPort(id: string) {
    await inspect(id);
    return Number(JSON.parse(await checked(["inspect", id]))[0].NetworkSettings.Ports["8080/tcp"][0].HostPort);
  } };
}

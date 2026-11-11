import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createProxyRuntime } from "./runtime.mjs";
import { registerProxyBoot } from "./control-client.mjs";
import { startProxyBootstrapControl } from "./bootstrap-control.mjs";

const epochIndex = process.argv.indexOf("--boot-epoch");
const bootEpoch = epochIndex < 0 ? randomUUID() : process.argv[epochIndex + 1];
const runtime = createProxyRuntime({ bootEpoch });
const bootstrapControl = await startProxyBootstrapControl({ runtime, socketPath: process.env.FACTORIZE_PROXY_BOOTSTRAP_SOCKET });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
let shutdownDeadline;
let controlCredential;

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function stop() {
  if (closing) return;
  closing = true;
  await runtime.shutdown();
  await bootstrapControl.close();
  lines.close();
  clearTimeout(shutdownDeadline);
  process.exit(0);
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
shutdownDeadline = setTimeout(() => process.exit(1), 2_000);
shutdownDeadline.unref();
respond({ type: "ready", state: runtime.state, bootEpoch: runtime.bootEpoch });

lines.on("line", async (line) => {
  if (closing) return;
  let command;
  try {
    command = JSON.parse(line);
    if (command?.type === "status") respond({ type: "status", state: runtime.state });
    else if (command?.type === "unlock") {
      runtime.unlock(command.key);
      respond({ type: "status", state: runtime.state });
    } else if (command?.type === "lock") {
      await runtime.lock();
      respond({ type: "status", state: runtime.state });
    } else if (command?.type === "register-boot") {
      let credential = command.credential;
      command.credential = undefined;
      try {
        const registration = await registerProxyBoot({ controlOrigin: command.controlOrigin, token: credential, bootEpoch: runtime.bootEpoch });
        controlCredential = registration.controlCredential;
        respond({ type: "boot-registered", proxyIdentity: registration.proxyIdentity, bootEpoch: registration.bootEpoch });
      } catch {
        respond({ type: "error", error: "proxy boot registration failed" });
      } finally { credential = ""; }
    } else if (command?.type === "stop") stop();
    else respond({ type: "error", error: "unsupported command" });
  } catch {
    respond({ type: "error", error: "invalid command" });
  }
});

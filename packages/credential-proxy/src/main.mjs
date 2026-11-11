import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createProxyRuntime } from "./runtime.mjs";
import { registerProxyBoot, startProxyRunRevocationMonitor } from "./control-client.mjs";
import { startProxyBootstrapControl } from "./bootstrap-control.mjs";
import { createProxyIntegrationGrantResolver } from "./decrypted-grants.mjs";
import { startAuthenticatedProxyTunnel } from "./tunnel-transport.mjs";
import { createProxyTlsAuthority } from "./tls-identity.mjs";

const epochIndex = process.argv.indexOf("--boot-epoch");
const bootEpoch = epochIndex < 0 ? randomUUID() : process.argv[epochIndex + 1];
const runtime = createProxyRuntime({ bootEpoch });
const tunnelPort = Number(process.env.FACTORIZE_PROXY_TUNNEL_PORT ?? "9090");
if (!Number.isInteger(tunnelPort) || tunnelPort < 1 || tunnelPort > 65535) throw new Error("invalid proxy tunnel port");
const tlsAuthority = await createProxyTlsAuthority({
  serverName: process.env.FACTORIZE_PROXY_TUNNEL_SERVER_NAME ?? "localhost",
  bootEpoch: runtime.bootEpoch,
});
let controlCredential;
let controlOrigin;
let tunnel;
let revocationMonitor;

async function activateRegistration(registration, origin) {
  if (tunnel) throw new Error("proxy boot is already registered");
  const resolveGrants = createProxyIntegrationGrantResolver({ runtime, controlOrigin: origin, controlCredential: registration.controlCredential });
  const started = await startAuthenticatedProxyTunnel({
    tls: tlsAuthority.tls,
    runtime,
    controlOrigin: origin,
    controlCredential: registration.controlCredential,
    resolveGrants,
    host: process.env.FACTORIZE_PROXY_TUNNEL_HOST ?? "0.0.0.0",
    port: tunnelPort,
  });
  controlCredential = registration.controlCredential;
  controlOrigin = origin;
  tunnel = started;
  revocationMonitor = startProxyRunRevocationMonitor({
    controlOrigin: origin,
    controlCredential: registration.controlCredential,
    bootEpoch: runtime.bootEpoch,
    runtime,
  });
}

const bootstrapControl = await startProxyBootstrapControl({
  runtime,
  socketPath: process.env.FACTORIZE_PROXY_BOOTSTRAP_SOCKET,
  onRegistered: (registration, request) => activateRegistration(registration, request.controlOrigin),
  issueVmCertificate: ({ vmIdentity, csr }) => {
    if (!tunnel) throw new Error("proxy tunnel is not registered");
    return tlsAuthority.signVmCsr({ vmIdentity, csr });
  },
});
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
let shutdownDeadline;

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function respondStatus() {
  respond({ type: "status", state: runtime.state, proxyControlRegistered: Boolean(controlCredential && controlOrigin) });
}

async function stop() {
  if (closing) return;
  closing = true;
  controlCredential = undefined;
  controlOrigin = undefined;
  await revocationMonitor?.close();
  revocationMonitor = undefined;
  await runtime.shutdown();
  await tunnel?.close().catch(() => {});
  tunnel = undefined;
  await tlsAuthority.close();
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
    if (command?.type === "status") respondStatus();
    else if (command?.type === "unlock") {
      runtime.unlock(command.key);
      respondStatus();
    } else if (command?.type === "lock") {
      await runtime.lock();
      respondStatus();
    } else if (command?.type === "register-boot") {
      let credential = command.credential;
      command.credential = undefined;
      try {
        const registration = await registerProxyBoot({ controlOrigin: command.controlOrigin, token: credential, bootEpoch: runtime.bootEpoch });
        await activateRegistration(registration, command.controlOrigin);
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

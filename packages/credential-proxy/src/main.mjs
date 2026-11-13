import { readFile } from "node:fs/promises";
import { createAuthenticatedProxyListener } from "./proxy-listener.mjs";
import { createBearerForwarder } from "./bearer-forwarder.mjs";
import { createTestOriginConnector } from "./destination-policy.mjs";
import { readProxyUnlockVerification, reportProxyRuntimeStatus } from "./control-client.mjs";
import { verifyProxyUnlockKey } from "./decrypted-grants.mjs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createProxyRuntime } from "./runtime.mjs";
import { registerProxyBoot, startProxyRunRevocationMonitor, startProxyRuntimeStatusReporter } from "./control-client.mjs";
import { startProxyBootstrapControl } from "./bootstrap-control.mjs";
import { createProxyIntegrationGrantResolver } from "./decrypted-grants.mjs";
import { startAuthenticatedProxyTunnel } from "./tunnel-transport.mjs";
import { createProxyTlsAuthority } from "./tls-identity.mjs";
import { createCodexAuthHelper } from "./codex-auth-helper.mjs";
import { createModelAccountLifecycle } from "./model-account-lifecycle.mjs";
import { createModelAccountPersistenceAdapter } from "./control-client.mjs";
import { decryptModelAccountCache, encryptModelAccountCache } from "./model-account-crypto.mjs";
import { startBrowserControl } from "./browser-control.mjs";
import { createProxyRunCredentialStore } from "./run-credential-store.mjs";

const epochIndex = process.argv.indexOf("--boot-epoch");
const bootEpoch = epochIndex < 0 ? randomUUID() : process.argv[epochIndex + 1];
let listenerFactory;
if (process.env.FACTORIZE_PROXY_TEST_TRANSPORT) {
  if (process.env.NODE_ENV !== "test" || process.env.FACTORIZE_PROXY_TEST_MODE !== "true") throw new Error("test transport requires explicit test environment");
  const config = JSON.parse(process.env.FACTORIZE_PROXY_TEST_TRANSPORT);
  const connectorFactory = createTestOriginConnector({ testMode: true, origin: config.origin, address: config.address, ca: await readFile(config.caFile, "utf8") });
  const forwarder = createBearerForwarder({ connectorFactory });
  listenerFactory = ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder });
}
const runtime = createProxyRuntime({ bootEpoch, ...(listenerFactory ? { listenerFactory } : {}) });
const runCredentials = createProxyRunCredentialStore();
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
let statusReporter;
let modelAccounts;
let modelAccountLifecycle;
let browserControl;

async function activateRegistration(registration, origin, browserOrigin) {
  if (tunnel) throw new Error("proxy boot is already registered");
  const persistence = createModelAccountPersistenceAdapter({
    controlOrigin: origin,
    controlCredential: registration.controlCredential,
    ownerId: registration.recordOwnerId ?? registration.tenantId,
  });
  modelAccounts = persistence;
  modelAccountLifecycle = createModelAccountLifecycle({
    authHelper: createCodexAuthHelper(),
    getUnlockKey: () => runtime.getUnlockKey(),
    getAccount: persistence.getAccount,
    getEncryptedCache: persistence.getEncryptedCache,
    persistEncrypted: persistence.persistEncrypted,
    encryptCache: encryptModelAccountCache,
    decryptCache: decryptModelAccountCache,
  });
  if (!process.env.FACTORIZE_PROXY_BROWSER_CAPABILITY_PUBLIC_KEY) throw new Error("proxy browser capability verification key is unavailable");
  browserControl = await startBrowserControl({
    runtime,
    lifecycle: modelAccountLifecycle,
    publicKey: process.env.FACTORIZE_PROXY_BROWSER_CAPABILITY_PUBLIC_KEY,
    proxyId: registration.proxyIdentity,
    ownerId: registration.tenantId,
    generation: registration.bootEpoch,
    tls: process.env.FACTORIZE_PROXY_BROWSER_TLS_CERT ? { cert: await readFile(process.env.FACTORIZE_PROXY_BROWSER_TLS_CERT), key: await readFile(process.env.FACTORIZE_PROXY_BROWSER_TLS_KEY) } : undefined,
    withLifecycleTransition: async work => {
      const resume = revocationMonitor?.suspend();
      try { return await work(); } finally { resume?.(); }
    },
    prepareUnlock: async key => {
      const verification = await readProxyUnlockVerification({ controlOrigin: origin, token: registration.controlCredential });
      await verifyProxyUnlockKey(key, verification);
      await modelAccountLifecycle.reconcileAll(await persistence.listAccounts());
    },
    reportStatus: () => reportProxyRuntimeStatus({ controlOrigin: origin, token: registration.controlCredential, bootEpoch: runtime.bootEpoch, unlocked: runtime.state === "unlocked" }),
    applyChanges: async () => { await modelAccountLifecycle.reconcileAll(await persistence.listAccounts()); },
    appOrigin: process.env.FACTORIZE_APP_ORIGIN ?? "https://app.factorize.sh",
  });
  const resolveGrants = createProxyIntegrationGrantResolver({ runtime, controlOrigin: origin, controlCredential: registration.controlCredential });
  const started = await startAuthenticatedProxyTunnel({
    tls: tlsAuthority.tls,
    runtime,
    controlOrigin: origin,
    controlCredential: registration.controlCredential,
    resolveGrants,
    resolveRunCredential: (runId, vmIdentity) => runCredentials.resolve(runId, vmIdentity),
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
    onRevoked: runId => runCredentials.revoke(runId),
  });
  statusReporter = startProxyRuntimeStatusReporter({
    controlOrigin: origin,
    token: registration.controlCredential,
    bootEpoch: runtime.bootEpoch,
    runtime,
  });
}

const bootstrapControl = await startProxyBootstrapControl({
  runtime,
  authorizeRun: input => runCredentials.authorize(input),
  socketPath: process.env.FACTORIZE_PROXY_BOOTSTRAP_SOCKET,
  onRegistered: (registration, request) => activateRegistration(registration, request.controlOrigin, request.browserOrigin),
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
  shutdownDeadline = setTimeout(() => process.exit(1), 2_000);
  shutdownDeadline.unref();
  controlCredential = undefined;
  controlOrigin = undefined;
  runCredentials.clear();
  await revocationMonitor?.close();
  revocationMonitor = undefined;
  await statusReporter?.close();
  statusReporter = undefined;
  await browserControl?.close().catch(() => {});
  browserControl = undefined;
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
respond({ type: "ready", state: runtime.state, bootEpoch: runtime.bootEpoch });

lines.on("line", async (line) => {
  if (closing) return;
  let command;
  try {
    command = JSON.parse(line);
    if (command?.type === "status") respondStatus();
    else if (command?.type === "unlock") {
      await runtime.unlockAndPrepare(command.key, async () => {
        if (modelAccountLifecycle && modelAccounts) {
          const accounts = await modelAccounts.listAccounts();
          await modelAccountLifecycle.reconcileAll(accounts);
        }
      });
      respondStatus();
    } else if (command?.type === "lock") {
      await runtime.lock();
      respondStatus();
    } else if (command?.type === "register-boot") {
      let credential = command.credential;
      command.credential = undefined;
      try {
        const registration = await registerProxyBoot({ controlOrigin: command.controlOrigin, browserOrigin: command.browserOrigin, token: credential, bootEpoch: runtime.bootEpoch });
        await activateRegistration(registration, command.controlOrigin, command.browserOrigin);
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

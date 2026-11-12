import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { connect } from "node:net";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { startProxyBootstrapControl } from "../src/bootstrap-control.mjs";

const epoch = "11111111-1111-4111-8111-111111111111";
const token = `fzc_${"a".repeat(43)}`;
let directory;
let service;
afterEach(async () => {
  await service?.close(); service = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture(register, onRegistered, issueVmCertificate) {
  directory = await mkdtemp(join(tmpdir(), "factorize-proxy-startup-"));
  const socketPath = join(directory, "control.sock");
  const runtime = { bootEpoch: epoch };
  service = await startProxyBootstrapControl({ runtime, socketPath, register, onRegistered, issueVmCertificate });
  return socketPath;
}

async function request(socketPath, payload) {
  const socket = connect(socketPath);
  let response = "";
  socket.on("data", chunk => { response += chunk.toString(); });
  await once(socket, "connect");
  socket.end(`${JSON.stringify(payload)}\n`);
  await once(socket, "close");
  return JSON.parse(response);
}

test("local startup control redeems the one-use credential and leaves a private socket", async () => {
  const calls = [];
  const registered = [];
  const socketPath = await fixture(
    async value => { calls.push(value); return { proxyIdentity: "fly:app:machine", bootEpoch: epoch, controlCredential: token }; },
    (value, request) => registered.push({ value, request }),
  );
  const result = await request(socketPath, { type: "register-boot", controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: epoch, credential: token });
  assert.deepEqual(result, { registered: true, proxyIdentity: "fly:app:machine", bootEpoch: epoch });
  assert.deepEqual(calls, [{ controlOrigin: "https://factorize.example", token, bootEpoch: epoch, browserOrigin: "https://proxy.example" }]);
  assert.deepEqual(registered, [{
    value: { proxyIdentity: "fly:app:machine", bootEpoch: epoch, controlCredential: token },
    request: { controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: epoch },
  }]);
  assert.equal(JSON.stringify(result).includes(token), false, "startup response never returns the proxy control credential");
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
});

test("local startup control rejects run credentials, epoch substitution, and extra fields", async () => {
  const calls = [];
  const socketPath = await fixture(async value => { calls.push(value); return {}; });
  for (const payload of [
    { type: "register-boot", controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: epoch, credential: `fzt_run_${"b".repeat(32)}` },
    { type: "register-boot", controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: "22222222-2222-4222-8222-222222222222", credential: token },
    { type: "register-boot", controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: epoch, credential: token, tenantId: "attacker" },
  ]) assert.deepEqual(await request(socketPath, payload), { error: "invalid bootstrap request" });
  assert.deepEqual(calls, []);
});

test("local provider channel returns only a boot-bound VM certificate and public trust bundle", async () => {
  const csr = `-----BEGIN CERTIFICATE REQUEST-----\n${"A".repeat(120)}\n-----END CERTIFICATE REQUEST-----`;
  let registered = false;
  const socketPath = await fixture(
    async () => ({ proxyIdentity: "fly:app:machine", bootEpoch: epoch, controlCredential: token }),
    async () => { registered = true; },
    async request => {
      assert.equal(registered, true);
      return { certificate: `cert-for:${request.vmIdentity}`, trustBundle: "public-ca" };
    },
  );
  const payload = { type: "issue-vm-certificate", bootEpoch: epoch, vmIdentity: "fly:job-1", csr };
  assert.deepEqual(await request(socketPath, payload), { error: "certificate provisioning failed" });
  await request(socketPath, { type: "register-boot", controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", bootEpoch: epoch, credential: token });
  assert.deepEqual(await request(socketPath, payload), {
    issued: true, bootEpoch: epoch, vmIdentity: "fly:job-1", certificate: "cert-for:fly:job-1", trustBundle: "public-ca",
  });
  assert.equal(JSON.stringify(await request(socketPath, payload)).includes(token), false);
});

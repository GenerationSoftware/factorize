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

async function fixture(register) {
  directory = await mkdtemp(join(tmpdir(), "factorize-proxy-startup-"));
  const socketPath = join(directory, "control.sock");
  const runtime = { bootEpoch: epoch };
  service = await startProxyBootstrapControl({ runtime, socketPath, register });
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
  const socketPath = await fixture(async value => { calls.push(value); return { proxyIdentity: "fly:app:machine", bootEpoch: epoch }; });
  const result = await request(socketPath, { controlOrigin: "https://factorize.example", bootEpoch: epoch, credential: token });
  assert.deepEqual(result, { registered: true, proxyIdentity: "fly:app:machine", bootEpoch: epoch });
  assert.deepEqual(calls, [{ controlOrigin: "https://factorize.example", token, bootEpoch: epoch }]);
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
});

test("local startup control rejects run credentials, epoch substitution, and extra fields", async () => {
  const calls = [];
  const socketPath = await fixture(async value => { calls.push(value); return {}; });
  for (const payload of [
    { controlOrigin: "https://factorize.example", bootEpoch: epoch, credential: `fzt_run_${"b".repeat(32)}` },
    { controlOrigin: "https://factorize.example", bootEpoch: "22222222-2222-4222-8222-222222222222", credential: token },
    { controlOrigin: "https://factorize.example", bootEpoch: epoch, credential: token, tenantId: "attacker" },
  ]) assert.deepEqual(await request(socketPath, payload), { error: "invalid bootstrap request" });
  assert.deepEqual(calls, []);
});

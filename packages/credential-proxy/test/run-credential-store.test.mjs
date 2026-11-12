import assert from "node:assert/strict";
import { test } from "node:test";
import { createProxyRunCredentialStore } from "../src/run-credential-store.mjs";

const runId = "33333333-3333-4333-8333-333333333333";
const vmIdentity = "fly:factorize-app:machine-1";
const credential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;

test("provider delivery stores a credential only for its bound run and VM in process memory", () => {
  const store = createProxyRunCredentialStore();
  assert.equal(store.authorize({ runId, vmIdentity, credential }), true);
  assert.equal(store.resolve(runId, vmIdentity), credential);
  assert.equal(store.resolve(runId, "fly:factorize-app:other-machine"), undefined);
  assert.equal(store.resolve("44444444-4444-4444-8444-444444444444", vmIdentity), undefined);
  store.clear();
  assert.equal(store.resolve(runId, vmIdentity), undefined);
});

test("revocation removes delivered credentials and permanently closes the run for this boot", () => {
  const store = createProxyRunCredentialStore();
  store.authorize({ runId, vmIdentity, credential });
  store.revoke(runId);
  assert.equal(store.resolve(runId, vmIdentity), undefined);
  assert.throws(() => store.authorize({ runId, vmIdentity, credential }), /revoked/);
});

test("rejects malformed run, VM, and scoped credential inputs", () => {
  const store = createProxyRunCredentialStore();
  for (const value of [
    { runId: "../other", vmIdentity, credential },
    { runId, vmIdentity: "bad\nidentity", credential },
    { runId, vmIdentity, credential: "fzt_run_invalid" },
  ]) assert.throws(() => store.authorize(value), /invalid run credential authorization/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelAccountLifecycle } from "../src/model-account-lifecycle.mjs";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = { id: accountId, kind: "model", ownerId: "owner", keyGeneration: "generation", revision: 4 };

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "factorize-model-account-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, accountId);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }));
  const calls = [], events = [], methods = [];
  const helper = { invoke: async request => {
    methods.push(request.method);
    if (request.method === "device-login") return { state: "pending", completion: overrides.completion ?? Promise.resolve({ state: "authorized" }) };
    if (request.method === "refresh") { calls.push("refresh"); return { state: "refreshed" }; }
    if (request.method === "account-status") return { state: "authenticated" };
    return { state: request.method === "cancel" ? "canceled" : "logged-out" };
  } };
  let saves = 0;
  const lifecycle = createModelAccountLifecycle({
    authHelper: helper,
    accountHomeRoot: root,
    getUnlockKey: async () => "synthetic-unlock-key",
    getAccount: async () => overrides.getAccount ? overrides.getAccount() : account,
    encryptCache: async (plain, key, binding) => {
      assert.equal(key, "synthetic-unlock-key");
      events.push({ type: "encrypt", binding, plaintext: new TextDecoder().decode(plain) });
      return `encrypted.${Buffer.from(plain).toString("base64")}`;
    },
    persistEncrypted: async request => {
      saves++;
      events.push({ type: "persist", request });
      if (overrides.persistEncrypted) return overrides.persistEncrypted(request, saves);
    },
    onUnsaved: value => events.push({ type: "unsaved", ...value }),
    retryDelaysMs: overrides.retryDelaysMs ?? [],
    sleep: async () => {},
    ...overrides.options,
  });
  return { root, home, lifecycle, events, methods, calls, get saves() { return saves; } };
}

test("device authorization persists only encrypted, account-bound cache after success", async t => {
  const f = await fixture(t);
  const login = await f.lifecycle.deviceLogin(accountId);
  assert.equal(login.state, "pending");
  assert.deepEqual(await login.completion, { state: "saved" });
  const [encrypted, saved] = f.events.filter(event => event.type === "encrypt" || event.type === "persist");
  assert.equal(encrypted.binding.ownerId, "owner");
  assert.equal(encrypted.binding.recordType, "model");
  assert.equal(encrypted.binding.revision, 5);
  assert.equal(saved.request.expectedRevision, 4);
  assert.match(saved.request.encryptedPayload, /^encrypted\./);
  assert.equal("unlockKey" in saved.request, false);
});

test("denied or expired device authorization does not persist token state", async t => {
  const f = await fixture(t, { completion: Promise.resolve({ state: "reauthentication-required" }) });
  const login = await f.lifecycle.deviceLogin(accountId);
  assert.deepEqual(await login.completion, { state: "reauthentication-required" });
  assert.equal(f.saves, 0);
});

test("refresh keeps the working local cache and reports bounded encrypted-save failures", async t => {
  const f = await fixture(t, { retryDelaysMs: [0, 0], persistEncrypted: async () => { throw new Error("fixture outage"); } });
  assert.deepEqual(await f.lifecycle.refresh(accountId), { state: "unsaved", attempts: 3 });
  assert.equal(f.lifecycle.isUnsaved(accountId), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves, 3);
  assert.deepEqual(f.events.filter(event => event.type === "unsaved").map(event => event.unsaved), [true]);
});

test("refresh requests for one account serialize and use the latest revision", async t => {
  let revision = 0, inFlight = 0, maximumInFlight = 0;
  const f = await fixture(t, {
    getAccount: () => ({ ...account, revision }),
    persistEncrypted: async () => {
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      revision++;
      inFlight--;
    },
  });
  await Promise.all([f.lifecycle.refresh(accountId), f.lifecycle.refresh(accountId)]);
  assert.equal(maximumInFlight, 1);
  assert.equal(f.saves, 2);
});

test("deletion invalidates a retry and removes the account cache", async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, {
    retryDelaysMs: [0, 0, 0],
    persistEncrypted: async (_request, attempt) => {
      if (attempt === 1) { await waiting; throw new Error("first save failed"); }
    },
  });
  const refreshing = f.lifecycle.refresh(accountId);
  while (!f.saves) await new Promise(resolve => setImmediate(resolve));
  const deleting = f.lifecycle.deleteAccount(accountId);
  release();
  await assert.rejects(refreshing, /changed before token persistence/);
  assert.deepEqual(await deleting, { state: "deleted" });
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.ok(f.methods.includes("logout"));
});

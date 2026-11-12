import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelAccountLifecycle } from "../src/model-account-lifecycle.mjs";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const resetAccountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
    if (request.method === "refresh") { calls.push("refresh"); return overrides.refreshResult ?? { state: "refreshed" }; }
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

test("expired refresh explicitly requires reauthentication without saving stale tokens", async t => {
  const f = await fixture(t, { refreshResult: { state: "reauthentication-required" } });
  assert.deepEqual(await f.lifecycle.refresh(accountId), { state: "reauthentication-required" });
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

test("refresh re-encrypts against a newer account revision after a concurrent edit", async t => {
  let revision = 4;
  const f = await fixture(t, {
    getAccount: () => ({ ...account, revision }),
    persistEncrypted: async request => {
      if (request.expectedRevision !== revision || f.saves === 1) {
        revision++;
        const error = new Error("stale model account revision");
        error.code = "stale_revision";
        throw error;
      }
      revision++;
    },
  });
  assert.deepEqual(await f.lifecycle.refresh(accountId), { state: "saved" });
  const writes = f.events.filter(event => event.type === "persist").map(event => event.request);
  assert.deepEqual(writes.map(request => request.expectedRevision), [4, 5]);
  assert.notEqual(writes[0].idempotencyKey, writes[1].idempotencyKey);
  const encryptions = f.events.filter(event => event.type === "encrypt");
  assert.deepEqual(encryptions.map(event => event.binding.revision), [5, 6]);
});

test("refresh does not retry a stale cache write after the unlock-key generation rotates", async t => {
  let generation = "generation";
  const f = await fixture(t, {
    getAccount: () => ({ ...account, keyGeneration: generation }),
    persistEncrypted: async () => {
      generation = "rotated-generation";
      const error = new Error("stale model account revision");
      error.code = "stale_revision";
      throw error;
    },
  });

  await assert.rejects(f.lifecycle.refresh(accountId), /changed before token persistence/);
  assert.equal(f.saves, 1);
  assert.deepEqual(f.events.filter(event => event.type === "encrypt").map(event => event.binding.keyGeneration), ["generation"]);
});

test("refresh does not retry a transient cache write after the key generation rotates during backoff", async t => {
  let generation = "generation";
  const f = await fixture(t, {
    retryDelaysMs: [1],
    getAccount: () => ({ ...account, keyGeneration: generation }),
    options: { sleep: async () => { generation = "rotated-generation"; } },
    persistEncrypted: async () => { throw new Error("temporary persistence failure"); },
  });

  await assert.rejects(f.lifecycle.refresh(accountId), /changed before token persistence/);
  assert.equal(f.saves, 1);
  assert.deepEqual(f.events.filter(event => event.type === "encrypt").map(event => event.binding.keyGeneration), ["generation"]);
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

test("reset snapshot invalidates a refresh cache write already in flight", async t => {
  let release;
  let entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, {
    persistEncrypted: async () => {
      entered();
      await waiting;
      const error = new Error("stale model account revision");
      error.code = "stale_revision";
      throw error;
    },
  });

  const refreshing = f.lifecycle.refresh(accountId);
  await started;
  const resetting = f.lifecycle.reconcileAll([]);
  await new Promise(resolve => setImmediate(resolve));
  release();

  await assert.rejects(refreshing, /changed before token persistence/);
  assert.deepEqual(await resetting, { removed: [accountId], accounts: [] });
  assert.equal(f.saves, 1);
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.ok(f.methods.includes("logout"));
});

test("deletion during refresh persistence backoff prevents a delayed retry", async t => {
  let releaseBackoff;
  let enteredBackoff;
  const waiting = new Promise(resolve => { releaseBackoff = resolve; });
  const started = new Promise(resolve => { enteredBackoff = resolve; });
  const f = await fixture(t, {
    retryDelaysMs: [1],
    options: { sleep: async () => { enteredBackoff(); await waiting; } },
    persistEncrypted: async () => { throw new Error("temporary persistence failure"); },
  });

  const refreshing = f.lifecycle.refresh(accountId);
  await started;
  const deleting = f.lifecycle.deleteAccount(accountId);
  releaseBackoff();

  await assert.rejects(refreshing, /changed before token persistence/);
  assert.deepEqual(await deleting, { state: "deleted" });
  assert.equal(f.saves, 1);
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.ok(f.methods.includes("logout"));
});

test("reset during refresh persistence backoff prevents a delayed retry and clears the cache", async t => {
  let releaseBackoff;
  let enteredBackoff;
  let releaseSnapshot;
  let enteredSnapshot;
  const waiting = new Promise(resolve => { releaseBackoff = resolve; });
  const started = new Promise(resolve => { enteredBackoff = resolve; });
  const snapshotWaiting = new Promise(resolve => { releaseSnapshot = resolve; });
  const snapshotStarted = new Promise(resolve => { enteredSnapshot = resolve; });
  const f = await fixture(t, {
    retryDelaysMs: [1],
    options: {
      sleep: async () => { enteredBackoff(); await waiting; },
      readDirectory: async () => { enteredSnapshot(); await snapshotWaiting; return [{ name: accountId }]; },
    },
    persistEncrypted: async () => { throw new Error("temporary persistence failure"); },
  });

  const refreshing = f.lifecycle.refresh(accountId);
  await started;
  const resetting = f.lifecycle.reconcileAll([]);
  await snapshotStarted;
  releaseSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  releaseBackoff();

  await assert.rejects(refreshing, /changed before token persistence/);
  assert.deepEqual(await resetting, { removed: [accountId], accounts: [] });
  assert.equal(f.saves, 1);
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.ok(f.methods.includes("logout"));
});

test("deletion racing pending device login prevents a late authorization from restoring its cache", async t => {
  let complete;
  const f = await fixture(t, { completion: new Promise(resolve => { complete = resolve; }) });
  const login = await f.lifecycle.deviceLogin(accountId);
  const deleting = f.lifecycle.deleteAccount(accountId);
  complete({ state: "authorized" });
  assert.deepEqual(await login.completion, { state: "deleted" });
  assert.deepEqual(await deleting, { state: "deleted" });
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.equal(f.saves, 0);
});

test("unlock reconciliation restores the encrypted Codex cache before checking account status", async t => {
  const persisted = new TextEncoder().encode(JSON.stringify({ tokens: { access_token: "restored-access", refresh_token: "restored-refresh" } }));
  const encryptedPayload = `cache.${Buffer.from(persisted).toString("base64")}`;
  const f = await fixture(t, { options: {
    getEncryptedCache: async id => ({
      accountId: id, ownerId: "owner", keyGeneration: "generation", revision: 8, encryptedPayload,
    }),
    decryptCache: async (payload, key, binding) => {
      assert.equal(payload, encryptedPayload);
      assert.equal(key, "synthetic-unlock-key");
      assert.deepEqual(binding, {
        ownerId: "owner", recordId: accountId, recordType: "model", destination: "factorize",
        revision: 8, keyGeneration: "generation",
      });
      return new Uint8Array(persisted);
    },
  } });

  assert.deepEqual(await f.lifecycle.reconcile(accountId), { state: "saved" });
  assert.deepEqual(JSON.parse(await readFile(join(f.home, "auth.json"), "utf8")), {
    tokens: { access_token: "restored-access", refresh_token: "restored-refresh" },
  });
  assert.ok(f.methods.indexOf("account-status") > -1);
  assert.equal(f.events.find(event => event.type === "persist").request.expectedRevision, 4);
});

test("unlock reconciliation removes stale cache when the account key generation changed", async t => {
  const f = await fixture(t, { options: {
    getEncryptedCache: async id => ({
      accountId: id, ownerId: "owner", keyGeneration: "old-generation", revision: 8, encryptedPayload: "cache.payload",
    }),
    decryptCache: async () => { throw new Error("must not decrypt stale cache"); },
  } });

  assert.deepEqual(await f.lifecycle.reconcile(accountId), { state: "reauthentication-required" });
  await assert.rejects(readFile(join(f.home, "auth.json")), { code: "ENOENT" });
  assert.equal(f.methods.includes("account-status"), false);
});

test("unlock snapshot reconciliation logs out and removes cached accounts deleted by reset", async t => {
  const f = await fixture(t);
  const staleHome = join(f.root, resetAccountId);
  await mkdir(staleHome, { recursive: true });
  await writeFile(join(staleHome, "auth.json"), JSON.stringify({ tokens: { access_token: "stale-reset-token" } }));

  assert.deepEqual(await f.lifecycle.reconcileAll([account]), {
    removed: [resetAccountId],
    accounts: [{ accountId, state: "saved" }],
  });
  await assert.rejects(readFile(join(staleHome, "auth.json")), { code: "ENOENT" });
  assert.ok(f.methods.includes("logout"));
  assert.equal(f.saves, 1);
});

test("unlock snapshot rejects duplicate account identities before touching local state", async t => {
  const f = await fixture(t);
  await assert.rejects(f.lifecycle.reconcileAll([account, account]), /snapshot is invalid/);
  assert.deepEqual(JSON.parse(await readFile(join(f.home, "auth.json"), "utf8")), {
    tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
  });
  assert.equal(f.methods.length, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeProxyEnrollment, createModelAccountPersistenceAdapter, createProxyEnrollmentAuthenticator, issueProxyEnrollment, readProxyIntegrationSnapshot, readProxyRunRevocations, registerProxyBoot, reportProxyRuntimeStatus, startProxyRuntimeStatusReporter, startProxyRunRevocationMonitor } from "../src/control-client.mjs";

const token = `fzc_${"A".repeat(43)}`;
const bootEpoch = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;

test("proxy runtime status reports the current boot and runtime unlock state", async () => {
  const requests = [];
  await reportProxyRuntimeStatus({ controlOrigin: "https://factorize.example", token, bootEpoch, unlocked: true, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    return Response.json({ updated: true });
  } });
  assert.equal(requests[0].url, "https://factorize.example/internal/credential-proxy/status");
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(requests[0].body, { bootEpoch, unlocked: true });
  await assert.rejects(reportProxyRuntimeStatus({ controlOrigin: "https://factorize.example", token, bootEpoch: "invalid", unlocked: false }), /runtime status/);
});

test("runtime status reporter periodically refreshes authenticated status", async () => {
  const requests = [];
  const runtime = { state: "locked" };
  const monitor = startProxyRuntimeStatusReporter({ controlOrigin: "https://factorize.example", token, bootEpoch, runtime, intervalMs: 1_000, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ updated: true });
  } });
  await new Promise(resolve => setTimeout(resolve, 5));
  runtime.state = "unlocked";
  await new Promise(resolve => setTimeout(resolve, 5));
  await monitor.close();
  assert.equal(requests[0].body.unlocked, false);
  assert.ok(requests.every(request => request.url.endsWith("/internal/credential-proxy/status")));
});

test("boot registration uses a one-call control credential, HTTPS, exact path and fresh process epoch", async () => {
  let request;
  const result = await registerProxyBoot({ controlOrigin: "https://factorize.example", browserOrigin: "https://proxy.example", token, bootEpoch, fetchImpl: async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ registered: true, tenantId: "11111111-1111-4111-8111-111111111111", proxyIdentity: "proxy-fixture", bootEpoch, controlCredential: `fzc_${"c".repeat(43)}` });
  } });
  assert.deepEqual(result, { tenantId: "11111111-1111-4111-8111-111111111111", proxyIdentity: "proxy-fixture", bootEpoch, controlCredential: `fzc_${"c".repeat(43)}` });
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/register-boot");
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.redirect, "error");
  assert.deepEqual(JSON.parse(request.init.body), { bootEpoch, browserOrigin: "https://proxy.example" });
});

test("proxy snapshot reader requests only the bound run revision and validates encrypted records", async () => {
  let request;
  const snapshot = { ownerId: "owner-1", records: [{ id: "integration-1", kind: "bearer", origin: "https://api.example", revision: 4, encryptedPayload: "ciphertext" }], modelAccount: { id: "model-1", kind: "model", origin: null, revision: 5, encryptedPayload: "model-ciphertext" } };
  const result = await readProxyIntegrationSnapshot({ controlOrigin: "https://factorize.example", token, binding: { runId, grantRevision: 7 }, fetchImpl: async (url, init) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    return Response.json(snapshot);
  } });
  assert.deepEqual(result, snapshot);
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/integration-snapshot");
  assert.deepEqual(request.body, { runId, grantRevision: 7 });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  await assert.rejects(readProxyIntegrationSnapshot({ controlOrigin: "https://factorize.example", token, binding: { runId, grantRevision: 7 }, fetchImpl: async () => Response.json({ ownerId: "owner-1", records: [{ ...snapshot.records[0], kind: "model" }] }) }), /invalid proxy integration snapshot response/);
  await assert.rejects(readProxyIntegrationSnapshot({ controlOrigin: "https://factorize.example", token, binding: { runId, grantRevision: 7 }, fetchImpl: async () => Response.json({ ...snapshot, modelAccount: { ...snapshot.modelAccount, kind: "bearer" } }) }), /invalid proxy integration snapshot response/);
});

test("model account persistence adapter lists owner-bound account revisions over proxy authentication", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  let request;
  const adapter = createModelAccountPersistenceAdapter({
    controlOrigin: "https://factorize.example", controlCredential: token, ownerId,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      return Response.json({ ownerId, keyGeneration: "22222222-2222-4222-8222-222222222222",
        accounts: [{ id: "33333333-3333-4333-8333-333333333333", kind: "model", origin: null, revision: 4 }] });
    },
  });
  assert.deepEqual(await adapter.listAccounts(), [{ id: "33333333-3333-4333-8333-333333333333", kind: "model", origin: null, revision: 4, ownerId, keyGeneration: "22222222-2222-4222-8222-222222222222" }]);
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/model-account-cache");
  assert.deepEqual(request.body, { operation: "list" });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  await assert.rejects(adapter.listAccounts && createModelAccountPersistenceAdapter({
    controlOrigin: "https://factorize.example", controlCredential: token, ownerId,
    fetchImpl: async () => Response.json({ ownerId: "22222222-2222-4222-8222-222222222222", keyGeneration: "22222222-2222-4222-8222-222222222222", accounts: [] }),
  }).listAccounts(), /invalid model account list response/);
});

test("proxy revocation monitor applies durable run revocations and tolerates an outage", async () => {
  const requests = [];
  const revoked = [];
  let failFirst = true;
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (failFirst) { failFirst = false; throw new Error("offline fixture"); }
    return Response.json({ revokedRunIds: [runId] });
  };
  const runtime = { revokeRun: async id => { revoked.push(id); } };
  const monitor = startProxyRunRevocationMonitor({
    controlOrigin: "https://factorize.example", controlCredential: token, bootEpoch, runtime, intervalMs: 100, fetchImpl,
  });
  try {
    const deadline = Date.now() + 1_000;
    while (!revoked.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(revoked, [runId]);
    assert.equal(requests.length, 2, "a failed poll leaves the proxy live and retries through the control plane");
    assert.ok(requests.every(request => request.url === "https://factorize.example/internal/credential-proxy/revocations"));
    assert.ok(requests.every(request => request.init.headers.Authorization === `Bearer ${token}`));
    assert.ok(requests.every(request => request.body.bootEpoch === bootEpoch));
  } finally {
    await monitor.close();
  }
  await assert.rejects(readProxyRunRevocations({ controlOrigin: "https://factorize.example", token, bootEpoch, fetchImpl: async () => Response.json({ revokedRunIds: ["invalid"] }) }), /invalid proxy revocation response/);
});

test("boot registration rejects unsafe origins, invalid credentials and mismatched response bindings", async () => {
  await assert.rejects(registerProxyBoot({ controlOrigin: "http://factorize.example", token, bootEpoch, browserOrigin: "https://proxy.example" }), /HTTPS origin/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token: "fzt_run_token", bootEpoch, browserOrigin: "https://proxy.example" }), /credential/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token, bootEpoch, browserOrigin: "https://proxy.example", fetchImpl: async () => Response.json({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch: "33333333-3333-4333-8333-333333333333" }) }), /invalid proxy boot registration response/);
});

test("proxy control client requests and consumes a one-use enrollment over authenticated HTTPS", async () => {
  const controlToken = `fzc_${"c".repeat(43)}`;
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? Response.json({ enrollmentId: "enrollment-1", token: "e".repeat(43), grantRevision: 2 })
      : Response.json({ consumed: true, binding: { enrollmentId: "enrollment-1" } });
  };
  const common = { controlOrigin: "https://factorize.example", token: controlToken, fetchImpl };
  const enrollment = await issueProxyEnrollment({ ...common, body: { runId: "33333333-3333-4333-8333-333333333333", vmIdentity: "fly:vm-1" } });
  assert.equal(enrollment.token, "e".repeat(43));
  const consumed = await consumeProxyEnrollment({ ...common, body: { runId: "33333333-3333-4333-8333-333333333333", vmIdentity: "fly:vm-1", enrollmentToken: enrollment.token } });
  assert.equal(consumed.enrollmentId, "enrollment-1");
  assert.deepEqual(requests.map(request => request.url), [
    "https://factorize.example/internal/credential-proxy/enroll",
    "https://factorize.example/internal/credential-proxy/consume-enrollment",
  ]);
  assert.ok(requests.every(request => request.init.headers.Authorization === `Bearer ${controlToken}` && request.init.redirect === "error"));
});

test("proxy enrollment authenticator binds issued and consumed state to the mTLS VM and current boot", async () => {
  const controlToken = `fzc_${"d".repeat(43)}`;
  const requests = [];
  const grants = [{ id: "tool-1", origin: "https://api.example.test", credential: "synthetic-secret" }];
  const fetchImpl = async (url, init) => {
    const request = { url: String(url), init, body: JSON.parse(init.body) };
    requests.push(request);
    if (requests.length === 1) return Response.json({ enrollmentId: "enrollment-1", token: "e".repeat(43), grantRevision: 7 });
    return Response.json({ consumed: true, binding: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      runId: request.body.runId,
      vmIdentity: request.body.vmIdentity,
      proxyIdentity: "fly:proxy-1",
      bootEpoch,
      enrollmentId: "enrollment-1",
      grantRevision: 7,
    } });
  };
  const authenticateRun = createProxyEnrollmentAuthenticator({
    controlOrigin: "https://factorize.example",
    controlCredential: controlToken,
    bootEpoch,
    fetchImpl,
    resolveGrants: async binding => {
      assert.equal(binding.runId, "33333333-3333-4333-8333-333333333333");
      return grants;
    },
  });
  const connection = await authenticateRun({
    runId,
    runCredential,
    vmIdentity: "fly:vm-1",
    bootEpoch,
  });
  assert.deepEqual(requests.map(request => request.url), [
    "https://factorize.example/internal/credential-proxy/enroll",
    "https://factorize.example/internal/credential-proxy/consume-enrollment",
  ]);
  assert.deepEqual(requests.map(request => request.body), [
    { runId, vmIdentity: "fly:vm-1", runCredential },
    { runId, vmIdentity: "fly:vm-1", enrollmentToken: "e".repeat(43) },
  ]);
  assert.ok(requests.every(request => request.init.headers.Authorization === `Bearer ${controlToken}`));
  assert.equal(connection.authenticated, true);
  assert.equal(connection.enrollmentConsumed, true);
  assert.equal(connection.vmId, "fly:vm-1");
  assert.equal(connection.bootEpoch, bootEpoch);
  assert.equal(connection.connectionId, "enrollment-1");
  assert.deepEqual(connection.grants, grants);
  await assert.rejects(authenticateRun({
    runId,
    runCredential,
    vmIdentity: "fly:vm-1",
    bootEpoch: "44444444-4444-4444-8444-444444444444",
  }), /invalid proxy enrollment identity/);
  assert.equal(requests.length, 2, "a stale boot cannot issue another enrollment");
  await assert.rejects(authenticateRun({ runId, vmIdentity: "fly:vm-1", bootEpoch }), /invalid proxy enrollment identity/);
  assert.equal(requests.length, 2, "a missing job run credential cannot issue enrollment");
});

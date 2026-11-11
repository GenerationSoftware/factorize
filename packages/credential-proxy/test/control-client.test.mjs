import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeProxyEnrollment, createProxyEnrollmentAuthenticator, issueProxyEnrollment, readProxyIntegrationSnapshot, registerProxyBoot } from "../src/control-client.mjs";

const token = `fzc_${"A".repeat(43)}`;
const bootEpoch = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;

test("boot registration uses a one-call control credential, HTTPS, exact path and fresh process epoch", async () => {
  let request;
  const result = await registerProxyBoot({ controlOrigin: "https://factorize.example", token, bootEpoch, fetchImpl: async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch, controlCredential: `fzc_${"c".repeat(43)}` });
  } });
  assert.deepEqual(result, { proxyIdentity: "proxy-fixture", bootEpoch, controlCredential: `fzc_${"c".repeat(43)}` });
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/register-boot");
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.redirect, "error");
  assert.deepEqual(JSON.parse(request.init.body), { bootEpoch });
});

test("proxy snapshot reader requests only the bound run revision and validates encrypted records", async () => {
  let request;
  const snapshot = { ownerId: "owner-1", records: [{ id: "integration-1", kind: "bearer", origin: "https://api.example", revision: 4, encryptedPayload: "ciphertext" }] };
  const result = await readProxyIntegrationSnapshot({ controlOrigin: "https://factorize.example", token, binding: { runId, grantRevision: 7 }, fetchImpl: async (url, init) => {
    request = { url: String(url), init, body: JSON.parse(init.body) };
    return Response.json(snapshot);
  } });
  assert.deepEqual(result, snapshot);
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/integration-snapshot");
  assert.deepEqual(request.body, { runId, grantRevision: 7 });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  await assert.rejects(readProxyIntegrationSnapshot({ controlOrigin: "https://factorize.example", token, binding: { runId, grantRevision: 7 }, fetchImpl: async () => Response.json({ ownerId: "owner-1", records: [{ ...snapshot.records[0], kind: "model" }] }) }), /invalid proxy integration snapshot response/);
});

test("boot registration rejects unsafe origins, invalid credentials and mismatched response bindings", async () => {
  await assert.rejects(registerProxyBoot({ controlOrigin: "http://factorize.example", token, bootEpoch }), /HTTPS origin/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token: "fzt_run_token", bootEpoch }), /credential/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token, bootEpoch, fetchImpl: async () => Response.json({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch: "33333333-3333-4333-8333-333333333333" }) }), /invalid proxy boot registration response/);
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

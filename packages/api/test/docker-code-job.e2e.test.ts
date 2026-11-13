import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import worker from "../src/worker";
import { Database } from "../src/postgres/database";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { signSession } from "../src/session";
import { createDockerExecutionHost } from "../src/docker-execution-host";
import { createLocalExecutionRunner } from "../src/local-execution-runner";
import { createLocalArtifactStorage } from "../src/local-execution-storage";
import { startLocalApiServer } from "../src/local-api-server";
import { createDockerJobInfrastructure } from "../src/docker-job-infrastructure";
import type { Env } from "../src/types";

// Node has no Cloudflare platform classes. No application/backend/scheduler method is mocked.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class {}, getOAuthApi: () => ({}) }));

const docker = (...args: string[]) => {
  try { return execFileSync("docker", args, { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new Error(`Docker fixture ${args[0]} failed; command arguments and output withheld`); }
};
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await read(); if (ready(value)) return value; await wait(100); }
  throw new Error(`Deadline exceeded: ${label}`);
}

it("runs saved code through the real API, encrypted grant, mTLS proxy and scheduler cleanup", async () => {
  if (!process.env.AUTH_TEST_DATABASE_URL || !process.env.FACTORIZE_E2E_TLS_DIR) throw new Error("Run npm run test:docker after npm run bootstrap:test");
  const tlsDirectory = process.env.FACTORIZE_E2E_TLS_DIR;
  const namespace = process.env.FACTORIZE_E2E_NAMESPACE ?? `fz-${randomUUID()}`;
  const jobNetwork = `${namespace}-jobs`, upstreamNetwork = `${namespace}-api`;
  const databaseName = process.env.FACTORIZE_E2E_DATABASE ?? `docker_e2e_${randomUUID().replaceAll("-", "")}`;
  if (!/^docker_e2e_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Invalid isolated E2E database name");
  const admin = new Database({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
  const address = new URL(process.env.AUTH_TEST_DATABASE_URL); address.pathname = `/${databaseName}`;
  const db = new Database({ connectionString: address.href });
  const storageDirectory = await mkdtemp(join(tmpdir(), "factorize-artifacts-"));
  const ownerId = randomUUID(), userId = randomUUID(), marker = randomUUID();
  const upstreamSecret = `synthetic-${randomUUID()}`;
  const jobImage = process.env.FACTORIZE_E2E_JOB_IMAGE!, proxyImage = process.env.FACTORIZE_E2E_PROXY_IMAGE!;
  const keypair = generateKeyPairSync("ed25519");
  let api: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;
  let runner: ReturnType<typeof createLocalExecutionRunner> | undefined;
  let fakeId: string | undefined;
  let createdDatabase = false;
  try {
    await admin.pool.query(`CREATE DATABASE ${databaseName}`); createdDatabase = true;
    const migrations = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort()) await db.pool.query(await readFile(new URL(file, migrations), "utf8"));
    await new IdentityRepository(db, ownerId).upsertOwner(userId, "docker-owner@example.test");
    docker("network", "create", jobNetwork);
    docker("network", "create", "--internal", upstreamNetwork);
    fakeId = docker("run", "-d", "--network", upstreamNetwork, "--name", `${namespace}-fake`,
      "--label", `sh.factorize.test.namespace=${namespace}`,
      "--mount", `type=bind,source=${tlsDirectory},target=/fixture-tls,readonly`,
      "--mount", `type=bind,source=${resolve("test/fixtures/docker-fake-api.mjs")},target=/fake-api.mjs,readonly`,
      "-e", `EXPECTED_BEARER=${upstreamSecret}`, "-e", `MARKER=${marker}`, jobImage, "node", "/fake-api.mjs");
    const fakeInfo = JSON.parse(docker("inspect", fakeId))[0];
    const fakeAddress = fakeInfo.NetworkSettings.Networks[upstreamNetwork].IPAddress;
    const readReceipts = () => JSON.parse(docker("exec", "-e", "NODE_EXTRA_CA_CERTS=/fixture-tls/ca.crt", fakeId!, "node", "-e", "fetch('https://localhost:8443/receipt',{signal:AbortSignal.timeout(3000)}).then(r=>r.text()).then(console.log)"));
    const upstreamOrigin = "https://fake-api.local:8443";
    await until(async () => { try { return readReceipts(); } catch { return null; } }, v => v !== null, "fake API readiness");
    const env = { DATABASE: db, APP_ORIGIN: "", CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32)), SESSION_SIGNING_SECRET: `session-${randomUUID()}`,
      MODEL_ACCOUNT_CAPABILITY_PRIVATE_KEY: keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      MODEL_ACCOUNT_CAPABILITY_PUBLIC_KEY: keypair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      TEST_DOCKER_EXECUTION: { enabled: true, image: jobImage }, RUN_ARTIFACTS: createLocalArtifactStorage(storageDirectory),
    } as unknown as Env;
    api = await startLocalApiServer({ key: await readFile(join(tlsDirectory, "server.key")), cert: await readFile(join(tlsDirectory, "server.crt")),
      fetch: request => worker.fetch(request, env, { waitUntil() {} } as any) });
    env.APP_ORIGIN = `https://${process.env.FACTORIZE_E2E_HOST_IP ?? "172.17.0.1"}:${api.port}`;
    const jobInputs: string[] = [];
    let destructionEvidence: { marker: string; storedLog: boolean } | undefined;
    const host = createDockerExecutionHost({ observeJobDestruction: async id => {
      const result = await db.pool.query(`SELECT r.job_result, EXISTS(SELECT 1 FROM app.run_artifacts a WHERE a.tenant_id=r.tenant_id AND a.run_id=r.id AND a.kind='terminal_log' AND a.state='stored') AS stored_log
        FROM app.runs r WHERE tenant_id=$1 AND execution_handle->>'id'=$2`, [ownerId, `${namespace}-jobs/${id}`]);
      destructionEvidence = { marker: result.rows[0]?.job_result?.outputs?.marker, storedLog: result.rows[0]?.stored_log };
    }, observeJobInput: (_command, input) => { if (input) jobInputs.push(typeof input === "string" ? input : new TextDecoder().decode(input)); }, testMode: true, database: db, env, namespace, jobNetwork, upstreamNetwork, jobImage, proxyImage, tlsDirectory, upstreamOrigin, upstreamAddress: fakeAddress });
    env.CREDENTIAL_PROXY_HOST = host;
    const member = await new IdentityRepository(db, ownerId).member(userId);
    const cookie = `factorize_session=${await signSession({ tenantId: ownerId, userId, email: "docker-owner@example.test", sessionVersion: member!.sessionVersion, exp: Math.floor(Date.now()/1000)+600 }, env.SESSION_SIGNING_SECRET)}`;
    const request = (path: string, method = "GET", body?: unknown) => fetch(env.APP_ORIGIN + "/api/v1" + path, { method, headers: { Cookie: cookie, Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
    const json = async (path: string, method = "GET", body?: unknown) => { const response = await request(path, method, body); const value = await response.json(); if (!response.ok) throw new Error(`API ${method} ${path}: ${response.status} ${JSON.stringify(value)}`); return value as any; };
    const project = await json("/projects", "POST", { name: "Docker test" });
    const integrationId = randomUUID(), generationId = randomUUID();
    const keyBytes = crypto.getRandomValues(new Uint8Array(32)), unlockKey = `fzk1.${Buffer.from(keyBytes).toString("base64url")}`;
    const material = await crypto.subtle.importKey("raw", keyBytes, "HKDF", false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("factorize.unlock-key.v1"), info: new TextEncoder().encode("factorize.record.aes-256-gcm.v1") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    async function encrypt(plain: string, id: string, kind: string, destination: string, revision: number) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(JSON.stringify(["factorize-record-v1", userId, id, kind, destination, revision])) }, aes, new TextEncoder().encode(plain)));
      return { nonce, ciphertext };
    }
    const verification = await encrypt("factorize-unlock-key-verification-v1", generationId, "unlock-verification", "factorize", 0);
    await json("/unlock-key/verification", "POST", { generationId, encryptedVerification: JSON.stringify({ version: 1, algorithm: "A256GCM", nonce: Buffer.from(verification.nonce).toString("base64url"), ciphertext: Buffer.from(verification.ciphertext).toString("base64url") }) });
    expect((await json("/unlock-key/verification")).verification.generationId).toBe(generationId);
    const encrypted = await encrypt(upstreamSecret, integrationId, "bearer", upstreamOrigin, 1);
    await json("/integrations/bearer", "POST", { id: integrationId, expectedRevision: 0, idempotencyKey: randomUUID(), name: "Fake API", origin: upstreamOrigin, description: null, encryptedPayload: `${Buffer.from(encrypted.nonce).toString("base64")}.${Buffer.from(encrypted.ciphertext).toString("base64")}` });
    const script = `#!/bin/bash\nset -eu\nnode --input-type=module <<'JS'\nimport fs from 'node:fs';\nimport net from 'node:net';\nconst marker=${JSON.stringify(marker)};\nconst direct=await new Promise(resolve=>{const s=net.connect({host:${JSON.stringify(fakeAddress)},port:8443}); s.setTimeout(1000,()=>{s.destroy();resolve(false)});s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false))});\nif(direct)throw new Error('network isolation failed');\nconst base=process.env.FACTORIZE_PROXY_URL;\nconst list=await (await fetch(base+'/integrations',{signal:AbortSignal.timeout(10000)})).json();\nconst integration=list.integrations.find(x=>x.id===${JSON.stringify(integrationId)});\nif(!integration)throw new Error('grant missing');\nconst r=await fetch(base+integration.endpoint+'echo/'+marker,{method:'POST',body:marker,signal:AbortSignal.timeout(10000)});\nif(!r.ok||(await r.json()).marker!==marker)throw new Error('response mismatch');\nconsole.log('executed:'+marker);\nfs.writeFileSync('/home/exedev/.factorize-job/evidence.txt',marker);\nawait new Promise(r=>setTimeout(r,1500));\nfs.writeFileSync(process.env.FACTORIZE_RESULT_PATH,JSON.stringify({status:'succeeded',outputs:{marker,directBlocked:true}}));\nJS\n`;
    const jobInput = { name: "Docker code", slug: "docker-code", projectId: project.id, executionType: "code", script, executionConfigId: "docker", triggers: [{ kind: "manual", slug: "trigger-1", config: {} }] };
    const enabled = env.TEST_DOCKER_EXECUTION;
    delete env.TEST_DOCKER_EXECUTION;
    expect((await request("/jobs", "POST", jobInput)).status).toBe(400);
    env.TEST_DOCKER_EXECUTION = enabled;
    expect((await request("/credential-proxy/browser-capability", "POST", { action: "unlock", key: unlockKey })).status).toBe(400);
    const job = await json("/jobs", "POST", jobInput);
    await json(`/jobs/${job.id}`, "PUT", { ...jobInput, portableIntegrationIds: [integrationId] });
    const ungrantedId = randomUUID();
    const ungranted = await encrypt(upstreamSecret, ungrantedId, "bearer", upstreamOrigin, 2);
    await json("/integrations/bearer", "POST", { id: ungrantedId, expectedRevision: 1, idempotencyKey: randomUUID(), name: "Ungranted", origin: upstreamOrigin, description: null, encryptedPayload: `${Buffer.from(ungranted.nonce).toString("base64")}.${Buffer.from(ungranted.ciphertext).toString("base64")}` });
    const setup = await json("/credential-proxy/setup", "POST", { operationId: randomUUID() });
    expect(setup.proxyIdentity.startsWith(`docker:${namespace}:`)).toBe(true);
    const lifecycle = async (action: string, body: unknown = {}) => { const c = await json("/credential-proxy/browser-capability", "POST", { action }); return fetch(c.endpoint, { method: "POST", headers: { Authorization: `Bearer ${c.capability}`, Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); };
    expect((await lifecycle("status")).status).toBe(200);
    expect((await lifecycle("unlock", { key: unlockKey })).status).toBe(200);
    expect((await lifecycle("apply")).status).toBe(200);
    const invoked = await json(`/jobs/${job.id}/invocations`, "POST", {});
    const runId = invoked.run?.id ?? invoked.runId ?? invoked.id;
    expect(typeof runId).toBe("string");
    runner = createLocalExecutionRunner(db, env, host.backendFactory);
    await runner.tick();
    const row = (await db.pool.query("SELECT execution_handle,execution_diagnostics FROM app.runs WHERE tenant_id=$1 AND id=$2", [ownerId, runId])).rows[0];
    if (row.execution_diagnostics?.state === "failed") throw new Error(row.execution_diagnostics.detail);
    expect(row.execution_handle.backendKind).toBe("docker");
    const containerId = row.execution_handle.id.split("/")[1];
    const containerConfig = docker("inspect", containerId);
    const inspected = JSON.parse(containerConfig)[0];
    expect(inspected.Config.Image).toBe(jobImage);
    expect(inspected.Mounts).toEqual([]);
    expect(inspected.HostConfig.Privileged).toBe(false);
    expect(inspected.Config.Labels["sh.factorize.test.operation"]).toBe(runId);
    expect(containerConfig.includes(upstreamSecret)).toBe(false);
    expect(/fzt_run_|fzc_/.test(containerConfig)).toBe(false);
    const guest = createDockerJobInfrastructure({ testMode: true, namespace: `${namespace}-jobs`, network: jobNetwork }).guest(containerId);
    const surfaces = await guest.run(["sh", "-c", "find /home/exedev/.factorize-job -type f -exec cat {} \\; ; cat /tmp/factorize.log /tmp/factorize.stderr 2>/dev/null || true; for environment in /proc/[0-9]*/environ; do cat \"$environment\" 2>/dev/null || true; done"]);
    expect(surfaces.stdout.includes(upstreamSecret)).toBe(false);
    expect(/fzt_run_|fzc_/.test(surfaces.stdout)).toBe(false);
    expect(jobInputs.some(input => input.includes('"code"'))).toBe(true);
    for (const input of jobInputs) { expect(input.includes(upstreamSecret)).toBe(false); expect(/fzt_run_|fzc_/.test(input)).toBe(false); }
    // The same real run/tunnel must deny access to a saved but ungranted integration.
    const denied = await guest.run(["runuser", "-u", "exedev", "--", "node", "-e", `fetch('http://127.0.0.1:18180/integrations/${ungrantedId}/echo/${marker}',{method:'POST',body:'${marker}',signal:AbortSignal.timeout(3000)}).then(r=>console.log(r.status))`]);
    expect(denied.stdout.trim()).toBe("403");
    const beforeLock = readReceipts().length;
    expect((await lifecycle("lock")).status).toBe(200);
    const locked = await guest.run(["runuser", "-u", "exedev", "--", "node", "-e", `fetch('http://127.0.0.1:18180/integrations/${integrationId}/echo/${marker}',{method:'POST',body:'${marker}',signal:AbortSignal.timeout(1200)}).then(r=>console.log(r.status)).catch(()=>console.log('denied'))`]);
    expect(["423", "denied"]).toContain(locked.stdout.trim());
    expect(readReceipts().length).toBe(beforeLock);
    expect((await lifecycle("unlock", { key: unlockKey })).status).toBe(200);
    await until(async () => { await runner!.tick(); return (await db.pool.query("SELECT state,artifact_state,failure_code,failure_reason FROM app.runs WHERE tenant_id=$1 AND id=$2", [ownerId, runId])).rows[0]; }, row => ["succeeded", "failed", "stopped"].includes(row.state), "normal scheduler finalization", 60_000).then(row => { if (row.state !== "succeeded" || row.artifact_state !== "stored") throw new Error(`Finalization: ${JSON.stringify(row)}`); });
    expect(destructionEvidence).toEqual({ marker, storedLog: true });
    expect(docker("ps", "-aq", "--filter", `id=${containerId}`)).toBe("");
    const receipt = readReceipts();
    expect(receipt).toEqual([{ credentialMatched: true, method: "POST", path: `/echo/${marker}`, body: marker }]);
    const artifacts = (await db.pool.query("SELECT kind,object_key FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2", [ownerId, runId])).rows;
    expect(artifacts.some(row => row.kind === "terminal_log")).toBe(true);
    const log = await env.RUN_ARTIFACTS!.get(artifacts.find(row => row.kind === "terminal_log").object_key);
    expect((await log!.text()).includes(`executed:${marker}`)).toBe(true);
    const persistedResult = (await db.pool.query("SELECT job_result FROM app.runs WHERE tenant_id=$1 AND id=$2", [ownerId, runId])).rows[0];
    expect(persistedResult.job_result).toMatchObject({ status: "succeeded", outputs: { marker, directBlocked: true } });
    for (const artifact of artifacts) {
      const stored = await env.RUN_ARTIFACTS!.get(artifact.object_key);
      const text = await stored!.text();
      expect(text.includes(upstreamSecret)).toBe(false);
      expect(/fzt_run_|fzc_/.test(text)).toBe(false);
    }
  } finally {
    await runner?.close(); await api?.close();
    const containers = docker("ps", "-aq", "--filter", `label=sh.factorize.test.namespace=${namespace}`).split("\n").filter(Boolean);
    const jobs = docker("ps", "-aq", "--filter", `label=sh.factorize.test.namespace=${namespace}-jobs`).split("\n").filter(Boolean);
    for (const id of [...containers, ...jobs]) docker("rm", "-f", id);
    for (const network of [jobNetwork, upstreamNetwork]) { try { docker("network", "rm", network); } catch {} }
    await db.close(); if (createdDatabase) await admin.pool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`); await admin.close();
    await rm(storageDirectory, { recursive: true, force: true });
  }
}, 120_000);

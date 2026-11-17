import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { VendorRunIdentityRepository } from "../src/postgres/vendor-run-identity-repository";
import { FlyConnectionRepository } from "../src/postgres/fly-connection-repository";
import { issueArtifactUploadGrant } from "../src/artifact-upload";
import { snapshotRunAuthorization } from "../src/run-authorizations";
import { authenticateVendorRunRequest } from "../src/vendor-run-auth";
import { exeWifIntegrationNameFor, vmNameFor } from "../src/exe-vm-backend";
import { EncryptedIntegrationRepository } from "../src/postgres/encrypted-integration-repository";
import { GitHubRepository } from "../src/postgres/github-repository";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import worker from "../src/worker";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("vendor identity request admission (PostgreSQL and Worker boundary)", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  let privateKey: CryptoKey, jwk: JsonWebKey, jwt: string;
  const issuer = "https://oidc.fly.io/connected-org", subject = "connected-org:run-app:machine-name", machineId = "fixture-machine";
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  async function sign(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const input = `${encode({alg: "RS256", kid: "test-key"})}.${encode({ iss: issuer, sub: subject, aud: `factorize://runs/${f.runId}`, machine_id: machineId, iat: now - 5, exp: now + 600, ...overrides })}`;
    return `${input}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input))).toString("base64url")}`;
  }
  function request(token = jwt, runId = f.runId, path = "/api/v1/runtime-context", extra: Record<string, string> = {}) {
    return new Request(`${f.env.APP_ORIGIN}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Factorize-Run-Id": runId, ...extra } });
  }
  beforeAll(async () => {
    f = await loadingFixture(url!);
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    privateKey = pair.privateKey;
    jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  });
  afterAll(async () => { await f?.cleanup(); });
  beforeEach(async () => {
    const now = Math.floor(Date.now() / 1000);
    await f.db.pool.query("UPDATE app.job_runs SET state='running' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='running',execution_handle=$3,execution_config=$4 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, {backendKind: "fly", id: `run-app/${machineId}`}, {executionProvider: "fly", connectionId: "config", runScopes: ["runs:read"]}]);
    await new FlyConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY).save({organizationSlug: "connected-org", organizationName: "A different display name"}, "fixture-token");
    await f.db.pool.query("DELETE FROM app.vendor_run_identity_bindings WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    await new VendorRunIdentityRepository(f.db).persistVerified({tenantId: f.tenantId, issuedAt: now - 5, identity: {provider: "fly.io", issuer, subject, audience: `factorize://runs/${f.runId}`, runId: f.runId, vmId: machineId, issuedAt: now - 5, expiresAt: now + 600, keyId: "test-key"}});
    await f.db.pool.query("DELETE FROM app.run_authorizations WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    await snapshotRunAuthorization(f.db, {tenantId: f.tenantId, runId: f.runId, scopes: ["runs:read"]});
    jwt = await sign();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${issuer}/.well-known/openid-configuration`) return Response.json({issuer, jwks_uri: `${issuer}/.well-known/jwks`});
      if (String(input) === `${issuer}/.well-known/jwks`) return Response.json({keys: [{...jwk, kid: "test-key"}]});
      throw new Error("Unexpected outbound request");
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("authenticates at the Worker boundary with only snapshotted scopes and server tenant", async () => {
    const auth = await authenticateVendorRunRequest(request(jwt, f.runId, undefined, {"X-Factorize-Tenant-Id": f.otherTenant}), f.env);
    expect(auth).toMatchObject({tenantId: f.tenantId, runId: f.runId, runJobId: f.jobIds[0], authMethod: "vendor_identity", scopes: ["runs:read"]});
    expect(auth).not.toHaveProperty("runCredentialDigest");
    const response = await worker.fetch(request(), f.env, {waitUntil() {}} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({authMethod: "vendor_identity", scopes: ["runs:read"], runId: f.runId});
    expect((await worker.fetch(request(jwt, f.runId, "/api/v1/jobs"), f.env, {waitUntil() {}} as any)).status).toBe(403);
    await f.db.pool.query("UPDATE app.jobs SET run_scopes='[\"jobs:write\",\"jobs:read\"]' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.jobIds[0]]);
    await snapshotRunAuthorization(f.db, {tenantId: f.tenantId, runId: f.runId, scopes: ["jobs:read", "jobs:write"]});
    expect((await authenticateVendorRunRequest(request(), f.env))?.scopes).toEqual(["runs:read"]);
    await f.db.pool.query("UPDATE app.run_authorizations SET scopes='[]' WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    expect((await authenticateVendorRunRequest(request(), f.env))?.scopes).toEqual([]);
  });

  it("requires both the exact provisioned run and a valid vendor signature", async () => {
    for (const claims of [{iss: "https://oidc.fly.io/foreign-org"}, {aud: "other"}, {sub: "other"}, {machine_id: "other"}, {exp: Math.floor(Date.now()/1000)-1}]) {
      expect(await authenticateVendorRunRequest(request(await sign(claims)), f.env)).toBeNull();
    }
    expect(await authenticateVendorRunRequest(request(jwt, crypto.randomUUID()), f.env)).toBeNull();
    expect(await authenticateVendorRunRequest(new Request(f.env.APP_ORIGIN, {headers: {Authorization: `Bearer ${jwt}`}}), f.env)).toBeNull();
    const forged = jwt.split("."); forged[1] = encode({iss: issuer, sub: subject});
    expect(await authenticateVendorRunRequest(request(forged.join(".")), f.env)).toBeNull();
    // A malformed run-auth request cannot fall back to an otherwise valid session.
    expect((await worker.fetch(request("invalid", f.runId, undefined, {Cookie: f.cookie}), f.env, {waitUntil() {}} as any)).status).toBe(401);
  });

  it("requires explicit destination permission and prevents a run from granting itself permission", async () => {
    await f.db.pool.query("UPDATE app.run_authorizations SET scopes='[\"runs:invoke\",\"jobs:write\"]' WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    const invoke = () => worker.fetch(new Request(request(jwt, f.runId, `/api/v1/jobs/${f.jobIds[1]}/invocations`), {
      method: "POST", headers: {Authorization: `Bearer ${jwt}`, "X-Factorize-Run-Id": f.runId, "Content-Type": "application/json"}, body: JSON.stringify({prompt: "selected destination", idempotencyKey: "vendor-run-test"}),
    }), f.env, {waitUntil() {}} as any);
    expect((await invoke()).status).toBe(403);
    const escalate = await worker.fetch(new Request(request(jwt, f.runId, `/api/v1/jobs/${f.jobIds[0]}/invocation-permissions`), {
      method: "PUT", headers: {Authorization: `Bearer ${jwt}`, "X-Factorize-Run-Id": f.runId, "Content-Type": "application/json"}, body: JSON.stringify({destinationJobIds: [f.jobIds[1]]}),
    }), f.env, {waitUntil() {}} as any);
    expect(escalate.status).toBe(403);
    await f.db.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_job_id,destination_job_id) VALUES($1,$2,$3)", [f.tenantId, f.jobIds[0], f.jobIds[1]]);
    const accepted = await invoke();
    expect(accepted.status).toBe(202);
    const first = await accepted.json() as Record<string, unknown>;
    expect(await (await invoke()).json()).toMatchObject({...first, duplicate: true});
  });

  it("revalidates the exclusive exe.dev attachment on each request", async () => {
    const vm = vmNameFor(f.runId), integrationName = exeWifIntegrationNameFor(f.runId);
    const exeIssuer = "https://exe.dev/issuer/test-run", exeSubject = "sub-run-integration";
    await f.db.pool.query("DELETE FROM app.vendor_run_identity_bindings WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    const now = Math.floor(Date.now()/1000);
    await new VendorRunIdentityRepository(f.db).persistVerified({tenantId: f.tenantId, issuedAt: now-5, identity: {provider: "exe.dev", issuer: exeIssuer, subject: exeSubject, audience: `factorize://runs/${f.runId}`, runId: f.runId, vmId: vm, issuedAt: now-5, expiresAt: now+600, keyId: "test-key"}});
    await f.db.pool.query("UPDATE app.runs SET execution_handle=$3,execution_config=$4 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, {id: vm}, {connectionId: "local", executionProvider: "exe"}]);
    const token = await sign({iss: exeIssuer, sub: exeSubject});
    let attachments = [`vm:${vm}`];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://exe.dev/exec") {
        expect(init?.body).toBe("integrations list --json");
        expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer private-exe-token");
        return Response.json([{name: integrationName, type: "wif", config: {issuer_id: "test-run", subject: exeSubject, audience: `factorize://runs/${f.runId}`}, attachments}]);
      }
      if (String(input) === `${exeIssuer}/.well-known/openid-configuration`) return Response.json({issuer: exeIssuer, jwks_uri: `${exeIssuer}/keys`});
      if (String(input) === `${exeIssuer}/keys`) return Response.json({keys: [{...jwk, kid: "test-key"}]});
      throw new Error("Unexpected request");
    }));
    expect(await authenticateVendorRunRequest(request(token), f.env)).toMatchObject({tenantId: f.tenantId, authMethod: "vendor_identity"});
    for (const changed of [[`vm:${vm}`, "tag:all-runs"], ["vm:another-vm"], ["auto:all"], []]) {
      attachments = changed;
      expect(await authenticateVendorRunRequest(request(token), f.env)).toBeNull();
    }
  });

  it("forwards only the run's selected managed bearer and stops after disconnect or cancellation", async () => {
    const records = new EncryptedIntegrationRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    const id = crypto.randomUUID(), otherId = crypto.randomUUID();
    await records.write({id, kind: "bearer", name: "selected", origin: "https://selected.example.com", description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "upsert", managedSecret: "selected-secret"});
    await new EncryptedIntegrationRepository(f.db, f.otherTenant, f.env.CREDENTIAL_ENCRYPTION_KEY).write({id: otherId, kind: "bearer", name: "other", origin: "https://other.example.com", description: null, expectedRevision: 0, idempotencyKey: crypto.randomUUID(), operation: "upsert", managedSecret: "other-tenant-secret"});
    await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config || $3::jsonb WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, JSON.stringify({portableIntegrationIds: [id]})]);
    const vendorFetch = globalThis.fetch;
    const outbound: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(issuer)) return vendorFetch(input, init);
      expect(String(input)).toBe("https://selected.example.com/resource?limit=1");
      expect((init!.headers as Headers).get("Authorization")).toBe("Bearer selected-secret");
      expect((init!.headers as Headers).has("X-Factorize-Run-Id")).toBe(false);
      outbound.push(String(input)); return new Response("selected response");
    }));
    const call = (credentialId = id) => worker.fetch(request(jwt, f.runId, `/internal/run-proxy/${f.runId}/integrations/${credentialId}/resource?limit=1`), f.env, {waitUntil() {}} as any);
    expect(await (await call()).text()).toBe("selected response");
    const reflected = await worker.fetch(request(jwt, f.runId, "/api/v1/runtime-integrations"), f.env, {waitUntil() {}} as any);
    expect(reflected.status).toBe(200);
    const metadata = await reflected.json() as any;
    expect(metadata.integrations).toEqual([{id, name: "selected", description: null, path: `/integrations/${id}/`, available: true}]);
    expect(JSON.stringify(metadata)).not.toMatch(/selected-secret|other-tenant-secret|selected\.example\.com|other\.example\.com/);

    expect((await call(otherId)).status).toBe(403);
    // Even a corrupt/foreign selection cannot escape the authenticated tenant.
    await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config || $3::jsonb WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, JSON.stringify({portableIntegrationIds: [id, otherId]})]);
    expect((await call(otherId)).status).toBe(403);
    await records.write({id, kind: "bearer", name: "selected", origin: "https://selected.example.com", description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "delete"});
    expect((await call()).status).toBe(403);
    await records.write({id, kind: "bearer", name: "selected", origin: "https://selected.example.com", description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "upsert", managedSecret: "selected-secret"});
    expect((await call()).status).toBe(403); // Reusing the ID cannot revive a disconnected grant.
    const disconnected = await worker.fetch(request(jwt, f.runId, "/api/v1/runtime-integrations"), f.env, {waitUntil() {}} as any);
    expect((await disconnected.json() as any).integrations[0].available).toBe(false);

    await f.db.pool.query("UPDATE app.job_runs SET state='stopping' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect((await call()).status).toBe(403);
    expect(outbound).toHaveLength(1);
  });

  it("reuses selected GitHub and Linear connections for API and Git protocol requests", async () => {
    const installationId = 424242;
    const github = new GitHubRepository(f.db, f.tenantId);
    await github.save({installationId, accountLogin: "selected-org", accountType: "Organization", state: "active"});
    const connections = new ConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await connections.put("linear", {accessToken: "selected-linear", refreshToken: "linear-refresh", accessTokenExpiresAt: new Date(Date.now()+3_600_000).toISOString()});
    f.env.GITHUB_APP_ID = "fixture-app";
    const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", privateKey)).toString("base64");
    f.env.GITHUB_APP_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`;
    await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config || $3::jsonb WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, JSON.stringify({githubInstallationIds: [installationId], linearConnectionId: "linear"})]);
    const vendorFetch = globalThis.fetch;
    const sent: Array<{url: string; auth: string | null; body: string; protocol: string | null}> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const address = String(input);
      if (address.startsWith(issuer)) return vendorFetch(input, init);
      if (address === `https://api.github.com/app/installations/${installationId}/access_tokens`) return Response.json({token: "selected-installation-token"});
      const headers = init!.headers as Headers;
      sent.push({url: address, auth: headers.get("Authorization"), body: await new Response(init!.body).text(), protocol: headers.get("Git-Protocol")});
      return new Response("protocol response");
    }));
    const call = (path: string, method = "GET", body?: string) => worker.fetch(new Request(request(jwt, f.runId, `/internal/run-proxy/${f.runId}${path}`), {method, body, headers: {Authorization: `Bearer ${jwt}`, "X-Factorize-Run-Id": f.runId, "Git-Protocol": "version=2"}}), f.env, {waitUntil() {}} as any);
    expect((await call(`/providers/github/${installationId}/graphql`, "POST", "graphql")).status).toBe(200);
    expect((await call(`/providers/github/${installationId}/owner/repo.git/info/refs?service=git-upload-pack`)).status).toBe(200);
    expect((await call(`/providers/github/${installationId}/owner/repo.git/git-upload-pack`, "POST", "fetch-pack")).status).toBe(200);
    expect((await call(`/providers/github/${installationId}/owner/repo.git/git-receive-pack`, "POST", "push-pack")).status).toBe(200);
    expect((await call("/providers/linear/graphql", "POST", "linear-query")).status).toBe(200);
    expect((await call(`/providers/github/${installationId}/raw/owner/repo/main/file`)).status).toBe(200);
    expect((await call(`/providers/github/${installationId}/archive/owner/repo/zip/refs/heads/main`)).status).toBe(200);
    expect(sent.map(value => value.auth)).toEqual(["Bearer selected-installation-token", ...Array(3).fill(`Basic ${btoa("x-access-token:selected-installation-token")}`), "Bearer selected-linear", "Bearer selected-installation-token", "Bearer selected-installation-token"]);
    expect(sent[5]?.url).toBe("https://raw.githubusercontent.com/owner/repo/main/file");
    expect(sent[6]?.url).toBe("https://codeload.github.com/owner/repo/zip/refs/heads/main");
    expect(sent[2]).toMatchObject({url: "https://github.com/owner/repo.git/git-upload-pack", body: "fetch-pack", protocol: "version=2"});
    expect(sent[3]?.body).toBe("push-pack");
    expect((await call("/providers/github/99999/graphql", "POST", "unselected")).status).toBe(403);
    await github.delete(installationId);
    await connections.delete("linear");
    expect((await call(`/providers/github/${installationId}/graphql`, "POST", "disconnected")).status).toBe(403);
    expect((await call("/providers/linear/graphql", "POST", "disconnected")).status).toBe(403);
    await github.save({installationId, accountLogin: "selected-org", accountType: "Organization", state: "active"});
    await connections.put("linear", {accessToken: "reconnected-linear", refreshToken: "new-refresh", accessTokenExpiresAt: new Date(Date.now()+3_600_000).toISOString()});
    expect((await call(`/providers/github/${installationId}/graphql`, "POST", "reconnected")).status).toBe(403);
    expect((await call("/providers/linear/graphql", "POST", "reconnected")).status).toBe(403);
    expect(sent).toHaveLength(7);
  });

  it("refreshes the selected model server-side, streams it, restores after restart, and revokes on disconnect", async () => {
    const records = new EncryptedIntegrationRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    const id = crypto.randomUUID();
    const access = (exp: number) => `${encode({alg: "none"})}.${encode({exp})}.upstream-fixture`;
    const old = access(Math.floor(Date.now()/1000)-5), renewed = access(Math.floor(Date.now()/1000)+3600);
    await records.write({id, kind: "model", name: "selected-model", origin: null, description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "upsert", managedModelPayload: JSON.stringify({tokens: {access_token: old, refresh_token: "old-refresh", account_id: "selected-account"}})});
    await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config || $3::jsonb WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, JSON.stringify({modelAccess: "portable", modelAccountId: id})]);
    const vendorFetch = globalThis.fetch;
    let refreshes = 0, requests = 0, failRefresh = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(issuer)) return vendorFetch(input, init);
      if (String(input) === "https://auth.openai.com/oauth/token") {
        refreshes++;
        expect(JSON.parse(String(init!.body))).toMatchObject({grant_type: "refresh_token", refresh_token: "old-refresh"});
        if (failRefresh) return Response.json({error: "invalid_grant"}, {status: 400});
        return Response.json({access_token: renewed, refresh_token: "rotated-refresh"});
      }
      expect(String(input)).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect((init!.headers as Headers).get("Authorization")).toBe(`Bearer ${renewed}`);
      expect((init!.headers as Headers).get("chatgpt-account-id")).toBe("selected-account");
      requests++;
      return new Response("data: model-stream\n\n", {headers: {"Content-Type": "text/event-stream"}});
    }));
    const call = () => worker.fetch(new Request(request(jwt, f.runId, `/internal/run-proxy/${f.runId}/providers/model/v1/responses`), {method: "POST", body: "model-input"}), f.env, {waitUntil() {}} as any);
    const concurrent = await Promise.all([call(), call()]);
    for (const response of concurrent) expect(await response.text()).toBe("data: model-stream\n\n");
    const restored = await new EncryptedIntegrationRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(id, "model");
    expect(JSON.parse(restored!.payload).tokens.refresh_token).toBe("rotated-refresh");
    expect((await call()).status).toBe(200);
    expect(refreshes).toBe(1);
    failRefresh = true;
    await records.write({id, kind: "model", name: "selected-model", origin: null, description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "upsert", managedModelPayload: JSON.stringify({tokens: {access_token: old, refresh_token: "old-refresh", account_id: "selected-account"}})});
    expect((await call()).status).toBe(502); // Failed refresh never uses the expired credential.
    await records.write({id, kind: "model", name: "selected-model", origin: null, description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "delete"});
    expect((await call()).status).toBe(403);
    await records.write({id, kind: "model", name: "selected-model", origin: null, description: null, expectedRevision: await records.revision(), idempotencyKey: crypto.randomUUID(), operation: "upsert", managedModelPayload: JSON.stringify({tokens: {access_token: renewed, refresh_token: "new-refresh", account_id: "selected-account"}})});
    expect((await call()).status).toBe(403);
    expect(requests).toBe(3);
  });

  it("requires vendor identity as well as a matching artifact grant, including finalization", async () => {
    const grant = await issueArtifactUploadGrant({tenantId: f.tenantId, runId: f.runId, path: "native/session.jsonl", contentType: "application/x-ndjson", provider: "claude", format: "jsonl", expiresAt: Date.now()+60_000}, f.env.SESSION_SIGNING_SECRET);
    const path = `/internal/run-artifacts/${encodeURIComponent(grant)}`;
    const put = (value = request(jwt, f.runId, path)) => worker.fetch(new Request(value, {method: "PUT", body: "artifact"}), f.env, {waitUntil() {}} as any);
    expect((await put(new Request(f.env.APP_ORIGIN+path))).status).toBe(401);
    expect((await put()).status).toBe(503); // Authentication passed; this fixture deliberately has no R2 storage.
    const foreign = await issueArtifactUploadGrant({tenantId: f.otherTenant, runId: f.runId, path: "native/session.jsonl", contentType: "application/x-ndjson", provider: "claude", format: "jsonl", expiresAt: Date.now()+60_000}, f.env.SESSION_SIGNING_SECRET);
    expect((await put(request(jwt, f.runId, `/internal/run-artifacts/${encodeURIComponent(foreign)}`))).status).toBe(401);
    await f.db.pool.query("UPDATE app.job_runs SET state='stopping' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect((await worker.fetch(request(), f.env, {waitUntil() {}} as any)).status).toBe(401);
    expect((await put()).status).toBe(503); // Only the signed, run-bound finalization protocol remains eligible.
    await f.db.pool.query("UPDATE app.job_runs SET state='stopped' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect((await put()).status).toBe(401);
  });

  it("rejects old run bearer and credential-proxy control authentication paths", async () => {
    const obsolete = `fzt_run_${Buffer.from(f.runId).toString("base64url")}_${"A".repeat(43)}`;
    const response = await worker.fetch(new Request(f.env.APP_ORIGIN+"/api/v1/runtime-context", {headers: {Authorization: `Bearer ${obsolete}`}}), f.env, {waitUntil() {}} as any);
    expect(response.status).toBe(401);
    const control = await worker.fetch(new Request(f.env.APP_ORIGIN+"/internal/credential-proxy/enroll", {method: "POST", headers: {Authorization: "Bearer old-proxy-control-secret"}, body: "{}"}), f.env, {waitUntil() {}} as any);
    expect(control.status).toBe(404);
  });

  it("rechecks current run lifecycle, revocation, handle and execution connection", async () => {
    for (const state of ["queued", "reserved", "stopping", "stopped", "succeeded", "failed"]) {
      await f.db.pool.query("UPDATE app.job_runs SET state=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, state]);
      expect(await authenticateVendorRunRequest(request(), f.env), state).toBeNull();
    }
    await f.db.pool.query("UPDATE app.job_runs SET state='running' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.vendor_run_identity_bindings SET revoked_at=now() WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    expect(await authenticateVendorRunRequest(request(), f.env)).toBeNull();
    await f.db.pool.query("UPDATE app.vendor_run_identity_bindings SET revoked_at=NULL WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET execution_handle=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, {id: "run-app/other-machine"}]);
    expect(await authenticateVendorRunRequest(request(), f.env)).toBeNull();
    await f.db.pool.query("UPDATE app.runs SET execution_handle=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, {id: `run-app/${machineId}`}]);
    const fly = new FlyConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await fly.remove();
    expect(await authenticateVendorRunRequest(request(), f.env)).toBeNull();
    await fly.save({organizationSlug: "connected-org", organizationName: "Reconnected"}, "new-fixture-token");
    expect(await authenticateVendorRunRequest(request(), f.env)).toBeNull();
  });
});

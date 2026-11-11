import { describe, expect, it, vi } from "vitest";
import { proxyControlFetch } from "../src/proxy-control";
import { encrypt } from "../src/crypto";

const token = `fzc_${"A".repeat(43)}`;
const bootEpoch = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;

function envFor({ credentialFound = true, stateSaved = true } = {}) {
  const transactionQuery = vi.fn(async (sql: string) => {
    if (sql.includes("credential_proxy_control_credentials")) return { rows: credentialFound ? [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture" }] : [], rowCount: credentialFound ? 1 : 0 };
    if (sql.includes("INSERT INTO app.credential_proxy_states")) return { rows: stateSaved ? [{ tenant_id: "11111111-1111-4111-8111-111111111111" }] : [], rowCount: stateSaved ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
  const query = vi.fn(async (sql: string) => sql.includes("proxy_token_digest")
    ? { rows: credentialFound ? [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture", boot_epoch: bootEpoch }] : [], rowCount: credentialFound ? 1 : 0 }
    : sql.includes("FROM app.run_credentials")
      ? { rows: credentialFound ? [{ tenant_id: "11111111-1111-4111-8111-111111111111", user_id: "owner-fixture", session_version: 1, job_id: "job-fixture", scopes: ["integrations:read"] }] : [], rowCount: credentialFound ? 1 : 0 }
      : { rows: [], rowCount: 0 });
  return { DATABASE: { pool: { query }, transaction: (work: (client: any) => Promise<unknown>) => work({ query: transactionQuery }) }, transactionQuery, query } as any;
}

function request({ authorization, body = { bootEpoch }, method = "POST", path = "/internal/credential-proxy/register-boot" }: { authorization?: string; body?: unknown; method?: string; path?: string } = {}) {
  return new Request(`https://factorize.example${path}`, { method, headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: method === "POST" ? JSON.stringify(body) : undefined });
}

describe("dedicated proxy boot registration endpoint", () => {
  it("binds registration to the proxy identity owned by its distinct control credential", async () => {
    const env = envFor();
    const response = await proxyControlFetch(request({ authorization: `Bearer ${token}` }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch, controlCredential: expect.stringMatching(/^fzc_[A-Za-z0-9_-]{43}$/) });
    expect(env.transactionQuery.mock.calls.map((call: any[]) => call[0])).toHaveLength(4);
    expect(env.transactionQuery.mock.calls[0][0]).toContain("boot_epoch=$2 AND revoked_at IS NULL AND consumed_at IS NULL");
    expect(env.transactionQuery.mock.calls[2][0]).toContain("consumed_at=now()");
  });

  it("rejects guest job tokens before database access", async () => {
    const env = envFor();
    const response = await proxyControlFetch(request({ authorization: `Bearer fzt_run_${"B".repeat(32)}` }), env);
    expect(response.status).toBe(401);
    expect(env.transactionQuery).not.toHaveBeenCalled();
  });

  it("rejects revoked credentials, disabled proxy identities and tenant or proxy substitution", async () => {
    for (const env of [envFor({ credentialFound: false }), envFor({ stateSaved: false })]) {
      const response = await proxyControlFetch(request({ authorization: `Bearer ${token}` }), env);
      expect(response.status).toBe(403);
    }
  });

  it("validates the endpoint, method and exact boot payload", async () => {
    const env = envFor();
    expect((await proxyControlFetch(new Request("https://factorize.example/internal/credential-proxy/register-boot", { method: "GET" }), env)).status).toBe(405);
    expect((await proxyControlFetch(request({ authorization: `Bearer ${token}`, body: { bootEpoch, tenantId: "attacker-tenant" } }), env)).status).toBe(400);
    expect(env.transactionQuery).not.toHaveBeenCalled();
  });

  it("bounds registration payloads before parsing", async () => {
    const env = envFor();
    const response = await proxyControlFetch(request({ authorization: `Bearer ${token}`, body: { bootEpoch, padding: "x".repeat(2_000) } }), env);
    expect(response.status).toBe(413);
    expect(env.transactionQuery).not.toHaveBeenCalled();
  });

  it("issues a short-lived enrollment only through the registered proxy identity", async () => {
    const env = envFor();
    env.transactionQuery.mockImplementation(async (sql: string) => sql.includes("SELECT g.grant_revision")
      ? { rows: [{ grant_revision: 3 }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    const response = await proxyControlFetch(request({
      authorization: `Bearer ${token}`,
      path: "/internal/credential-proxy/enroll",
      body: { runId, vmIdentity: "fly:vm-123", runCredential },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ grantRevision: 3, enrollmentId: expect.any(String), token: expect.any(String) });
    expect(env.query).toHaveBeenCalled();
    expect(env.query.mock.calls.some((call: any[]) => call[0].includes("FROM app.run_credentials"))).toBe(true);
    expect(env.transactionQuery.mock.calls[0][0]).toContain("JOIN app.credential_proxy_states");
  });

  it("refuses enrollment when the run credential is absent, invalid, cross-tenant, mismatched, or lacks integration scope", async () => {
    for (const [body, expectedStatus] of [
      [{ runId, vmIdentity: "fly:vm-123" }, 400],
      [{ runId, vmIdentity: "fly:vm-123", runCredential: "fzt_run_invalid" }, 403],
      [{ runId: "44444444-4444-4444-8444-444444444444", vmIdentity: "fly:vm-123", runCredential }, 403],
    ] as const) {
      const env = envFor();
      expect((await proxyControlFetch(request({ authorization: `Bearer ${token}`, path: "/internal/credential-proxy/enroll", body }), env)).status).toBe(expectedStatus);
      expect(env.transactionQuery).not.toHaveBeenCalled();
    }
    const crossTenant = envFor();
    crossTenant.query.mockImplementation(async (sql: string) => sql.includes("proxy_token_digest")
      ? { rows: [{ tenant_id: "other-tenant", proxy_identity: "proxy-fixture", boot_epoch: bootEpoch }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    expect((await proxyControlFetch(request({ authorization: `Bearer ${token}`, path: "/internal/credential-proxy/enroll", body: { runId, vmIdentity: "fly:vm-123", runCredential } }), crossTenant)).status).toBe(403);
    const noScope = envFor();
    noScope.query.mockImplementation(async (sql: string) => sql.includes("proxy_token_digest")
      ? { rows: [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture", boot_epoch: bootEpoch }], rowCount: 1 }
      : sql.includes("FROM app.run_credentials")
        ? { rows: [{ tenant_id: "11111111-1111-4111-8111-111111111111", user_id: "owner-fixture", session_version: 1, job_id: "job-fixture", scopes: ["runs:read"] }], rowCount: 1 }
        : { rows: [], rowCount: 0 });
    expect((await proxyControlFetch(request({ authorization: `Bearer ${token}`, path: "/internal/credential-proxy/enroll", body: { runId, vmIdentity: "fly:vm-123", runCredential } }), noScope)).status).toBe(403);
    expect(noScope.transactionQuery).not.toHaveBeenCalled();
  });

  it("consumes enrollment against the authenticated proxy boot and rejects untrusted extra bindings", async () => {
    const env = envFor();
    env.transactionQuery.mockImplementation(async (sql: string) => sql.includes("UPDATE app.credential_run_enrollments")
      ? { rows: [{ id: "44444444-4444-4444-8444-444444444444", grant_revision: 3 }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    const accepted = await proxyControlFetch(request({
      authorization: `Bearer ${token}`,
      path: "/internal/credential-proxy/consume-enrollment",
      body: { runId: "33333333-3333-4333-8333-333333333333", vmIdentity: "fly:vm-123", enrollmentToken: "e".repeat(43) },
    }), env);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ consumed: true, binding: { bootEpoch, proxyIdentity: "proxy-fixture", vmIdentity: "fly:vm-123" } });
    const rejected = await proxyControlFetch(request({ authorization: `Bearer ${token}`, path: "/internal/credential-proxy/enroll", body: { runId: "33333333-3333-4333-8333-333333333333", vmIdentity: "fly:vm-123", tenantId: "other" } }), env);
    expect(rejected.status).toBe(400);
  });

  it("returns only the current run's selected user-encrypted bearer records to its registered proxy", async () => {
    const integrationId = "55555555-5555-4555-8555-555555555555";
    const key = Buffer.alloc(32, 7).toString("base64");
    const env = envFor();
    env.CREDENTIAL_ENCRYPTION_KEY = key;
    env.query.mockImplementation(async (sql: string) => {
      if (sql.includes("proxy_token_digest")) return { rows: [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture", boot_epoch: bootEpoch }], rowCount: 1 };
      if (sql.includes("FROM app.runs r")) return { rows: [{ execution_config: { portableIntegrationIds: [integrationId] }, grant_revision: 3 }], rowCount: 1 };
      if (sql.includes("FROM app.integration_records")) return { rows: [
        { id: integrationId, kind: "bearer", name: "selected", origin: "https://api.example", description: null, revision: 4, encrypted_payload: await encrypt("user-ciphertext", key) },
        { id: "66666666-6666-4666-8666-666666666666", kind: "bearer", name: "not-selected", origin: "https://other.example", description: null, revision: 5, encrypted_payload: await encrypt("other-ciphertext", key) },
      ], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });
    const response = await proxyControlFetch(request({
      authorization: `Bearer ${token}`,
      path: "/internal/credential-proxy/integration-snapshot",
      body: { runId, grantRevision: 3 },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId: "11111111-1111-4111-8111-111111111111", records: [
      { id: integrationId, kind: "bearer", name: "selected", origin: "https://api.example", description: null, revision: 4, encryptedPayload: "user-ciphertext" },
    ] });
    expect(env.query.mock.calls.map((call: any[]) => call[0])).toEqual(expect.arrayContaining([expect.stringContaining("grant_revision=$5"), expect.stringContaining("FROM app.integration_records")]));
  });

  it("returns durable revoked runs only for the authenticated current proxy boot", async () => {
    const env = envFor();
    env.query.mockImplementation(async (sql: string) => sql.includes("proxy_token_digest")
      ? { rows: [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture", boot_epoch: bootEpoch }], rowCount: 1 }
      : { rows: [{ run_id: runId }], rowCount: 1 });
    const response = await proxyControlFetch(request({
      authorization: `Bearer ${token}`,
      path: "/internal/credential-proxy/revocations",
      body: { bootEpoch },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revokedRunIds: [runId] });
    expect(env.query.mock.calls[1][0]).toContain("revoked_at IS NOT NULL");
    expect(env.query.mock.calls[1][1]).toEqual(["11111111-1111-4111-8111-111111111111", "proxy-fixture", bootEpoch]);
    const stale = await proxyControlFetch(request({
      authorization: `Bearer ${token}`,
      path: "/internal/credential-proxy/revocations",
      body: { bootEpoch: "44444444-4444-4444-8444-444444444444" },
    }), env);
    expect(stale.status).toBe(400);
  });
});

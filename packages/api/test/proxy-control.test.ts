import { describe, expect, it, vi } from "vitest";
import { proxyControlFetch } from "../src/proxy-control";

const token = `fzc_${"A".repeat(43)}`;
const bootEpoch = "22222222-2222-4222-8222-222222222222";

function envFor({ credentialFound = true, stateSaved = true } = {}) {
  const transactionQuery = vi.fn(async (sql: string) => {
    if (sql.includes("credential_proxy_control_credentials")) return { rows: credentialFound ? [{ tenant_id: "11111111-1111-4111-8111-111111111111", proxy_identity: "proxy-fixture" }] : [], rowCount: credentialFound ? 1 : 0 };
    if (sql.includes("INSERT INTO app.credential_proxy_states")) return { rows: stateSaved ? [{ tenant_id: "11111111-1111-4111-8111-111111111111" }] : [], rowCount: stateSaved ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
  return { DATABASE: { pool: { query: vi.fn() }, transaction: (work: (client: any) => Promise<unknown>) => work({ query: transactionQuery }) }, transactionQuery } as any;
}

function request({ authorization, body = { bootEpoch }, method = "POST" }: { authorization?: string; body?: unknown; method?: string } = {}) {
  return new Request("https://factorize.example/internal/credential-proxy/register-boot", { method, headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: method === "POST" ? JSON.stringify(body) : undefined });
}

describe("dedicated proxy boot registration endpoint", () => {
  it("binds registration to the proxy identity owned by its distinct control credential", async () => {
    const env = envFor();
    const response = await proxyControlFetch(request({ authorization: `Bearer ${token}` }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch });
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
});

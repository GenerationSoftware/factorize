import { describe, expect, it, vi } from "vitest";
import { ProxyControlRepository } from "../src/postgres/proxy-control-repository";

function database(query: ReturnType<typeof vi.fn>, transactionQuery = query) {
  return { pool: { query }, transaction: (work: (client: any) => Promise<unknown>) => work({ query: transactionQuery }) } as any;
}

describe("dedicated credential proxy control identity", () => {
  it("issues a scoped one-time secret and stores only its digest", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new ProxyControlRepository(database(query));
    const token = await repository.provisionCredential("11111111-1111-4111-8111-111111111111", "proxy-a", "22222222-2222-4222-8222-222222222222");
    expect(token).toMatch(/^fzc_[A-Za-z0-9_-]{43}$/);
    const stored = query.mock.calls[0][1][3] as Buffer;
    expect(stored).toBeInstanceOf(Buffer);
    expect(stored.toString()).not.toContain(token);
    expect(stored.byteLength).toBe(32);
  });

  it("authenticates only a live credential and never accepts a guest run token", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: "tenant-a", proxy_identity: "proxy-a" }], rowCount: 1 });
    const repository = new ProxyControlRepository(database(query));
    expect(await repository.authenticate("fzt_run_" + "a".repeat(43))).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(await repository.authenticate("fzc_" + "a".repeat(43))).toEqual({ tenantId: "tenant-a", proxyIdentity: "proxy-a" });
  });

  it("registers a fresh boot for its credential identity and rejects revoked, disabled, or mismatched identities", async () => {
    const identity = { tenant_id: "tenant-a", proxy_identity: "proxy-a" };
    const credentialQuery = vi.fn().mockResolvedValue({ rows: [identity], rowCount: 1 });
    const stateQuery = vi.fn().mockResolvedValue({ rows: [{ tenant_id: identity.tenant_id }], rowCount: 1 });
    const repository = new ProxyControlRepository(database(vi.fn(), vi.fn()));
    const tx = { query: vi.fn().mockImplementation((sql: string) => sql.includes("credential_proxy_control_credentials") ? credentialQuery() : sql.includes("INSERT INTO app.credential_proxy_states") ? stateQuery() : Promise.resolve({ rows: [], rowCount: 1 })) };
    (repository as any).database = { transaction: (work: (client: any) => Promise<unknown>) => work(tx) };
    const epoch = "22222222-2222-4222-8222-222222222222";
    const registration = await repository.registerBoot("fzc_" + "a".repeat(43), epoch);
    expect(registration).toMatchObject({ tenantId: identity.tenant_id, proxyIdentity: identity.proxy_identity, bootEpoch: epoch });
    expect(registration?.controlCredential).toMatch(/^fzc_[A-Za-z0-9_-]{43}$/);
    expect(tx.query.mock.calls.map(call => call[0])).toHaveLength(4);
    expect(tx.query.mock.calls[0][0]).toContain("boot_epoch=$2 AND revoked_at IS NULL AND consumed_at IS NULL");
    expect(tx.query.mock.calls[2][0]).toContain("consumed_at=now()");
    expect(tx.query.mock.calls[3][0]).toContain("boot_epoch<>$3");
    credentialQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await repository.registerBoot("fzc_" + "a".repeat(43), epoch)).toBeNull();
  });

  it("rejects malformed boot epochs before opening a transaction", async () => {
    const transaction = vi.fn();
    const repository = new ProxyControlRepository({ transaction, pool: { query: vi.fn() } } as any);
    await expect(repository.registerBoot("fzc_" + "a".repeat(43), "old-boot")).rejects.toThrow("bootEpoch must be a UUID");
    expect(transaction).not.toHaveBeenCalled();
  });
});

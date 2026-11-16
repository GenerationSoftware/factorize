import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "../src/postgres/database";
import { VendorRunIdentityRepository } from "../src/postgres/vendor-run-identity-repository";
import type { VendorIdentity } from "../src/vendor-run-identity";
import { verifyAndPersistVendorRunIdentity } from "../src/vendor-run-identity-provisioning";

const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("durable vendor run identity bindings (PostgreSQL)", () => {
  let db: Database;
  const tenants: string[] = [];
  beforeAll(async () => {
    db = new Database({ connectionString: url, max: 24, maxUses: Infinity });
    expect((await db.pool.query("SELECT to_regclass('app.vendor_run_identity_bindings') AS bindings")).rows[0]?.bindings).toBe("app.vendor_run_identity_bindings");
  }, 30_000);
  afterAll(async () => { if (db) { await db.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [tenants]); await db.close(); } });

  async function fixture(state = "running", identityOverrides: Partial<VendorIdentity> = {}) {
    const tenantId = crypto.randomUUID(), jobId = crypto.randomUUID(), triggerId = crypto.randomUUID(), invocationId = crypto.randomUUID(), runId = crypto.randomUUID();
    tenants.push(tenantId);
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    await db.pool.query("INSERT INTO app.projects(tenant_id,id,name) VALUES ($1,md5(($1::uuid)::text || ':default')::uuid,'Default')", [tenantId]);
    await db.pool.query("INSERT INTO app.jobs(tenant_id,id,project_id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES ($1,$2,md5(($1::uuid)::text || ':default')::uuid,'Identity test','identity-test','test','{}',1)", [tenantId, jobId]);
    await db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenantId, triggerId, jobId]);
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','identity-test',$4,'{}')", [tenantId, invocationId, jobId, triggerId]);
    await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,$5,'test')", [tenantId, runId, jobId, invocationId, state]);
    const identity: VendorIdentity = {
      provider: "fly.io", runId, vmId: `fm-${crypto.randomUUID()}`, issuer: "https://oidc.fly.io/factorize-test",
      subject: `test:factorize-test:${crypto.randomUUID()}`, audience: `factorize://runs/${runId}`, issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_600, keyId: "fixture-key", ...identityOverrides,
    };
    return { tenantId, runId, identity, repository: new VendorRunIdentityRepository(db), now: new Date(identity.issuedAt * 1000) };
  }

  it("persists one verified identity, renews expiry without rebinding, and rejects mismatches", async () => {
    const f = await fixture();
    const first = await f.repository.persistVerified({ tenantId: f.tenantId, identity: f.identity, issuedAt: f.identity.issuedAt, now: f.now });
    expect(first).toMatchObject({ tenantId: f.tenantId, runId: f.runId, provider: "fly.io", vmId: f.identity.vmId, issuer: f.identity.issuer, subject: f.identity.subject, audience: f.identity.audience });
    expect(await f.repository.getActive({ tenantId: f.tenantId, runId: f.runId, provider: "fly.io", now: f.now })).toMatchObject({ subject: f.identity.subject });

    const renewed = { ...f.identity, issuedAt: f.identity.issuedAt + 60, expiresAt: f.identity.expiresAt + 60 };
    await expect(f.repository.persistVerified({ tenantId: f.tenantId, identity: renewed, issuedAt: renewed.issuedAt, now: new Date(renewed.issuedAt * 1000) })).resolves.toMatchObject({ vmId: f.identity.vmId, expiresAt: new Date(renewed.expiresAt * 1000) });
    await expect(f.repository.persistVerified({ tenantId: f.tenantId, identity: { ...renewed, vmId: "different-machine" }, issuedAt: renewed.issuedAt, now: new Date(renewed.issuedAt * 1000) })).rejects.toThrow("does not match the persisted run binding");
  });

  it("enforces VM and subject uniqueness and rejects revoked, expired, and inactive bindings", async () => {
    const original = await fixture();
    await original.repository.persistVerified({ tenantId: original.tenantId, identity: original.identity, issuedAt: original.identity.issuedAt, now: original.now });
    const another = await fixture();
    await expect(another.repository.persistVerified({ tenantId: another.tenantId, identity: { ...another.identity, vmId: original.identity.vmId }, issuedAt: another.identity.issuedAt, now: another.now })).rejects.toThrow("already bound to another run");
    await expect(another.repository.persistVerified({ tenantId: another.tenantId, identity: { ...another.identity, subject: original.identity.subject, audience: original.identity.audience }, issuedAt: another.identity.issuedAt, now: another.now })).rejects.toThrow("already bound to another run");

    expect(await original.repository.revoke({ tenantId: original.tenantId, runId: original.runId, provider: "fly.io", now: original.now })).toBe(true);
    expect(await original.repository.getActive({ tenantId: original.tenantId, runId: original.runId, provider: "fly.io", now: original.now })).toBeNull();
    await expect(original.repository.persistVerified({ tenantId: original.tenantId, identity: original.identity, issuedAt: original.identity.issuedAt, now: original.now })).rejects.toThrow("binding is revoked");

    const ended = await fixture("succeeded");
    await expect(ended.repository.persistVerified({ tenantId: ended.tenantId, identity: ended.identity, issuedAt: ended.identity.issuedAt, now: ended.now })).rejects.toThrow("run is not active");

    const expired = await fixture();
    await expired.repository.persistVerified({ tenantId: expired.tenantId, identity: expired.identity, issuedAt: expired.identity.issuedAt, now: expired.now });
    expect(await expired.repository.getActive({ tenantId: expired.tenantId, runId: expired.runId, provider: "fly.io", now: new Date(expired.identity.expiresAt * 1000) })).toBeNull();
  }, 30_000);

  it("verifies a signed Fly token before persisting and renewing its active VM binding", async () => {
    const f = await fixture();
    const issuer = f.identity.issuer, audience = `factorize://runs/${f.runId}`, subject = f.identity.subject;
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const base64url = (value: Uint8Array) => Buffer.from(value).toString("base64url");
    const sign = async (issuedAt: number, machineId = f.identity.vmId) => {
      const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "fixture-key" })));
      const payload = base64url(new TextEncoder().encode(JSON.stringify({ iss: issuer, sub: subject, aud: audience, iat: issuedAt, exp: issuedAt + 600, machine_id: machineId })));
      const input = `${header}.${payload}`;
      const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input)));
      return `${input}.${base64url(signature)}`;
    };
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/.well-known/openid-configuration")
      ? Response.json({ issuer, jwks_uri: `${issuer}/keys` })
      : Response.json({ keys: [{ ...jwk, kid: "fixture-key", use: "sig" }] }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const first = await sign(now - 5);
      await expect(verifyAndPersistVendorRunIdentity({ database: db, tenantId: f.tenantId, runId: f.runId, provider: "fly.io", vmId: f.identity.vmId, token: first, audience, expectedIssuer: issuer, now: new Date(now * 1000) }))
        .resolves.toMatchObject({ provider: "fly.io", vmId: f.identity.vmId, issuer, subject, audience });
      const renewed = await sign(now + 30);
      await expect(verifyAndPersistVendorRunIdentity({ database: db, tenantId: f.tenantId, runId: f.runId, provider: "fly.io", vmId: f.identity.vmId, token: renewed, audience, expectedIssuer: issuer, now: new Date((now + 30) * 1000) }))
        .resolves.toMatchObject({ expiresAt: new Date((now + 630) * 1000) });
      await expect(verifyAndPersistVendorRunIdentity({ database: db, tenantId: f.tenantId, runId: f.runId, provider: "fly.io", vmId: f.identity.vmId, token: await sign(now + 60, "another-machine"), audience, expectedIssuer: issuer, now: new Date((now + 60) * 1000) }))
        .rejects.toThrow("VM mismatch");
      await f.repository.revoke({ tenantId: f.tenantId, runId: f.runId, provider: "fly.io", now: new Date((now + 60) * 1000) });
      await expect(verifyAndPersistVendorRunIdentity({ database: db, tenantId: f.tenantId, runId: f.runId, provider: "fly.io", vmId: f.identity.vmId, token: await sign(now + 90), audience, expectedIssuer: issuer, now: new Date((now + 90) * 1000) }))
        .rejects.toThrow("binding is revoked");
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);
});

import { beforeAll, describe, expect, it } from "vitest";
import { createJwksResolver, discoverVendorIssuerTrust, verifyVendorRunIdentity, type VendorRunBinding } from "../src/vendor-run-identity";

const now = 1_800_000_000;
let privateKey: CryptoKey, publicJwk: JsonWebKey;

function encode(value: unknown) { return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }

async function token(claims: Record<string, unknown>, kid = "key-1", key = privateKey) {
  const head = encode({ alg: "RS256", typ: "JWT", kid }), body = encode(claims), input = `${head}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

const flyBinding: VendorRunBinding = { provider: "fly.io", runId: "run-1", activeRunId: "run-1", vmId: "machine-1", issuer: "https://oidc.fly.io/factorize-app", audience: "factorize-run", subject: "org:factorize-app:run-machine", maxTokenAgeSeconds: 600 };
const claims = { iss: flyBinding.issuer, sub: flyBinding.subject, aud: flyBinding.audience, iat: now - 10, exp: now + 100, machine_id: flyBinding.vmId };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  (publicJwk as JsonWebKey & { kid: string }).kid = "key-1";
});

describe("vendor run identity", () => {
  it("accepts a signed Fly identity bound to the provisioned machine and active run", async () => {
    const identity = await verifyVendorRunIdentity({ token: await token(claims), binding: flyBinding, nowSeconds: now, resolveKey: async kid => kid === "key-1" ? publicJwk : undefined });
    expect(identity).toMatchObject({ provider: "fly.io", runId: "run-1", vmId: "machine-1", subject: flyBinding.subject, issuedAt: now - 10, keyId: "key-1" });
  });

  it("accepts renewed vendor tokens for the same VM while an expired token is rejected", async () => {
    const original = await token({ ...claims, exp: now - 1 });
    const renewed = await token({ ...claims, iat: now, exp: now + 300 });
    await expect(verifyVendorRunIdentity({ token: original, binding: flyBinding, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow("expired");
    await expect(verifyVendorRunIdentity({ token: renewed, binding: flyBinding, nowSeconds: now, resolveKey: async () => publicJwk })).resolves.toMatchObject({ runId: "run-1", vmId: "machine-1" });
  });

  it.each([
    ["wrong issuer", { ...claims, iss: "https://attacker.example" }, flyBinding],
    ["wrong audience", { ...claims, aud: "other" }, flyBinding],
    ["wrong subject", { ...claims, sub: "org:another-app:machine" }, flyBinding],
    ["expired token", { ...claims, exp: now - 1 }, flyBinding],
    ["future token", { ...claims, nbf: now + 100 }, flyBinding],
    ["wrong machine", { ...claims, machine_id: "machine-2" }, flyBinding],
    ["inactive run", claims, { ...flyBinding, activeRunId: "run-2" }],
    ["wrong run binding", claims, { ...flyBinding, runId: "run-2" }],
  ] as const)("rejects %s", async (_case, payload, binding) => {
    await expect(verifyVendorRunIdentity({ token: await token(payload), binding, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow();
  });

  it("requires an exact per-VM exe.dev attachment in addition to the integration subject", async () => {
    const binding: VendorRunBinding = { provider: "exe.dev", runId: "run-1", activeRunId: "run-1", vmId: "factorize-run-1", issuer: "https://exe.dev/issuer/team-workload", audience: "factorize-run", subject: "sub-integration-1", exeAttachment: { integrationName: "factorize-run-1", attachedVmId: "factorize-run-1", mode: "vm" } };
    const payload = { iss: binding.issuer, sub: binding.subject, aud: binding.audience, iat: now - 10, exp: now + 100 };
    await expect(verifyVendorRunIdentity({ token: await token(payload), binding, nowSeconds: now, resolveKey: async () => publicJwk })).resolves.toMatchObject({ provider: "exe.dev", vmId: binding.vmId });
    await expect(verifyVendorRunIdentity({ token: await token({ ...payload, sub: "sub-other-integration" }), binding, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow("subject mismatch");
    await expect(verifyVendorRunIdentity({ token: await token(payload), binding: { ...binding, exeAttachment: { ...binding.exeAttachment!, attachedVmId: "another-vm" } }, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow("VM mismatch");
    await expect(verifyVendorRunIdentity({ token: await token(payload), binding: { ...binding, exeAttachment: undefined }, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow("VM mismatch");
  });

  it("refreshes signing keys when a rotated key ID is not in the cached JWKS", async () => {
    const next = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const rotated = await crypto.subtle.exportKey("jwk", next.publicKey) as JsonWebKey & { kid: string };
    rotated.kid = "key-2";
    const fetches: string[] = [];
    const resolver = createJwksResolver({ jwksUri: "https://issuer.example/keys", now: () => now * 1000, fetcher: async (_url, init) => {
      fetches.push(String(init?.headers ? "requested" : "missing-accept"));
      return Response.json({ keys: fetches.length === 1 ? [publicJwk] : [rotated] });
    } });
    const identity = await verifyVendorRunIdentity({ token: await token(claims, "key-2", next.privateKey), binding: flyBinding, nowSeconds: now, resolveKey: resolver });
    expect(identity.keyId).toBe("key-2");
    expect(fetches).toHaveLength(2);
  });

  it("rejects signatures from keys outside the configured issuer key set", async () => {
    const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    await expect(verifyVendorRunIdentity({ token: await token(claims, "key-1", other.privateKey), binding: flyBinding, nowSeconds: now, resolveKey: async () => publicJwk })).rejects.toThrow("signature");
  });

  it("loads issuer keys only from matching HTTPS metadata on the vendor origin", async () => {
    const calls: string[] = [];
    const trust = await discoverVendorIssuerTrust({ provider: "fly.io", issuer: flyBinding.issuer, fetcher: async input => {
      calls.push(String(input));
      return Response.json({ issuer: flyBinding.issuer, jwks_uri: "https://oidc.fly.io/keys" });
    } });
    expect(trust).toMatchObject({ issuer: flyBinding.issuer, jwksUri: "https://oidc.fly.io/keys" });
    expect(calls).toEqual([`${flyBinding.issuer}/.well-known/openid-configuration`]);
    await expect(discoverVendorIssuerTrust({ provider: "fly.io", issuer: flyBinding.issuer, fetcher: async () => Response.json({ issuer: "https://attacker.example", jwks_uri: "https://attacker.example/keys" }) })).rejects.toThrow("metadata does not match");
    await expect(discoverVendorIssuerTrust({ provider: "fly.io", issuer: "https://attacker.example/app", fetcher: fetch })).rejects.toThrow("not trusted");
    await expect(discoverVendorIssuerTrust({ provider: "exe.dev", issuer: "https://exe.dev/issuer/team-workload", fetcher: async () => Response.json({ issuer: "https://exe.dev/issuer/team-workload", jwks_uri: "https://attacker.example/keys" }) })).rejects.toThrow("keys URL is not trusted");
  });
});

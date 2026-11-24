import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { discoverVendorIssuerTrust, verifyVendorMachineIdentity } from "../src/vm-oidc";

const binding = {
  provider: "fly.io" as const,
  issuer: "https://oidc.fly.io/team",
  audience: "factorize://vm-grants/grant",
  subject: "team:app:workload",
  machineId: "machine1",
};
const now = 1_800_000_000;
const claims = { iss: binding.issuer, sub: binding.subject, aud: binding.audience, machine_id: binding.machineId, iat: now - 5, exp: now + 300 };
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(payload: Record<string, unknown>, kid = "current") {
  const input = json({ alg: "ES256", kid }) + "." + json(payload);
  const signature = sign("sha256", Buffer.from(input), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return input + "." + signature.toString("base64url");
}

describe("VM vendor OIDC", () => {
  const resolveKey = async () => keys.publicKey.export({ format: "jwk" });
  it("accepts a correctly signed token for the exact Machine and grant", async () => {
    await expect(verifyVendorMachineIdentity({ token: token(claims), binding, resolveKey, nowSeconds: now })).resolves.toEqual({ expiresAt: claims.exp });
  });

  it("verifies an RS256 provider token against its published key", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const input = json({ alg: "RS256", kid: "rsa" }) + "." + json(claims);
    const signature = sign("sha256", Buffer.from(input), rsa.privateKey).toString("base64url");
    await expect(verifyVendorMachineIdentity({ token: `${input}.${signature}`, binding,
      resolveKey: async () => rsa.publicKey.export({ format: "jwk" }), nowSeconds: now })).resolves.toEqual({ expiresAt: claims.exp });
  });

  it.each([
    ["issuer", { iss: "https://oidc.fly.io/other-team" }],
    ["subject", { sub: "team:other-app:workload" }],
    ["audience", { aud: "factorize://vm-grants/other" }],
    ["additional audience", { aud: [binding.audience, "another"] }],
    ["different Machine", { machine_id: "machine2" }],
    ["missing Machine", { machine_id: undefined }],
    ["expired token", { exp: now }],
    ["future-issued token", { iat: now + 90 }],
    ["excessive lifetime", { exp: now + 10_000 }],
  ])("rejects a signed token with invalid %s", async (_, change) => {
    await expect(verifyVendorMachineIdentity({ token: token({ ...claims, ...change }), binding, resolveKey, nowSeconds: now })).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const otherKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
    await expect(verifyVendorMachineIdentity({ token: token(claims), binding, resolveKey: async () => otherKey, nowSeconds: now })).rejects.toThrow("signature");
  });

  it("pins discovery and JWKS origins and refreshes for a rotated key", async () => {
    const jwksUri = binding.issuer + "/keys";
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ issuer: binding.issuer, jwks_uri: jwksUri }))
      .mockResolvedValueOnce(Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "previous" }] }))
      .mockResolvedValueOnce(Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "current" }] }))
      .mockResolvedValueOnce(Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "current" }] }));
    const trusted = await discoverVendorIssuerTrust({ ...binding, fetcher });
    await expect(verifyVendorMachineIdentity({ token: token(claims), binding, resolveKey: trusted.resolveKey, nowSeconds: now })).resolves.toBeDefined();
    await expect(verifyVendorMachineIdentity({ token: token(claims, "unknown"), binding, resolveKey: trusted.resolveKey, nowSeconds: now })).rejects.toThrow("signature");

    await expect(discoverVendorIssuerTrust({ ...binding, issuer: "https://untrusted.invalid/team", fetcher })).rejects.toThrow("not trusted");
    fetcher.mockResolvedValueOnce(Response.json({ issuer: binding.issuer, jwks_uri: "https://untrusted.invalid/keys" }));
    await expect(discoverVendorIssuerTrust({ ...binding, fetcher })).rejects.toThrow("not trusted");
  });
});

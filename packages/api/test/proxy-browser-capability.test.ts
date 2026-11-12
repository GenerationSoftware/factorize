import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { issueModelAccountCapability } from "../src/proxy-browser-capability";

describe("proxy browser capabilities", () => {
  it("signs an account/action/origin/boot-bound one-minute EdDSA token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const token = await issueModelAccountCapability({
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      proxyIdentity: "fly:proxy:machine-1", ownerId: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222", action: "authorize",
      appOrigin: "https://factorize.example", generation: "33333333-3333-4333-8333-333333333333",
      now: 1_900_000_000, jti: "one-use-fixture-nonce-123456",
    });
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "EdDSA", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "factorize", aud: "fly:proxy:machine-1", sub: "11111111-1111-4111-8111-111111111111",
      action: "model-account:authorize", accountId: "22222222-2222-4222-8222-222222222222",
      origin: "https://factorize.example", generation: "33333333-3333-4333-8333-333333333333",
      exp: 1_900_000_060, jti: "one-use-fixture-nonce-123456",
    });
    expect(verify(null, Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });
});

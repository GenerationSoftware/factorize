import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAwsIssuer } from "./verify-aws-issuer.mjs";

const origin = "https://factorize.test";
const issuer = origin + "/oauth/aws";
const discovery = issuer + "/.well-known/openid-configuration";
const jwks = issuer + "/jwks";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true, ["sign", "verify"],
);
const { kty, n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey);
const metadata = { issuer, jwks_uri: jwks, id_token_signing_alg_values_supported: ["RS256"] };
const key = { kty, n, e, kid: "test-key", use: "sig", alg: "RS256" };

test("checks only the expected public endpoints, with no redirects", async () => {
  const seen = [];
  assert.equal(await verifyAwsIssuer(origin, async (url, options) => {
    assert.equal(options.redirect, "error");
    seen.push(url);
    return Response.json(url === discovery ? metadata : { keys: [key] });
  }), true);
  assert.deepEqual(seen, [discovery, jwks]);
});

test("distinguishes an absent issuer without calling other endpoints", async () => {
  assert.equal(await verifyAwsIssuer(origin, async url => {
    assert.equal(url, discovery);
    return new Response(null, { status: 404 });
  }), false);
});

test("rejects redirected metadata, empty key sets, and private key fields", async () => {
  await assert.rejects(verifyAwsIssuer(origin, async url => {
    assert.equal(url, discovery);
    return Response.json({ ...metadata, jwks_uri: "https://outside.test/jwks" });
  }), /metadata is invalid/);
  for (const keys of [[], [{ ...key, d: "private" }], [key, key]]) {
    await assert.rejects(verifyAwsIssuer(origin, async url => Response.json(url === discovery ? metadata : { keys })), /JWKS/);
  }
});

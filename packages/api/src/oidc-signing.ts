import { signingConfig } from "./config/runtime";
import { Buffer } from "node:buffer";
import { decrypt, encrypt } from "./crypto";
import { databaseFor } from "./postgres/database";
import type { Env } from "./types";

const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
type Key = { kid: string; public_key: JsonWebKey; encrypted_private_key: string };
const select = "SELECT kid,public_key,encrypted_private_key FROM app.oidc_signing_key WHERE singleton";

async function signingKey(env: Env): Promise<Key> {
  const db = databaseFor(env);
  const existing = (await db.pool.query<Key>(select)).rows[0];
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"]);
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  const encrypted = await encrypt(JSON.stringify(privateKey), signingConfig(env).credentialKey);
  await db.pool.query("INSERT INTO app.oidc_signing_key(public_key,encrypted_private_key) VALUES($1,$2) ON CONFLICT DO NOTHING", [publicKey, encrypted]);
  return (await db.pool.query<Key>(select)).rows[0]!;
}

export async function oidcJwks(env: Env) {
  const key = await signingKey(env);
  return { keys: [{ ...key.public_key, kid: key.kid, use: "sig", alg: "RS256" }] };
}

export async function oidcSigner(env: Env) {
  const key = await signingKey(env);
  const privateJwk = JSON.parse(await decrypt(key.encrypted_private_key, signingConfig(env).credentialKey));
  const secret = await crypto.subtle.importKey("jwk", privateJwk, algorithm, false, ["sign"]);
  return async (claims: object) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = encode({ alg: "RS256", kid: key.kid, typ: "JWT" }) + "." + encode(claims);
    const signature = await crypto.subtle.sign(algorithm, secret, new TextEncoder().encode(input));
    return input + "." + Buffer.from(signature).toString("base64url");
  };
}

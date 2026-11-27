import { Buffer } from "node:buffer";
import { z } from "zod";
import { awsWorkloadConfig } from "../../../config/runtime";
import type { Env } from "../../../types";
import { awsAudience, awsIssuerPath, awsSubject } from "./policy";

const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const publicKey = z.object({
  kty: z.literal("RSA"), kid: base64url.max(64), n: base64url.min(342).max(683), e: base64url.max(8),
});
const privateKey = publicKey.extend({
  d: base64url.max(683), p: base64url.max(342), q: base64url.max(342),
  dp: base64url.max(342), dq: base64url.max(342), qi: base64url.max(342),
});
const keySet = z.object({ active: privateKey, previous: z.array(publicKey).max(2).default([]) });
type AwsIssuer = { issuer: string; active: z.infer<typeof privateKey>; keys: Array<z.infer<typeof publicKey>> };

export function awsIssuer(env: Env): AwsIssuer | null {
  const { origin, keys } = awsWorkloadConfig(env);
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.port || !keys) return null;
    const { active, previous } = keySet.parse(JSON.parse(keys));
    const published = [publicKey.parse(active), ...previous];
    if (new Set(published.map(key => key.kid)).size !== published.length) return null;
    return { issuer: origin + awsIssuerPath, active, keys: published };
  } catch { return null; }
}

export async function signAwsWorkload(config: AwsIssuer, connectionId: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const key = await crypto.subtle.importKey("jwk", { ...config.active, alg: "RS256" }, algorithm, false, ["sign"]);
  const content = encode({ alg: "RS256", typ: "JWT", kid: config.active.kid }) + "." + encode({
    iss: config.issuer, aud: awsAudience, sub: awsSubject(connectionId), iat: now, exp: now + 120,
  });
  const signature = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(content));
  return content + "." + Buffer.from(signature).toString("base64url");
}

/** Publish metadata only. There is no public token issuance endpoint. */
export function awsIssuerResponse(request: Request, env: Env): Response | null {
  const { pathname, origin } = new URL(request.url);
  if (pathname !== awsIssuerPath && !pathname.startsWith(awsIssuerPath + "/")) return null;
  const config = awsIssuer(env);
  if (!config || origin + awsIssuerPath !== config.issuer) return new Response(null, { status: 404 });
  const metadata = pathname === awsIssuerPath + "/.well-known/openid-configuration";
  if (!metadata && pathname !== awsIssuerPath + "/jwks") return new Response(null, { status: 404 });
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  return Response.json(metadata ? {
    issuer: config.issuer, jwks_uri: config.issuer + "/jwks", subject_types_supported: ["public"],
    response_types_supported: ["id_token"], id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: ["iss", "aud", "sub", "iat", "exp"],
  } : { keys: config.keys.map(key => ({ ...key, use: "sig", alg: "RS256" })) }, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

type VendorIdentityProvider = "fly.io" | "exe.dev";

// For exe.dev, the WIF subject identifies an integration. The provider adapter
// must verify machine continuity separately before admitting that identity.
type VmOidcBinding = { issuer: string; subject: string; audience: string } & (
  | { provider: "fly.io"; machineId: string }
  | { provider: "exe.dev" }
);

export type JwksResolver = (keyId: string, refresh: boolean) => Promise<JsonWebKey | undefined>;

export type VendorIssuerTrust = { issuer: string; jwksUri: string; resolveKey: JwksResolver };

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
type JwtClaims = Record<string, unknown> & { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; nbf?: unknown; machine_id?: unknown };

function decodePart(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid vendor identity token encoding");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

function jsonPart<T>(value: string): T {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodePart(value))) as T; }
  catch { throw new Error("Invalid vendor identity token payload"); }
}

function audiences(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value;
  return [];
}

async function verifySignature(alg: string, jwk: JsonWebKey, signingInput: string, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (alg === "RS256" && (jwk.kty === "RSA" || jwk.kty === "RSA-PSS")) {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(signingInput));
  }
  if (alg === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(signingInput));
  }
  return false;
}

export async function verifyVendorMachineIdentity(options: {
  token: string; binding: VmOidcBinding; resolveKey: JwksResolver;
  nowSeconds?: number; clockSkewSeconds?: number;
}) {
  const { token, binding } = options;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error("Invalid vendor identity token");
  const header = jsonPart<JwtHeader>(parts[0]!);
  const claims = jsonPart<JwtClaims>(parts[1]!);
  if ((header.alg !== "RS256" && header.alg !== "ES256") || typeof header.kid !== "string" || !header.kid) throw new Error("Unsupported vendor identity signature");
  const key = await options.resolveKey(header.kid, false) ?? await options.resolveKey(header.kid, true);
  if (!key || !(await verifySignature(header.alg, key, `${parts[0]}.${parts[1]}`, decodePart(parts[2]!)))) throw new Error("Invalid vendor identity signature");

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000), skew = options.clockSkewSeconds ?? 30;
  const maxAge = 900;
  const aud = audiences(claims.aud);
  if (claims.iss !== binding.issuer || aud.length !== 1 || aud[0] !== binding.audience) throw new Error("Vendor identity issuer or audience mismatch");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub !== binding.subject) throw new Error("Vendor identity subject mismatch");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Vendor identity has expired");
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + skew || claims.iat < now - maxAge - skew || claims.exp <= claims.iat || claims.exp - claims.iat > maxAge + skew) throw new Error("Vendor identity lifetime is invalid");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now + skew)) throw new Error("Vendor identity is not yet valid");
  if (binding.provider === "fly.io" && claims.machine_id !== binding.machineId) throw new Error("Vendor identity VM mismatch");

  return { expiresAt: claims.exp };
}

/** A bounded JWKS cache. Unknown kids force one refresh so key rotation fails closed. */
export function createJwksResolver(options: { jwksUri: string; fetcher?: typeof fetch; ttlMs?: number; now?: () => number }): JwksResolver {
  const fetcher = options.fetcher ?? fetch, ttlMs = options.ttlMs ?? 5 * 60_000, now = options.now ?? Date.now;
  let keys = new Map<string, JsonWebKey>(), expiresAt = 0;
  const load = async (force: boolean) => {
    if (!force && keys.size && now() < expiresAt) return;
    const response = await fetcher(options.jwksUri, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Vendor signing keys unavailable (${response.status})`);
    const body = await response.json() as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error("Vendor signing keys response is invalid");
    const next = new Map<string, JsonWebKey>();
    for (const candidate of body.keys) {
      if (!candidate || typeof candidate !== "object") continue;
      const jwk = candidate as JsonWebKey & { kid?: unknown; use?: unknown; alg?: unknown };
      if (typeof jwk.kid === "string" && jwk.kid && (jwk.use === undefined || jwk.use === "sig")) next.set(jwk.kid, jwk);
    }
    if (!next.size) throw new Error("Vendor signing keys response contains no usable keys");
    keys = next; expiresAt = now() + ttlMs;
  };
  return async (keyId, refresh) => {
    await load(refresh);
    return keys.get(keyId);
  };
}

/** Load an OIDC issuer's signing keys only from the documented vendor origin. */
export async function discoverVendorIssuerTrust(options: {
  provider: VendorIdentityProvider;
  issuer: string;
  fetcher?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}): Promise<VendorIssuerTrust> {
  let issuerUrl: URL;
  try { issuerUrl = new URL(options.issuer); }
  catch { throw new Error("Vendor issuer URL is invalid"); }
  const expectedOrigin = options.provider === "fly.io" ? "https://oidc.fly.io" : "https://exe.dev";
  if (issuerUrl.protocol !== "https:" || issuerUrl.origin !== expectedOrigin || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) throw new Error("Vendor issuer URL is not trusted");
  if (options.provider === "exe.dev" && !/^\/issuer\/[A-Za-z0-9-]+\/?$/.test(issuerUrl.pathname)) throw new Error("exe.dev issuer path is invalid");
  if (options.provider === "fly.io" && !/^\/[A-Za-z0-9-]+\/?$/.test(issuerUrl.pathname)) throw new Error("Fly.io issuer path is invalid");
  const issuer = options.issuer.replace(/\/$/, "");
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const response = await (options.fetcher ?? fetch)(discoveryUrl, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Vendor issuer metadata unavailable (${response.status})`);
  const metadata = await response.json() as { issuer?: unknown; jwks_uri?: unknown };
  if (metadata.issuer !== issuer || typeof metadata.jwks_uri !== "string") throw new Error("Vendor issuer metadata does not match the configured issuer");
  let jwksUrl: URL;
  try { jwksUrl = new URL(metadata.jwks_uri); }
  catch { throw new Error("Vendor signing keys URL is invalid"); }
  if (jwksUrl.protocol !== "https:" || jwksUrl.origin !== expectedOrigin || jwksUrl.username || jwksUrl.password || jwksUrl.search || jwksUrl.hash) throw new Error("Vendor signing keys URL is not trusted");
  return { issuer, jwksUri: jwksUrl.href, resolveKey: createJwksResolver({ jwksUri: jwksUrl.href, fetcher: options.fetcher, ttlMs: options.ttlMs, now: options.now }) };
}

/** Vendor signed identity verification primitives for run-owned VMs.
 *
 * Trust configuration is supplied by the provider provisioner. Callers must
 * obtain issuer and JWKS locations from the provider's verified OIDC
 * discovery document and must load expected bindings from Factorize state.
 */
export type VendorIdentityProvider = "exe.dev" | "fly.io";

export type VendorRunBinding = {
  provider: VendorIdentityProvider;
  runId: string;
  activeRunId: string;
  vmId: string;
  issuer: string;
  audience: string;
  /** Exact provider subject configured/recorded at VM provisioning. */
  subject?: string;
  /** exe.dev proves VM ownership by attaching one unique WIF integration to one VM. */
  exeAttachment?: { integrationName: string; attachedVmId: string; mode: "vm" };
  /** Maximum token age, in seconds. */
  maxTokenAgeSeconds?: number;
};

export type VendorIdentity = {
  provider: VendorIdentityProvider;
  issuer: string;
  subject: string;
  audience: string;
  runId: string;
  vmId: string;
  expiresAt: number;
  keyId: string;
};

export type JwksResolver = (keyId: string, refresh: boolean) => Promise<JsonWebKey | undefined>;

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

function providerVmId(provider: VendorIdentityProvider, claims: JwtClaims, binding: VendorRunBinding): string | null {
  if (provider === "fly.io") return typeof claims.machine_id === "string" ? claims.machine_id : null;
  const attachment = binding.exeAttachment;
  if (!attachment || attachment.mode !== "vm" || !attachment.integrationName || attachment.attachedVmId !== binding.vmId) return null;
  // exe.dev's WIF subject identifies an integration. Its documented
  // per-VM attachment is the binding; the subject itself is not a VM ID.
  return attachment.attachedVmId;
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

/** Verify a vendor JWT and bind it to the exact active run and provisioned VM. */
export async function verifyVendorRunIdentity(options: {
  token: string;
  binding: VendorRunBinding;
  resolveKey: JwksResolver;
  nowSeconds?: number;
  clockSkewSeconds?: number;
}): Promise<VendorIdentity> {
  const { token, binding } = options;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error("Invalid vendor identity token");
  const header = jsonPart<JwtHeader>(parts[0]!);
  const claims = jsonPart<JwtClaims>(parts[1]!);
  if ((header.alg !== "RS256" && header.alg !== "ES256") || typeof header.kid !== "string" || !header.kid) throw new Error("Unsupported vendor identity signature");
  const key = await options.resolveKey(header.kid, false) ?? await options.resolveKey(header.kid, true);
  if (!key || !(await verifySignature(header.alg, key, `${parts[0]}.${parts[1]}`, decodePart(parts[2]!)))) throw new Error("Invalid vendor identity signature");

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000), skew = options.clockSkewSeconds ?? 30;
  const maxAge = binding.maxTokenAgeSeconds ?? 900;
  const aud = audiences(claims.aud);
  if (claims.iss !== binding.issuer || !aud.includes(binding.audience) || (aud.length > 1 && claims.azp !== binding.audience)) throw new Error("Vendor identity issuer or audience mismatch");
  if (typeof claims.sub !== "string" || !claims.sub || (binding.subject && claims.sub !== binding.subject)) throw new Error("Vendor identity subject mismatch");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Vendor identity has expired");
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + skew || claims.exp - claims.iat > maxAge + skew) throw new Error("Vendor identity lifetime is invalid");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now + skew)) throw new Error("Vendor identity is not yet valid");
  if (!binding.runId || binding.runId !== binding.activeRunId) throw new Error("Vendor identity is not bound to an active run");
  const vmId = providerVmId(binding.provider, claims, binding);
  if (!vmId || vmId !== binding.vmId) throw new Error("Vendor identity VM mismatch");

  return { provider: binding.provider, issuer: binding.issuer, subject: claims.sub, audience: binding.audience, runId: binding.runId, vmId, expiresAt: claims.exp, keyId: header.kid };
}

/** A bounded JWKS cache. Unknown kids force one refresh so key rotation fails closed. */
export function createJwksResolver(options: { jwksUri: string; fetcher?: typeof fetch; ttlMs?: number; now?: () => number }): JwksResolver {
  const fetcher = options.fetcher ?? fetch, ttlMs = options.ttlMs ?? 5 * 60_000, now = options.now ?? Date.now;
  let keys = new Map<string, JsonWebKey>(), expiresAt = 0;
  const load = async (force: boolean) => {
    if (!force && keys.size && now() < expiresAt) return;
    const response = await fetcher(options.jwksUri, { headers: { accept: "application/json" } });
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

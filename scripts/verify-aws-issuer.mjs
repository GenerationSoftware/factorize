import { pathToFileURL } from "node:url";

const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const publicFields = new Set(["kty", "kid", "n", "e", "use", "alg"]);
const base64url = /^[A-Za-z0-9_-]+$/;

export async function verifyAwsIssuer(origin, fetcher = fetch) {
  const issuer = new URL("/oauth/aws", origin).href;
  const discoveryUrl = issuer + "/.well-known/openid-configuration";
  const jwksUrl = issuer + "/jwks";
  const options = { redirect: "error", signal: AbortSignal.timeout(10_000) };
  const discovery = await fetcher(discoveryUrl, options);
  if (discovery.status === 404) return false;
  if (!discovery.ok) throw new Error(`AWS issuer discovery returned HTTP ${discovery.status}.`);
  const metadata = await discovery.json();
  if (metadata?.issuer !== issuer || metadata?.jwks_uri !== jwksUrl ||
      !metadata?.id_token_signing_alg_values_supported?.includes("RS256")) {
    throw new Error("AWS issuer discovery metadata is invalid.");
  }
  // Never follow an endpoint suggested by a response; use only the expected URL.
  const response = await fetcher(jwksUrl, options);
  if (!response.ok) throw new Error(`AWS JWKS returned HTTP ${response.status}.`);
  const { keys } = await response.json();
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 3) throw new Error("AWS JWKS did not contain one to three keys.");
  const ids = new Set();
  for (const key of keys) {
    if (!key || Object.keys(key).some(field => !publicFields.has(field)) ||
        key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" ||
        typeof key.kid !== "string" || !base64url.test(key.kid) || ids.has(key.kid) ||
        typeof key.n !== "string" || !base64url.test(key.n) || typeof key.e !== "string" || !base64url.test(key.e)) {
      throw new Error("AWS JWKS contains an invalid or non-public signing key.");
    }
    ids.add(key.kid);
    const publicKey = await crypto.subtle.importKey("jwk", key, algorithm, false, ["verify"]);
    if (publicKey.algorithm.modulusLength < 2048) throw new Error("AWS JWKS contains an RSA key smaller than 2048 bits.");
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const available = await verifyAwsIssuer(process.argv[2]);
    if (!available) {
      const message = "AWS issuer discovery returned 404. Check AWS_WORKLOAD_SIGNING_KEYS and the production issuer configuration.";
      if (process.env.FACTORIZE_REQUIRE_AWS_ISSUER === "true") throw new Error(message);
      console.warn(`::warning title=AWS integration unavailable::${message}`);
    } else {
      console.log("AWS issuer discovery and public JWKS verified.");
    }
  } catch (error) {
    // Fetch and JSON parse errors may include URLs or raw response text. Keep them out of CI logs.
    console.error(error instanceof Error && error.message.startsWith("AWS ") ? error.message : "Could not verify the AWS issuer's public endpoints.");
    process.exitCode = 1;
  }
}

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function decodePem(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new TypeError("invalid browser capability signing key");
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Issue a one-use capability accepted only by the paired proxy listener. */
export async function issueModelAccountCapability(input: {
  privateKeyPem: string;
  proxyIdentity: string;
  ownerId: string;
  accountId: string;
  action: "authorize" | "status" | "cancel";
  appOrigin: string;
  generation: number | string;
  now?: number;
  jti?: string;
}): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: "factorize", aud: input.proxyIdentity, sub: input.ownerId,
    action: `model-account:${input.action}`, accountId: input.accountId,
    origin: input.appOrigin, generation: input.generation, exp: now + 60,
    jti: input.jti ?? base64url(crypto.getRandomValues(new Uint8Array(24))),
  })));
  const payload = `${header}.${claims}`;
  const rawKey = decodePem(input.privateKeyPem);
  const keyData = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(keyData).set(rawKey);
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("Ed25519", key, encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

async function importAesKey(encodedKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(encodedKey).buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, encodedKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(encodedKey);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, encoder.encode(plaintext).buffer as ArrayBuffer));
  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decrypt(ciphertext: string, encodedKey: string): Promise<string> {
  const [iv, body] = ciphertext.split(".");
  if (!iv || !body) throw new Error("Invalid encrypted value");
  const key = await importAesKey(encodedKey);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv).buffer as ArrayBuffer }, key, fromBase64(body).buffer as ArrayBuffer);
  return new TextDecoder().decode(decrypted);
}

export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value).buffer as ArrayBuffer)));
}

export async function equalHmac(value: string, signatureHex: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value).buffer as ArrayBuffer));
  const supplied = Uint8Array.from(signatureHex.match(/.{1,2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ supplied[index]!;
  return difference === 0;
}

export function base64(value: string): string {
  return toBase64(encoder.encode(value));
}

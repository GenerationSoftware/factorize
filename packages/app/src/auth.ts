import { hmac } from "./crypto";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const validEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = (password: string): boolean => password.length >= 12 && password.length <= 200;

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000; // Cloudflare Workers WebCrypto maximum.
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${base64(salt)}$${base64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, iterations, saltText, digest] = encoded.split("$");
  if (!iterations || !saltText || !digest) return false;
  const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0));
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: decode(saltText), iterations: Number(iterations), hash: "SHA-256" }, key, 256);
    return await hmac(base64(new Uint8Array(bits)), "password-check") === await hmac(digest, "password-check");
  } catch { return false; }
}

export async function tokenDigest(token: string, secret: string): Promise<string> { return hmac(token, secret); }

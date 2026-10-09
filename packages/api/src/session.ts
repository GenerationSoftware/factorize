import { parse } from "hono/utils/cookie";
import { hmac } from "./crypto";

export type Session = { tenantId: string; userId: string; email: string; exp: number; sessionVersion: number };
const textEncoder = new TextEncoder();

function b64(value: string): string { return btoa(String.fromCharCode(...textEncoder.encode(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unb64(value: string): string { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))); }
export async function signSession(session: Session, secret: string): Promise<string> { const body = b64(JSON.stringify(session)); return `${body}.${await hmac(body, secret)}`; }
export async function readSession(value: string | undefined, secret: string): Promise<Session | null> {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || signature !== await hmac(body, secret)) return null;
  try { const session = JSON.parse(unb64(body)) as Session; return session.exp > Math.floor(Date.now() / 1000) ? session : null; } catch { return null; }
}
export const requestCookie = (request: Request, name: string) => {
  const header = request.headers.get("Cookie");
  return header ? parse(header, name)[name] : undefined;
};


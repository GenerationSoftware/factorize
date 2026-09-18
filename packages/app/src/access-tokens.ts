import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { AccessTokenRepository } from "./postgres/access-token-repository";

export const ACCESS_SCOPES = ["flows:read", "flows:write", "runs:read", "runs:write"] as const;
export type AccessScope = typeof ACCESS_SCOPES[number];

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)));
};

export async function accessTokenDigest(token: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export function issueAccessToken(tenantId: string): string {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return `fzt_${base64url(encoder.encode(tenantId))}_${base64url(secret)}`;
}

export function accessTokenTenant(token: string): string | null {
  const match = token.match(/^fzt_([A-Za-z0-9_-]+)_[A-Za-z0-9_-]{43}$/);
  if (!match) return null;
  try { return decode(match[1]); } catch { return null; }
}

export async function authenticateAccessToken(request: Request, env: Env): Promise<OAuthProps | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer fzt_")) return null;
  const token = authorization.slice(7), tenantId = accessTokenTenant(token);
  if (!tenantId) return null;
  const auth = await new AccessTokenRepository(databaseFor(env), tenantId).authenticate(await accessTokenDigest(token));
  return auth ? { ...auth, authMethod: "access_token" } : null;
}

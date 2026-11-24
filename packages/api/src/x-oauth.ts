import { hmac } from "./crypto";

/** X OAuth 2.0 scopes supported by the v1 user-owned connection flow.
 * Descriptions follow the current X OAuth 2.0 scope reference. */
export const X_OAUTH_SCOPES = {
  "tweet.read": "Read posts the authorized account can view.",
  "tweet.write": "Post and delete posts for the authorized account.",
  "tweet.moderate.write": "Hide or unhide replies to the authorized account's posts.",
  "users.email": "Read the authorized account's email address.",
  "users.read": "Read user profiles the authorized account can view.",
  "follows.read": "Read who follows the authorized account and whom it follows.",
  "follows.write": "Follow or unfollow accounts for the authorized account.",
  "offline.access": "Keep the connection active with refresh tokens until access is revoked.",
  "space.read": "Read Spaces the authorized account can view.",
  "mute.read": "Read accounts muted by the authorized account.",
  "mute.write": "Mute or unmute accounts for the authorized account.",
  "like.read": "Read posts liked by the authorized account.",
  "like.write": "Like or unlike posts for the authorized account.",
  "list.read": "Read Lists the authorized account can access.",
  "list.write": "Create and manage Lists for the authorized account.",
  "block.read": "Read accounts blocked by the authorized account.",
  "block.write": "Block or unblock accounts for the authorized account.",
  "bookmark.read": "Read posts bookmarked by the authorized account.",
  "bookmark.write": "Bookmark or remove bookmarks for the authorized account.",
  "dm.read": "Read Direct Messages available to the authorized account.",
  "dm.write": "Send and manage Direct Messages for the authorized account.",
  "media.write": "Upload media for posts.",
  "broadcast.read": "Read the authorized account's live broadcasts and chat.",
  "broadcast.write": "Manage live broadcasts and send chat messages for the authorized account.",
} as const;

export type XOAuthScope = keyof typeof X_OAUTH_SCOPES;
export const X_SUGGESTED_SCOPES: readonly XOAuthScope[] = ["tweet.read", "users.read", "offline.access"];
const SCOPE_ORDER = Object.keys(X_OAUTH_SCOPES) as XOAuthScope[];
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const json64 = (value: unknown) => b64url(encoder.encode(JSON.stringify(value)));

export function validateXOAuthScopes(input: readonly string[]): XOAuthScope[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > SCOPE_ORDER.length) throw new Error("Select at least one X permission.");
  if (input.some(scope => !Object.hasOwn(X_OAUTH_SCOPES, scope))) throw new Error("One or more selected X permissions are not supported.");
  const scopes = [...new Set(input)] as XOAuthScope[];
  if (!scopes.includes("offline.access")) throw new Error("Include offline.access so Factorize can refresh the connection while triggers process Events.");
  // X's v2 authentication mapping requires these scopes for posts and user
  // lookup; all suggested and additional v1 permissions include that baseline.
  if (!scopes.includes("tweet.read") || !scopes.includes("users.read")) throw new Error("Include tweet.read and users.read for X API v2 user access.");
  return SCOPE_ORDER.filter(scope => scopes.includes(scope));
}

export type XOAuthState = {
  tenantId: string;
  userId: string;
  sessionVersion: number;
  connectionId: string;
  scopes: XOAuthScope[];
  nonce: string;
  exp: number;
};

export async function signXOAuthState(value: XOAuthState, secret: string): Promise<string> {
  const body = json64(value);
  return `${body}.${(await hmac(body, secret)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

/** Verify the signed callback state against the cookie and current owner
 * session. Callers must delete the cookie before exchanging the code so a
 * callback replay cannot reuse the same state. */
export async function readXOAuthState(
  state: string | undefined,
  cookieState: string | undefined,
  session: { tenantId: string; userId: string; sessionVersion: number } | null,
  secret: string,
): Promise<XOAuthState | null> {
  if (!state || state !== cookieState || !session) return null;
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const expected = (await hmac(body, secret)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  if (!constantTimeText(expected, signature)) return null;
  try {
    const padded = body.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((body.length + 3) % 4);
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)))) as XOAuthState;
    if (value.exp <= Math.floor(Date.now() / 1000) || value.tenantId !== session.tenantId || value.userId !== session.userId
      || value.sessionVersion !== session.sessionVersion || !value.connectionId || !value.nonce) return null;
    return { ...value, scopes: validateXOAuthScopes(value.scopes) };
  } catch { return null; }
}

function constantTimeText(leftText: string, rightText: string): boolean {
  const left = encoder.encode(leftText), right = encoder.encode(rightText);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export async function createXPKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

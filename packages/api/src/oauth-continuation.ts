import { serialize } from "hono/utils/cookie";
import { databaseFor } from "./postgres/database";
import { tokenDigest } from "./auth";
import { requestCookie } from "./session";
import { inspectDevice } from "./device-oauth";
import type { Env } from "./types";

export type Connection = { id: string; browser_digest: string; destination: string; client_name: string; kind: "callback" | "device"; expires_at: Date; user_id: string | null; ready: boolean; ready_version: number | null; used_at: Date | null };
export const connectionCookie = (id: string) => `factorize_connection_${id}`;
export async function connectionFor(env: Env, id: string): Promise<Connection | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const row = (await databaseFor(env).pool.query<Connection>("SELECT * FROM app.oauth_connections WHERE id=$1 AND expires_at>now() AND used_at IS NULL", [id])).rows[0];
  return row ?? null;
}
export async function originalBrowser(request: Request, env: Env, connection: Connection): Promise<boolean> {
  const cookie = requestCookie(request, connectionCookie(connection.id));
  return !!cookie && await tokenDigest(cookie, env.SESSION_SIGNING_SECRET) === connection.browser_digest;
}
export async function startConnection(request: Request, env: Env, destination: string) {
  if (!destination.startsWith("/") || destination.startsWith("//") || /[\\\x00-\x20]/.test(destination)) return null;
  const url = new URL(destination, env.APP_ORIGIN);
  if (url.origin !== env.APP_ORIGIN || !["/authorize", "/device"].includes(url.pathname)) return null;
  url.searchParams.delete("connection"); url.hash = "";
  let deviceUserCode: string | null = null, clientName: string, kind: "callback" | "device", expiresAt = new Date(Date.now() + 3600_000);
  if (url.pathname === "/authorize") {
    if (!env.OAUTH_PROVIDER) return null;
    const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(url));
    const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
    if (!client || !client.redirectUris.includes(parsed.redirectUri) || parsed.responseType !== "code" || !parsed.codeChallenge || parsed.codeChallengeMethod !== "S256") return null;
    clientName = client.clientName ?? "this MCP client"; kind = "callback";
  } else {
    const code = url.searchParams.get("user_code");
    const device = code ? await inspectDevice(env, code) : null;
    if (code && !device) return null;
    deviceUserCode = device?.userCode.replace("-", "") ?? null;
    clientName = device?.clientName ?? "your device"; kind = "device";
    expiresAt = device ? new Date(device.expiresAt) : new Date(Date.now() + 600_000);
  }
  // Keep expired history only briefly; email tokens outlive neither this retention nor their own TTL.
  await databaseFor(env).pool.query("DELETE FROM app.oauth_connections WHERE expires_at<now()-interval '1 day'");
  const id = crypto.randomUUID(), browser = crypto.randomUUID() + crypto.randomUUID();
  await databaseFor(env).pool.query("INSERT INTO app.oauth_connections(id,browser_digest,destination,client_name,kind,expires_at,device_user_code) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, await tokenDigest(browser, env.SESSION_SIGNING_SECRET), url.pathname + url.search, clientName, kind, expiresAt, deviceUserCode]);
  return { connection: id, clientName, expiresAt: expiresAt.toISOString(), cookie: serialize(connectionCookie(id), browser, { httpOnly: true, secure: new URL(env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) }) };
}
export function connectionDestination(connection: Connection) {
  const url = new URL(connection.destination, "https://local.invalid");
  url.searchParams.set("connection", connection.id);
  return url.pathname + url.search;
}

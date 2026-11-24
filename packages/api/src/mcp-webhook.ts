import { timingSafeEqual } from "node:crypto";
import { isPublicHttpsOrigin } from "./public-address";

const encoder = new TextEncoder();
const maxBody = 256 * 1024;

export function canonicalWebhookSecret(secret: string) {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) return null;
  try {
    const decoded = atob(secret.slice(6));
    if (decoded.length >= 24 && decoded.length <= 64) return "whsec_" + btoa(decoded);
  } catch { /* Invalid base64. */ }
  return null;
}

export function canonicalCallbackURL(value: string) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.replace(/\.$/, "");
    if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048 && !url.href.includes("#")) return url.href;
  } catch { /* Invalid URL. */ }
  return null;
}

export type WebhookOutcome = {
  status?: number;
  reason?: "timeout" | "connection_failed" | "forbidden_destination";
  challenge?: string;
};

async function sign(secret: string, message: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return "v1," + btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function readChallenge(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const bytes = new Uint8Array(4096);
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.byteLength > bytes.length) return;
      bytes.set(next.value, size);
      size += next.value.byteLength;
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)))?.challenge; }
    catch { return; }
    if (typeof value === "string" && value.length <= 128) return value;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function sendMcpWebhook(backendOrigin: string, input: {
  url: string;
  subscriptionId: string;
  id: string;
  payload: object;
  secrets: string[];
  verify?: boolean;
  now?: number;
}): Promise<WebhookOutcome> {
  const { url, subscriptionId, id, secrets, verify = false, now = Date.now() } = input;
  const body = JSON.stringify(input.payload);
  if (encoder.encode(body).byteLength > maxBody) return { status: 413 };
  const endpoint = canonicalCallbackURL(url);
  if (!endpoint || !isPublicHttpsOrigin(new URL(endpoint).origin, backendOrigin)) {
    return { reason: "forbidden_destination" };
  }
  const timestamp = String(Math.floor(now / 1000));
  const message = encoder.encode(`${id}.${timestamp}.${body}`);
  const signature = (await Promise.all(secrets.map(secret => sign(secret, message)))).join(" ");
  const signal = AbortSignal.timeout(10_000);
  try {
    // Use the Worker's public fetch path. The network checks the address it
    // actually connects to and TLS authenticates the original URL hostname.
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        "Content-Type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
        "X-MCP-Subscription-Id": subscriptionId,
      },
      body,
    });
    if (verify && response.ok) return { status: response.status, challenge: await readChallenge(response) };
    void response.body?.cancel().catch(() => {});
    return { status: response.status };
  } catch {
    return { reason: signal.aborted ? "timeout" : "connection_failed" };
  }
}

export function callbackAccepted(outcome: WebhookOutcome) {
  return outcome.status !== undefined && outcome.status >= 200 && outcome.status < 300;
}

export function validChallenge(actual: string | undefined, expected: string) {
  const received = encoder.encode(actual ?? ""), challenge = encoder.encode(expected);
  return received.length === challenge.length && timingSafeEqual(received, challenge);
}

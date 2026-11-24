import { timingSafeEqual } from "node:crypto";
import type { Env } from "./types";

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
    if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048 && !url.href.includes("#")) return url.href;
  } catch { /* Invalid URL. */ }
  return null;
}

export type WebhookOutcome = {
  status?: number;
  reason?: "timeout" | "connection_failed" | "forbidden_destination" | "egress_unavailable" | "tls_error";
  challenge?: string;
};

async function sign(secret: string, message: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return "v1," + btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function sendMcpWebhook(env: Env, input: {
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
  if (!env.MCP_EVENT_EGRESS_URL || !env.MCP_EVENT_EGRESS_TOKEN) return { reason: "egress_unavailable" };

  const endpoint = canonicalCallbackURL(env.MCP_EVENT_EGRESS_URL);
  if (!endpoint) return { reason: "egress_unavailable" };
  const timestamp = String(Math.floor(now / 1000));
  const message = encoder.encode(`${id}.${timestamp}.${body}`);
  const signature = (await Promise.all(secrets.map(secret => sign(secret, message)))).join(" ");
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(new URL("/send", endpoint), {
      method: "POST",
      redirect: "error",
      signal,
      headers: { Authorization: `Bearer ${env.MCP_EVENT_EGRESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, subscriptionId, id, timestamp, signature, body, verify }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { reason: "egress_unavailable" };
    }
    const result = await response.json<WebhookOutcome>();
    return {
      status: Number.isInteger(result.status) && result.status! >= 100 && result.status! <= 599 ? result.status : undefined,
      reason: result.reason === "forbidden_destination" || result.reason === "timeout" ||
        result.reason === "tls_error" || result.reason === "connection_failed" ? result.reason : undefined,
      challenge: verify && typeof result.challenge === "string" ? result.challenge : undefined,
    };
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

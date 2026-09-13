import { equalHmac } from "./crypto";

export const TAIL_MAX_AGE_MS = 60_000;
export const TAIL_HANDLER_SCAFFOLD = `function handler(webhook) {
  return webhook.outcome === "exception" || webhook.logs.some((log) => log.level === "error");
}`;

const sensitive = /authorization|cookie|token|secret|password|credential|api[-_]?key|prompt|body/i;
const encoder = new TextEncoder();

export function signingPayload(timestamp: string, deliveryId: string, body: string): string {
  return `${timestamp}.${deliveryId}.${body}`;
}

export async function signTailDelivery(secret: string, timestamp: string, deliveryId: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(signingPayload(timestamp, deliveryId, body)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTailDelivery(secret: string, timestamp: string, deliveryId: string, body: string, signature: string, time = Date.now()): Promise<"valid" | "stale" | "invalid"> {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || Math.abs(time - value) > TAIL_MAX_AGE_MS) return "stale";
  return await equalHmac(signingPayload(timestamp, deliveryId, body), signature.replace(/^sha256=/, ""), secret) ? "valid" : "invalid";
}

export function generateTailSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function sanitizeTailEvent(value: unknown, depth = 0): any {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeTailEvent(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 8_192) : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (sensitive.test(key)) { output[key] = "[redacted]"; continue; }
    output[key] = sanitizeTailEvent(item, depth + 1);
  }
  return output;
}

export function suppressTailEvent(event: Record<string, any>): boolean {
  if (event.factorizeTailSuppressed === true) return true;
  const script = String(event.scriptName ?? event.scriptName?.name ?? "").toLowerCase();
  if (script.includes("factorize-tail-relay")) return true;
  return Array.isArray(event.logs) && event.logs.some((log: any) => {
    const message = JSON.stringify(log?.message ?? "");
    return message.includes("factorize_tail_ingestion") || message.includes('"factorizeTailSuppressed":true');
  });
}

export async function tailFingerprint(event: Record<string, any>): Promise<string> {
  const stable = JSON.stringify({ scriptName: event.scriptName, outcome: event.outcome, event: event.event, exceptions: event.exceptions, logs: event.logs });
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(stable));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

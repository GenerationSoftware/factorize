interface Env { FACTORIZE_TAIL_DESTINATION: string; FACTORIZE_TAIL_SECRET: string }
const sensitive = /authorization|cookie|token|secret|password|credential|api[-_]?key|prompt|body/i;
const encoder = new TextEncoder();
function sanitize(value: unknown, depth = 0): any {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 8_192) : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) output[key] = sensitive.test(key) ? "[redacted]" : sanitize(item, depth + 1);
  return output;
}
async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export default {
  async tail(events: TraceItem[], env: Env, ctx: ExecutionContext): Promise<void> {
    for (const original of events) {
      const event = sanitize({ ...original, scriptName: (original as any).scriptName ?? (original as any).script?.name ?? "unknown" });
      const body = JSON.stringify(event), timestamp = String(Date.now()), delivery = crypto.randomUUID();
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 3_000);
      ctx.waitUntil(fetch(env.FACTORIZE_TAIL_DESTINATION, { method: "POST", headers: { "Content-Type": "application/json", "X-Factorize-Timestamp": timestamp, "X-Factorize-Delivery": delivery, "X-Factorize-Signature": `sha256=${await signature(env.FACTORIZE_TAIL_SECRET, `${timestamp}.${delivery}.${body}`)}` }, body, signal: controller.signal }).catch(error => {
        console.error(JSON.stringify({ event: "factorize_tail_relay_failed", message: error instanceof Error ? error.message : "delivery failed", factorizeTailSuppressed: true }));
      }).finally(() => clearTimeout(deadline)));
    }
  },
} satisfies ExportedHandler<Env>;

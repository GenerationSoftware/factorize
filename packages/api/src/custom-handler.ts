export const CUSTOM_HANDLER_MAX_CODE_BYTES = 16_384;
export const CUSTOM_HANDLER_MAX_PAYLOAD_BYTES = 262_144;
export const CUSTOM_HANDLER_COMPATIBILITY_DATE = "2026-09-10";
export const CUSTOM_HANDLER_DEADLINE_MS = 250;

export type HandlerDecision =
  | { ok: true; decision: boolean | Record<string, unknown> }
  | { ok: false; category: "handler_error" | "invalid_return" | "timeout" | "platform_error" };

const encoder = new TextEncoder();
export function validateHandlerCode(handlerCode: unknown): string {
  if (typeof handlerCode !== "string" || encoder.encode(handlerCode).byteLength > CUSTOM_HANDLER_MAX_CODE_BYTES) throw new Error(`Handler code must be at most ${CUSTOM_HANDLER_MAX_CODE_BYTES} bytes.`);
  if (!/^\s*function\s+handler\s*\(\s*webhook\s*\)\s*\{[\s\S]*\}\s*;?\s*$/.test(handlerCode)) throw new Error("Provide one complete function handler(webhook) declaration.");
  return handlerCode;
}

export function userWorkerModule(handlerCode: string): string {
  return `${handlerCode}\n
const jsonCompatible = (value, seen = new Set()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => jsonCompatible(item, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.values(value).every(item => jsonCompatible(item, seen));
  seen.delete(value);
  return valid;
};
export default { async fetch(request) {
  if (request.method !== "POST") return Response.json({ ok: false, category: "handler_error" }, { status: 405 });
  try {
    const webhook = await request.json();
    const result = handler(webhook);
    if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") return Response.json({ ok: false, category: "invalid_return" });
    if (typeof result === "boolean") return Response.json({ ok: true, decision: result });
    if (result === null || typeof result !== "object" || Array.isArray(result) || !jsonCompatible(result)) return Response.json({ ok: false, category: "invalid_return" });
    try {
      const serialized = JSON.stringify(result);
      const decision = JSON.parse(serialized);
      if (decision === null || typeof decision !== "object" || Array.isArray(decision)) return Response.json({ ok: false, category: "invalid_return" });
      return Response.json({ ok: true, decision });
    } catch { return Response.json({ ok: false, category: "invalid_return" }); }
  } catch { return Response.json({ ok: false, category: "handler_error" }); }
} };`;
}

export async function invokeCustomHandler(loader: WorkerLoader, source: { handlerCode: string }, payload: unknown): Promise<HandlerDecision> {
  const body = JSON.stringify(payload);
  if (encoder.encode(body).byteLength > CUSTOM_HANDLER_MAX_PAYLOAD_BYTES) return { ok: false, category: "platform_error" };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), CUSTOM_HANDLER_DEADLINE_MS);
  try {
    const worker = loader.load({
      compatibilityDate: CUSTOM_HANDLER_COMPATIBILITY_DATE,
      mainModule: "worker.js",
      modules: { "worker.js": userWorkerModule(source.handlerCode) },
      env: {},
      globalOutbound: null,
      limits: { cpuMs: 10, subRequests: 0 },
    });
    const response = await worker.getEntrypoint().fetch("https://handler.internal/", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
    if (!response.ok) return { ok: false, category: "platform_error" };
    const result = await response.json() as any;
    const validDecision = typeof result?.decision === "boolean" || (result?.decision !== null && typeof result?.decision === "object" && !Array.isArray(result?.decision));
    return result?.ok === true && validDecision ? result : result?.ok === false && ["handler_error", "invalid_return", "timeout", "platform_error"].includes(result.category) ? result : { ok: false, category: "platform_error" };
  } catch (error) {
    return { ok: false, category: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "platform_error" };
  } finally { clearTimeout(deadline); }
}

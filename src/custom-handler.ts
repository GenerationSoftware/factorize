import type { CustomOrigin, CustomSource, Env } from "./types";

export const CUSTOM_HANDLER_SCAFFOLD = `function handler(webhook) {
  return true;
}`;
export const CUSTOM_HANDLER_MAX_CODE_BYTES = 16_384;
export const CUSTOM_HANDLER_MAX_PAYLOAD_BYTES = 262_144;
export const CUSTOM_HANDLER_COMPATIBILITY_DATE = "2026-09-10";
export const CUSTOM_HANDLER_DEADLINE_MS = 250;

export type HandlerDecision =
  | { ok: true; decision: boolean }
  | { ok: false; category: "handler_error" | "invalid_return" | "timeout" | "platform_error" };

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function customScriptName(tenantId: string, flowId: string): Promise<string> {
  return `fh-${(await sha256(`${tenantId}\0${flowId}`)).slice(0, 40)}`;
}

export function validateCustomHandler(origin: unknown, handlerName: unknown, handlerCode: unknown): { origin: CustomOrigin; handlerName: string; handlerCode: string } {
  if (origin !== "linear" && origin !== "github") throw new Error("Custom handler origin must be Linear or GitHub.");
  if (typeof handlerName !== "string" || !handlerName.trim() || handlerName.trim().length > 80) throw new Error("Handler name must be between 1 and 80 characters.");
  if (typeof handlerCode !== "string" || encoder.encode(handlerCode).byteLength > CUSTOM_HANDLER_MAX_CODE_BYTES) throw new Error(`Handler code must be at most ${CUSTOM_HANDLER_MAX_CODE_BYTES} bytes.`);
  // This is input validation, not the isolation boundary. Requiring exactly one
  // complete declaration prevents ambiguous adapters and accidental snippets.
  const declaration = /^\s*function\s+handler\s*\(\s*webhook\s*\)\s*\{[\s\S]*\}\s*;?\s*$/;
  if (!declaration.test(handlerCode)) throw new Error("Provide one complete function handler(webhook) declaration.");
  return { origin, handlerName: handlerName.trim(), handlerCode };
}

export function userWorkerModule(handlerCode: string): string {
  return `${handlerCode}\n
export default { async fetch(request) {
  if (request.method !== "POST") return Response.json({ ok: false, category: "handler_error" }, { status: 405 });
  try {
    const webhook = await request.json();
    const result = handler(webhook);
    if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") return Response.json({ ok: false, category: "invalid_return" });
    if (typeof result !== "boolean") return Response.json({ ok: false, category: "invalid_return" });
    return Response.json({ ok: true, decision: result });
  } catch { return Response.json({ ok: false, category: "handler_error" }); }
} };`;
}

export async function invokeCustomHandler(dispatch: DispatchNamespace, source: CustomSource, payload: unknown): Promise<HandlerDecision> {
  const body = JSON.stringify(payload);
  if (encoder.encode(body).byteLength > CUSTOM_HANDLER_MAX_PAYLOAD_BYTES) return { ok: false, category: "platform_error" };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), CUSTOM_HANDLER_DEADLINE_MS);
  try {
    const worker = dispatch.get(source.handlerDeployment.scriptName, {}, { limits: { cpuMs: 10, subRequests: 1 } });
    const response = await worker.fetch("https://handler.internal/", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
    if (!response.ok) return { ok: false, category: "platform_error" };
    const result = await response.json() as HandlerDecision;
    return result?.ok === true && typeof result.decision === "boolean" ? result : result?.ok === false && ["handler_error", "invalid_return", "timeout", "platform_error"].includes(result.category) ? result : { ok: false, category: "platform_error" };
  } catch (error) {
    return { ok: false, category: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "platform_error" };
  } finally { clearTimeout(deadline); }
}

export async function deployCustomHandler(env: Env, tenantId: string, flowId: string, source: Omit<CustomSource, "handlerDeployment">, previous?: CustomSource): Promise<CustomSource> {
  if (!env.CUSTOM_DEPLOYER) throw new Error("Custom handler deployment is not configured.");
  const scriptName = await customScriptName(tenantId, flowId);
  const codeDigest = await sha256(source.handlerCode);
  if (previous?.handlerDeployment.state === "ready" && previous.handlerDeployment.codeDigest === codeDigest) return { ...source, handlerDeployment: previous.handlerDeployment };
  const response = await env.CUSTOM_DEPLOYER.fetch("https://deployer.internal/scripts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scriptName, module: userWorkerModule(source.handlerCode) }) });
  if (!response.ok) throw new Error(`Handler deployment failed (${response.status}).`);
  return { ...source, handlerDeployment: { scriptName, codeDigest, state: "ready" } };
}

export async function deleteCustomHandler(env: Env, scriptName: string): Promise<boolean> {
  if (!env.CUSTOM_DEPLOYER) return false;
  const response = await env.CUSTOM_DEPLOYER.fetch(`https://deployer.internal/scripts/${encodeURIComponent(scriptName)}`, { method: "DELETE" });
  return response.ok || response.status === 404;
}

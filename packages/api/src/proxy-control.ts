import { databaseFor } from "./postgres/database";
import { ProxyControlRepository } from "./postgres/proxy-control-repository";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Dedicated service-to-service endpoint. The run API credential is intentionally not accepted here. */
export async function proxyControlFetch(request: Request, env: Parameters<typeof databaseFor>[0]): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/internal/credential-proxy/register-boot") return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "unsupported_media_type" }, 415);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 1024) return json({ error: "invalid_request" }, 413);
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); return json({ error: "invalid_request" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => key !== "bootEpoch")
    || typeof (body as any).bootEpoch !== "string") return json({ error: "invalid_request" }, 400);
  const repository = new ProxyControlRepository(databaseFor(env));
  const registration = await repository.registerBoot(token, (body as any).bootEpoch);
  if (!registration) return json({ error: "proxy_registration_unavailable" }, 403);
  return json({ registered: true, proxyIdentity: registration.proxyIdentity, bootEpoch: registration.bootEpoch });
}

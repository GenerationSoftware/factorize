import { matchApiOperation } from "../../api-contract";
import type { ApiService } from "../../api-service";
import { ServiceError } from "../../service-contract";
import { executeAuth, validBrowserOrigin } from "../../auth/api/auth-api";
import type { Env, OAuthProps } from "../../types";

function queryInput(url: URL): Record<string, string | string[]> {
  const value: Record<string, string | string[]> = {};
  url.searchParams.forEach((item, key) => {
    const previous = value[key];
    value[key] = previous === undefined ? item : Array.isArray(previous) ? [...previous, item] : [previous, item];
  });
  return value;
}

export async function dispatchRest(request: Request, url: URL, env: Env, auth: OAuthProps | null, createService: (auth: OAuthProps) => ApiService): Promise<Response> {
  const matched = matchApiOperation(request.method, url.pathname);
  if (!matched) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  const { route, params } = matched;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (route.authOperation || auth?.authMethod === "session") && !validBrowserOrigin(request, env)) throw new ServiceError(403, "invalid_origin", "Invalid request origin.");
  if (!route.authOperation && !auth) throw new ServiceError(401, "invalid_token", "Unauthorized");
  const requiredScopes = Array.isArray(route.scope) ? route.scope : route.scope.split("+");
  if (!route.authOperation && !requiredScopes.every(scope => auth!.scopes.includes(scope))) throw new ServiceError(403, "insufficient_scope", `The ${requiredScopes.join(" and ")} scope is required.`);
  if (!route.authOperation && route.ownerSession && auth!.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required.");
  let body: unknown;
  if (route.body) {
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ServiceError(415, "unsupported_media_type", "Content-Type must be application/json.");
    try {
      if (route.maxBodyBytes) {
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        if (reader) for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > route.maxBodyBytes) { await reader.cancel(); throw new ServiceError(400, "invalid_request", "Request body exceeds the byte limit."); }
          chunks.push(value);
        }
        const data = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        body = JSON.parse(new TextDecoder().decode(data));
      } else body = await request.json();
    }
    catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(400, "invalid_request", "Request body must be valid JSON."); }
    body = route.body.parse(body);
  }
  if (route.authOperation) return executeAuth(route.authOperation, request, env, body as Record<string, unknown>);
  const service = createService(auth!);
  const query = route.query?.parse(queryInput(url));
  const result = await route.execute(service, { params: route.parameters.parse(params) as Record<string, string>, body, query, url, signal: request.signal,request });
  return result instanceof Response ? result : Response.json(result, { status: route.status });
}

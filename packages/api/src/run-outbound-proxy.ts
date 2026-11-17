import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { authenticateVendorRunRequest, RUN_IDENTITY_HEADER } from "./vendor-run-auth";
import { AgentApiService } from "./agent-api";

const unavailable = () => new Response("Run credential unavailable", {status: 403, headers: {"Cache-Control": "no-store"}});

/** Preserve raw VM URLs and true streaming. Authentication never falls back to
 * OAuth. Both transports reach the same identity/grant and forwarding service. */
export async function runOutboundProxyFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = /^\/internal\/run-proxy\/([0-9a-f-]{36})(\/.*)$/.exec(url.pathname);
  if (!route || route[1] !== request.headers.get(RUN_IDENTITY_HEADER)) return unavailable();
  const auth = await authenticateVendorRunRequest(request, env);
  if (!auth?.runId || auth.authMethod !== "vendor_identity") return unavailable();
  const path = route[2]!;
  const bearer = /^\/integrations\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
  const github = /^\/providers\/github\/([1-9][0-9]*)(\/.*)?$/.exec(path);
  const linear = /^\/providers\/linear(\/.*)?$/.exec(path);
  const model = /^\/providers\/model\/v1(\/.*)?$/.exec(path);
  const kind = bearer ? "bearer" : github ? "github" : linear ? "linear" : model ? "model" : null;
  if (!kind) return unavailable();
  try {
    let id = bearer?.[1] ?? github?.[1] ?? "linear";
    if (model) {
      const row = (await databaseFor(env).pool.query<{execution_config: {modelAccountId?: string}}>("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [auth.tenantId,auth.runId])).rows[0];
      id = row?.execution_config.modelAccountId ?? "";
    }
    const row = (await databaseFor(env).pool.query<{id: string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2 AND credential_id=$3", [auth.tenantId,kind,id])).rows[0];
    if (!row) return unavailable();
    const suffix = bearer?.[2] ?? github?.[2] ?? linear?.[1] ?? model?.[1] ?? (linear ? "/graphql" : "/");
    return await new AgentApiService(env,auth).forward(row.id, suffix+url.search, request);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) return unavailable();
    return new Response("Run outbound request unavailable", {status: 502, headers: {"Cache-Control": "no-store"}});
  }
}

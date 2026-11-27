import { compile, search } from "@jmespath-community/jmespath";
import { AgentApiService } from "../../proxy/application/agent-api";
import { AgentApiError } from "../../proxy/api/agent-api-error";
import { requiredIntegrationScope } from "../../proxy/application/agent-integration-access";
import { requestApiInput } from "../../proxy/api/agent-api-contracts";
import { normalizeScopes } from "../../access-tokens";
import { getOAuthInstallation } from "../../oauth-installations";
import { databaseFor } from "../../postgres/database";
import type { EventEnrichment, InputMapping } from "../api/event-enrichment-contracts";
import type { Env, OAuthProps } from "../../types";

type Scalar = string | number | boolean;
type StepResult = { name: string; outcome: "ok" | "failed"; status?: number };
export type Evaluation = { state: "matched" | "excluded" | "failed"; stage: string | null; reason: string | null;
  input?: Record<string, Scalar>; steps: StepResult[] };
export type EvaluatorAuthority = Pick<OAuthProps, "userId" | "sessionVersion"> & {
  clientId: string; grantId: string; installationId?: string; scopes: string[];
};

// One ingress/scheduler batch has a finite request count and wall-clock
// budget even when multiple Trigger prefilters accept it.
export class EnrichmentBudget {
  private remaining = 12;
  private end?: number;
  take(steps: number) {
    this.end ??= Date.now()+8000;
    const cost = Math.max(1,steps), left = this.end-Date.now();
    if (this.remaining < cost || left <= 0) return 0;
    this.remaining -= cost;
    return left;
  }
}

function read(value: unknown, path: string): Scalar {
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || ["__proto__","prototype","constructor"].includes(part) || !Object.hasOwn(value, part)) {
      throw new Error("Missing input");
    }
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 512) return value;
  throw new Error("Missing scalar input");
}
const variable = /\{\{\s*((?:input|lookups)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,11})\s*\}\}/g;

function renderPath(template: string, value: Record<string, unknown> | null) {
  if ((template.match(/\?/g)?.length ?? 0)>1) throw new Error("Invalid request template");
  const [pathname = "", query] = template.split("?", 2);
  if (!/^\/[A-Za-z0-9_-]+(?:\/|$)/.test(pathname) || /[\\#\u0000-\u0020]/.test(template.replace(variable,"x")) ||
      /%(?:25|2f|5c|2e|00)/i.test(pathname) || query?.split("&").some(pair => {
        const key = decodeURIComponent(pair.split("=",1)[0]!);
        return /[{}]/.test(key) || /(?:^|[-_])(?:token|api[-_]?key|authorization|password|secret|cookie|credential)(?:$|[-_])/i.test(key);
      }))
    throw new Error("Invalid request template");
  const segments = pathname.split("/").map(segment => segment.replace(variable, (_, key: string) => {
    const expanded = value ? String(read(value,key)) : "value";
    if (!/^[A-Za-z0-9._~-]{1,160}$/.test(expanded) || expanded === "." || expanded === "..") throw new Error("Invalid path value");
    return expanded;
  }));
  if (segments.includes(".") || segments.includes("..")) throw new Error("Invalid request template path");
  const suffix = query?.replace(variable, (_, key: string) => encodeURIComponent(value ? String(read(value,key)) : "value"));
  const path = segments.join("/") + (suffix === undefined ? "" : "?" + suffix);
  if (path.length > 2048 || /[{}]/.test(path)) throw new Error("Invalid request template");
  return path;
}

function deadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Timed out"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve,reject).finally(() => signal.removeEventListener("abort",abort)).catch(() => {});
  });
}

async function currentAuth(env: Env, tenantId: string, authority: EvaluatorAuthority, signal: AbortSignal): Promise<OAuthProps> {
  const provider = env.OAUTH_PROVIDER;
  if (!provider) throw new Error("Evaluator authority unavailable");
  const sql = databaseFor(env).pool;
  const installation = await deadline(getOAuthInstallation(sql, tenantId, authority.userId, authority.installationId ?? authority.grantId), signal);
  if (authority.installationId && !installation || installation && (installation.revoked_at || installation.client_id !== authority.clientId ||
      installation.active_session_version !== authority.sessionVersion || !installation.active_grant_id)) throw new Error("Evaluator authority unavailable");
  const grantId = installation?.active_grant_id ?? authority.grantId;
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    signal.throwIfAborted();
    const listing = await deadline(provider.listUserGrants(authority.userId, { limit: 100, cursor }), signal);
    const grant = listing.items.find(item => item.id === grantId);
    if (grant) {
      if (grant.userId !== authority.userId || grant.clientId !== authority.clientId || grant.metadata?.tenantId !== tenantId
          || (grant.expiresAt && grant.expiresAt <= Date.now()/1000)) break;
      const { inspectOAuthGrant, scopesForOAuthCredential } = await import("../../mcp-oauth-auth");
      const inspection = await deadline(inspectOAuthGrant(sql, { tenantId, ...authority, oauthClientId: authority.clientId, oauthInstallationId: installation?.id }, grant.id), signal);
      if (inspection.reason) break;
      const liveScopes = new Set(normalizeScopes(grant.scope));
      const scopes = scopesForOAuthCredential(authority.scopes.filter(scope => liveScopes.has(scope)), inspection).filter(scope => authority.scopes.includes(scope));
      if (!scopes.includes("proxy:use") || !scopes.includes("triggers:write")) break;
      return { ...authority, tenantId, scopes, authMethod: "oauth", oauthClientId: authority.clientId, oauthGrantId: grant.id, oauthInstallationId: installation?.id,
        oauthExpiresAt: Date.now()/1000 + 15, explicitIntegrationScopes: true,
        initialIntegrationDenials: Array.isArray(grant.metadata?.initialIntegrationDenials) ? grant.metadata.initialIntegrationDenials : [] };
    }
    cursor = listing.cursor;
    if (!cursor) break;
  }
  throw new Error("Evaluator authority unavailable");
}

export async function authorizeEnrichment(env: Env, auth: OAuthProps, config: EventEnrichment): Promise<EvaluatorAuthority> {
  const forbidden = () => new AgentApiError(403, "forbidden", "Configure Event lookups from an OAuth connection with explicit integration and proxy permissions.");
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId || !auth.oauthClientId || !auth.oauthExpiresAt ||
      auth.oauthExpiresAt <= Date.now()/1000 || !auth.scopes.includes("proxy:use")) throw forbidden();
  try {
    compile(config.rule);
    for (const step of config.extraDataUrls) requestApiInput.parse({ integration: step.integration, method: step.method, path: renderPath(step.path,null) });
  } catch { throw new AgentApiError(400, "invalid_request", "The Event match rule or a lookup request template is invalid."); }
  const authority = { userId: auth.userId, sessionVersion: auth.sessionVersion, clientId: auth.oauthClientId,
    grantId: auth.oauthGrantId, ...(auth.oauthInstallationId ? { installationId: auth.oauthInstallationId } : {}), scopes: ["triggers:write", "proxy:use"] };
  try {
    const agent = new AgentApiService(env,{...auth,explicitIntegrationScopes:true});
    for (const step of config.extraDataUrls) {
      const scope = requiredIntegrationScope((await agent.authorize(step.integration)).integration);
      if (!authority.scopes.includes(scope)) authority.scopes.push(scope);
    }
    const current = await currentAuth(env, auth.tenantId, authority, AbortSignal.timeout(5000));
    if (authority.scopes.some(scope=>!auth.scopes.includes(scope)||!current.scopes.includes(scope))) throw forbidden();
  } catch { throw forbidden(); }
  return authority;
}

async function responseData(response: Response, signal: AbortSignal) {
  if (!response.body) return null;
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await deadline(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error("Lookup response too large");
      text += decoder.decode(value,{stream:true});
    }
    text += decoder.decode();
  } finally { void reader.cancel().catch(() => {}); }
  const data: unknown = text ? JSON.parse(text) : null;
  let count = 0;
  const check = (value: unknown, level = 0) => {
    if (++count > 4000 || level > 16) throw new Error("Lookup response structure too large");
    if (value && typeof value === "object") for (const child of Object.values(value)) check(child,level+1);
  };
  check(data);
  return data;
}

export async function evaluateEnrichment(env: Env, tenantId: string, config: EventEnrichment,
  authority: EvaluatorAuthority, mapping: InputMapping | null, evidence: Record<string, unknown>, timeout = 8000): Promise<Evaluation> {
  const signal = AbortSignal.timeout(timeout), steps: StepResult[] = [];
  const input: Record<string, Scalar> = Object.create(null);
  const fail = (stage: string, reason: string, exposeInput = true): Evaluation =>
    ({ state:"failed", stage,reason,steps,...(exposeInput ? {input} : {}) });
  if (!mapping) return fail("input","missing_mapping",false);
  try { for (const [key,path] of Object.entries(mapping)) input[key] = read(evidence,path); }
  catch { return fail("input","missing_required_input",false); }
  const lookups: Record<string, unknown> = Object.create(null);
  for (const step of config.extraDataUrls) {
    let authorization: OAuthProps;
    try { authorization = await currentAuth(env,tenantId,authority,signal); }
    catch { steps.push({name:step.name,outcome:"failed"}); return fail(step.name,"authority_unavailable"); }
    let path: string;
    try { path = renderPath(step.path,{input,lookups}); }
    catch { steps.push({name:step.name,outcome:"failed"}); return fail(step.name,"missing_required_input"); }
    try {
      signal.throwIfAborted();
      const request = new Request(env.APP_ORIGIN + "/internal/event-enrichment", { method:step.method,signal });
      const reply = await new AgentApiService(env,authorization).forward(step.integration,path,request);
      if (!reply.ok) {
        await reply.body?.cancel().catch(() => {});
        steps.push({name:step.name,outcome:"failed",status:reply.status});
        return fail(step.name,"lookup_http_failure");
      }
      try { lookups[step.name] = await responseData(reply,signal); }
      catch { steps.push({name:step.name,outcome:"failed",status:reply.status}); return fail(step.name,"lookup_response_invalid"); }
      steps.push({name:step.name,outcome:"ok",status:reply.status});
    } catch { steps.push({name:step.name,outcome:"failed"}); return fail(step.name,"lookup_unavailable"); }
  }
  try { await currentAuth(env,tenantId,authority,signal); }
  catch { return fail("rule","authority_unavailable"); }
  try {
    const matched = search({input,lookups},config.rule);
    if (typeof matched !== "boolean") return fail("rule","rule_not_boolean");
    return {state:matched ? "matched" : "excluded",stage:"rule",reason:matched ? null : "rule_did_not_match",steps,input};
  } catch { return fail("rule","rule_invalid"); }
}

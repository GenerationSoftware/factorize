import { Buffer } from "node:buffer";
import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { normalizeScopes } from "./access-tokens";
import { integrationScopePattern, requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { resolveAgentCredential } from "./agent-credentials";
import { forwardRunOutbound } from "./run-outbound-forwarder";
import type { z } from "zod";

export class AgentApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly scope?: string) { super(message); }
}
export type AgentIntegration = {id: string; kind: "bearer" | "model" | "github" | "linear"; credential_id: string; name: string; description: string | null; available: boolean; policy: "baseline" | "requestable" | "disabled"; epoch: number; revision: number};
export const requiredIntegrationScope = (row: AgentIntegration) => `integration:${row.id}:${row.epoch}`;
const STORAGE_BLOCK_BYTES = 1024 * 1024;
const forbidden = () => new AgentApiError(403, "forbidden", "This integration is not authorized.");
const invalidIdentity = () => new AgentApiError(401, "invalid_token", "The agent authorization is no longer active.");
const publicIntegration = (row: AgentIntegration) => ({ id: row.id, kind: row.kind, name: row.name, description: row.description, available: row.available, policy: row.policy, revision: row.revision, requiredScope: requiredIntegrationScope(row) });

/** These are structural checks only: reflection never refreshes/decrypts secrets. */
export async function integrationConsentLabels(env: Env, tenantId: string, scopes: string[]) {
  const labels: Array<{scope: string; name: string; description: string | null}> = [];
  for (const scope of scopes) {
    const match = integrationScopePattern.exec(scope);
    if (!match) { if (scope.startsWith("integration:")) throw forbidden(); continue; }
    const row = (await databaseFor(env).pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2", [tenantId, match[1]])).rows[0];
    if (!row || !row.available || row.policy === "disabled" || requiredIntegrationScope(row) !== scope) throw forbidden();
    labels.push({scope, name: row.name, description: row.description});
  }
  return labels;
}

export class AgentApiService {
  constructor(private env: Env, private auth: OAuthProps) {}
  private get database() { return databaseFor(this.env); }
  async identity() {
    const auth = this.auth;
    const member = await new IdentityRepository(this.database, auth.tenantId).member(auth.userId);
    if (member?.role !== "owner" || member.sessionVersion !== auth.sessionVersion) throw invalidIdentity();
    let kind: "run" | "oauth", subject: string, config: Record<string, any> | null = null;
    if (auth.authMethod === "vendor_identity" && auth.runId) {
      kind = "run"; subject = auth.runId;
      const row = (await this.database.pool.query<{execution_config: Record<string, any>}>(`SELECT r.execution_config FROM app.runs r
        JOIN app.job_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
        JOIN app.vendor_run_identity_bindings b ON b.tenant_id=j.tenant_id AND b.run_id=j.id
        JOIN app.run_authorizations a ON a.tenant_id=j.tenant_id AND a.run_id=j.id
        WHERE r.tenant_id=$1 AND r.id=$2 AND b.provider=$3 AND b.revoked_at IS NULL
        AND a.user_id=$4 AND a.session_version=$5
        AND r.state IN ('starting','running','blocked') AND j.state IN ('starting','running','blocked')`, [auth.tenantId, auth.runId, auth.runIdentityProvider, auth.userId, auth.sessionVersion])).rows[0];
      if (!row) throw invalidIdentity();
      config = row.execution_config;
    } else if (auth.authMethod === "oauth" && auth.oauthGrantId && auth.oauthClientId && auth.oauthExpiresAt && auth.oauthExpiresAt > Date.now()/1000) {
      kind = "oauth"; subject = auth.oauthGrantId;
    } else throw invalidIdentity();
    const row = (await this.database.pool.query<{id: string; user_id: string; session_version: number; revoked_at: Date | null}>(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,kind,subject) DO UPDATE SET subject=excluded.subject
      RETURNING id,user_id,session_version,revoked_at`, [auth.tenantId, kind, subject, auth.userId, auth.sessionVersion])).rows[0]!;
    if (row.revoked_at || row.user_id !== auth.userId || row.session_version !== auth.sessionVersion) throw invalidIdentity();
    return {id: row.id, kind, config};
  }
  private selected(row: AgentIntegration, config: Record<string, any>) {
    switch(row.kind) {
      case "bearer": return Array.isArray(config.portableIntegrationIds) && config.portableIntegrationIds.includes(row.credential_id);
      case "github": return Array.isArray(config.githubInstallationIds) && config.githubInstallationIds.includes(Number(row.credential_id));
      case "linear": return config.linearConnectionId === "linear";
      case "model": return config.modelAccess === "portable" && config.modelAccountId === row.credential_id;
    }
  }
  async authorize(integration: string) {
    const identity = await this.identity();
    const row = (await this.database.pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, integration])).rows[0];
    if (!row) throw forbidden();
    if (identity.kind === "run") {
      if (!this.selected(row, identity.config!)) throw forbidden();
      const revoked = await this.database.pool.query("SELECT 1 FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2 AND kind=$3 AND credential_id=$4", [this.auth.tenantId, this.auth.runId, row.kind, row.credential_id]);
      if (revoked.rowCount || !row.available) throw forbidden();
    } else {
      if (row.policy === "disabled" || !row.available) throw forbidden();
      if (row.policy !== "baseline" && !this.auth.scopes.includes(requiredIntegrationScope(row))) throw new AgentApiError(403, "insufficient_scope", "Approve this integration before making the request.", requiredIntegrationScope(row));
    }
    return {identity, integration: row};
  }
  async reflection() {
    const identity = await this.identity();
    const rows = (await this.database.pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 ORDER BY name,id", [this.auth.tenantId])).rows;
    const result = [];
    for (const row of rows) {
      if (identity.kind === "run" ? !this.selected(row, identity.config!) : row.policy === "disabled") continue;
      let access: "granted" | "requestable" | "unavailable" = "granted";
      try { await this.authorize(row.id); } catch (error) {
        if (!(error instanceof AgentApiError) || error.status === 401) throw error;
        access = error.code === "insufficient_scope" ? "requestable" : "unavailable";
      }
      result.push({...publicIntegration(row), access, instructions: row.kind === "linear" ? "Use request_api with path /graphql and a JSON GraphQL body." : row.kind === "model" ? "Use request_api with an OpenAI-compatible path relative to /v1." : "Use request_api with a relative API path and query. Access covers this integration, bounded by the upstream credential permissions."});
    }
    return {identity: {id: identity.id, kind: identity.kind}, scopes: normalizeScopes(this.auth.scopes), integrations: result};
  }
  async forward(integration: string, path: string, request: Request) {
    const grant = await this.authorize(integration);
    let credential;
    try { credential = await resolveAgentCredential(this.env, this.auth.tenantId, grant.integration.kind, grant.integration.credential_id, path); }
    catch { throw new AgentApiError(502, "credential_unavailable", "The upstream credential could not be resolved."); }
    if (!credential) throw new AgentApiError(502, "credential_unavailable", "The upstream credential is unavailable; ask the owner to repair it.");
    // Refresh may await a remote provider. Recheck policy, run state and revocations.
    const current = await this.authorize(integration);
    if (current.integration.epoch !== grant.integration.epoch) throw forbidden();
    try { return await forwardRunOutbound(request, credential); }
    catch { throw new AgentApiError(502, "proxy_failed", "The upstream request failed."); }
  }
  async request(input: z.infer<typeof requestApiInput>, signal?: AbortSignal) {
    const parsed = requestApiInput.parse(input);
    // Decode and size-check before any upstream operation.
    let bytes: Uint8Array | undefined;
    try { bytes = parsed.body === undefined ? undefined : parsed.encoding === "base64" ? decodeBase64(parsed.body) : new TextEncoder().encode(parsed.body); }
    catch { throw new AgentApiError(400, "invalid_request", "Invalid base64 request body."); }
    if (bytes && bytes.byteLength > 32*1024*1024) throw new AgentApiError(413, "request_too_large", "Request body exceeds the proxy limit.");
    const response = await this.forward(parsed.integration, parsed.path, new Request(`${this.env.APP_ORIGIN}/mcp`, {method: parsed.method, headers: parsed.headers, body: bytes as Uint8Array<ArrayBuffer> | undefined, signal}));
    const headers: Record<string,string> = {}; response.headers.forEach((value,key) => {headers[key]=value;});
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let size = 0, buffered = 0, block = 0;
    let handle: string | undefined, expiresAt: string | undefined, key: string | undefined;
    // R2 accepts known-length byte buffers. Store bounded 1 MiB blocks while
    // consuming upstream, rather than buffering the complete response in memory.
    const pending = new Uint8Array(STORAGE_BLOCK_BYTES); let pendingSize = 0;
    const write = async (value: Uint8Array) => {
      for (let offset=0;offset<value.byteLength;) {
        const count=Math.min(pending.length-pendingSize,value.byteLength-offset);
        pending.set(value.subarray(offset,offset+count),pendingSize);pendingSize+=count;offset+=count;
        if(pendingSize===pending.length) { await this.env.RUN_ARTIFACTS!.put(`${key}/${block++}`,pending.slice().buffer);pendingSize=0; }
      }
    };
    try {
      if (reader) for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 64*1024*1024) throw new Error("Proxy response exceeds limit");
        if (!key && size > 32768) {
          if (!this.env.RUN_ARTIFACTS) throw new Error("Response storage unavailable");
          const grant = await this.authorize(parsed.integration);
          handle = crypto.randomUUID(); expiresAt = new Date(Date.now()+86400_000).toISOString();
          key = `agent-responses/${this.auth.tenantId}/${grant.identity.id}/${handle}`;
          await this.database.pool.query(`INSERT INTO app.agent_proxy_responses(tenant_id,id,identity_id,integration_id,integration_epoch,object_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [this.auth.tenantId,handle,grant.identity.id,parsed.integration,grant.integration.epoch,key,expiresAt]);
          // Start the maintenance heartbeat even on otherwise idle tenants.
          if(this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake",{method:"POST"});
          for (const chunk of chunks) await write(chunk);
          chunks.length = 0;
        }
        if (key) await write(value); else { chunks.push(value); buffered += value.byteLength; }
      }
      if (key) {
        if(pendingSize) await this.env.RUN_ARTIFACTS!.put(`${key}/${block++}`,pending.slice(0,pendingSize).buffer);
        await this.authorize(parsed.integration);
        await this.database.pool.query("UPDATE app.agent_proxy_responses SET size=$3 WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId,handle,size]);
        return {status: response.status,headers,size,encoding: "base64" as const,handle,expiresAt};
      }
      const body = new Uint8Array(buffered); let offset = 0; for (const chunk of chunks) {body.set(chunk,offset);offset+=chunk.byteLength;}
      await this.authorize(parsed.integration);
      try { return {status: response.status,headers,size,encoding: "utf8" as const,body: new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(body)}; }
      catch { return {status: response.status,headers,size,encoding: "base64" as const,body: encodeBase64(body)}; }
    } catch (error) {
      await reader?.cancel().catch(() => {});
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(502,"proxy_failed","The upstream response could not be retained.");
    }
  }
  async authorizeRead(input: z.infer<typeof readApiResponseInput>) {
    const {handle,offset} = readApiResponseInput.parse(input), identity = await this.identity();
    const row = (await this.database.pool.query<{object_key: string; size: number; integration_id: string; integration_epoch: number}>("SELECT object_key,size,integration_id,integration_epoch FROM app.agent_proxy_responses WHERE tenant_id=$1 AND id=$2 AND identity_id=$3 AND expires_at>clock_timestamp() AND size IS NOT NULL", [this.auth.tenantId,handle,identity.id])).rows[0];
    if (!row) throw new AgentApiError(404,"not_found","Response handle not found or expired.");
    const grant = await this.authorize(row.integration_id);
    if (grant.integration.epoch !== row.integration_epoch) throw forbidden();
    if (offset > row.size) throw new AgentApiError(400,"invalid_request","Offset exceeds response size.");
    return row;
  }
  async read(input: z.infer<typeof readApiResponseInput>) {
    const {handle,offset} = readApiResponseInput.parse(input), row = await this.authorizeRead(input);
    const length = Math.min(65536,row.size-offset), body = new Uint8Array(length);
    let copied=0;
    while(copied<length) {
      const absolute=offset+copied, part=Math.floor(absolute/STORAGE_BLOCK_BYTES), within=absolute%STORAGE_BLOCK_BYTES, count=Math.min(length-copied,STORAGE_BLOCK_BYTES-within);
      const object=await this.env.RUN_ARTIFACTS?.get(`${row.object_key}/${part}`,{range:{offset:within,length:count}});
      if(!object) throw new AgentApiError(404,"not_found","Response body unavailable.");
      const bytes=new Uint8Array(await object.arrayBuffer());
      if(bytes.byteLength!==count) throw new AgentApiError(502,"proxy_failed","Stored response chunk is incomplete.");
      body.set(bytes,copied);copied+=count;
    }
    await this.authorizeRead(input);
    return {handle,offset,nextOffset:offset+body.byteLength,size:row.size,encoding:"base64" as const,body:encodeBase64(body),done:offset+body.byteLength>=row.size};
  }
}
export async function listAgentPolicies(env: Env, tenantId: string) {
  return {integrations:(await databaseFor(env).pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 ORDER BY name,id",[tenantId])).rows.map(publicIntegration)};
}
export async function cleanupAgentResponses(env: Env) {
  if (!env.RUN_ARTIFACTS) return;
  const database = databaseFor(env);
  const rows = (await database.pool.query<{tenant_id:string;id:string;object_key:string}>("SELECT tenant_id,id,object_key FROM app.agent_proxy_responses WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 100")).rows;
  for (const row of rows) {
    let cursor: string | undefined;
    do {
      const page = await env.RUN_ARTIFACTS.list({prefix: row.object_key+"/",cursor,limit:1000});
      if(page.objects.length) await env.RUN_ARTIFACTS.delete(page.objects.map(object=>object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while(cursor);
    await database.pool.query("DELETE FROM app.agent_proxy_responses WHERE tenant_id=$1 AND id=$2 AND expires_at<clock_timestamp()",[row.tenant_id,row.id]);
  }
}
export function encodeBase64(bytes: Uint8Array) { return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString("base64"); }
function decodeBase64(body:string): Uint8Array<ArrayBuffer> {
  if (body.length%4 || /[^A-Za-z0-9+/=]/.test(body) || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw new Error();
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if(body.endsWith("==") ? (alphabet.indexOf(body.at(-3)!) & 15)!==0 : body.endsWith("=") && (alphabet.indexOf(body.at(-2)!) & 3)!==0) throw new Error();
  return Buffer.from(body,"base64");
}

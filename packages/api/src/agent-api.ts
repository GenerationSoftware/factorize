import { initialIntegrationOverrides } from "./oauth-reconnect";
import { activeVmAuthorization } from "./vm-auth";
import { connectionAccess, requiredIntegrationScope, type AgentIntegration, type ConnectionPolicy } from "./agent-integration-access";
export { connectionAccess, requiredIntegrationScope, type AgentIntegration } from "./agent-integration-access";
import {proxyRequestBody} from "./proxy-payloads";
import {search} from "@jmespath-community/jmespath";
import {proxyResultSize,proxyReceipt} from "./proxy-result";
import {queryApiResponseInput,requestApiResponse} from "./agent-api-contracts";
import {AgentApiError} from "./agent-api-error";
export {AgentApiError} from "./agent-api-error";
import { Buffer } from "node:buffer";
import { forwardOutbound } from "./outbound-forwarder";
import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { normalizeScopes } from "./access-tokens";
import { integrationScopePattern, requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { resolveAgentCredential } from "./agent-credentials";
import { XConnectionRepository, XReconnectRequiredError } from "./postgres/x-connection-repository";
import type { z } from "zod";


const STORAGE_BLOCK_BYTES = 1024 * 1024;
const forbidden = () => new AgentApiError(403, "forbidden", "This integration is not authorized.");
const invalidIdentity = () => new AgentApiError(401, "invalid_token", "The agent authorization is no longer active.");
const publicIntegration = (row: AgentIntegration) => ({ id: row.id, kind: row.kind, credentialId: row.credential_id, name: row.name, description: row.description, available: row.available, policy: row.policy, revision: row.revision, requiredScope: requiredIntegrationScope(row) });

/** Restrict the generic X v2 proxy to resources with an explicit OAuth-scope
 * mapping. Unsupported resources and credential-management routes fail closed. */
function xRequiredScope(path: string, method: string): string | null {
  const pathname = path.split("?", 1)[0] ?? "";
  const verb = method.toUpperCase();
  if (/^\/2\/users\/(?:me|[0-9]+)$/.test(pathname) && verb === "GET") return "users.read";
  if (/^\/2\/tweets$/.test(pathname)) return verb === "GET" ? "tweet.read" : verb === "POST" ? "tweet.write" : null;
  if (/^\/2\/tweets\/[0-9]+$/.test(pathname)) return verb === "GET" ? "tweet.read" : verb === "DELETE" ? "tweet.write" : null;
  if (/^\/2\/users\/[0-9]+\/(?:tweets|mentions)$/.test(pathname) && verb === "GET") return "tweet.read";
  if (/^\/2\/users\/[0-9]+\/followers$/.test(pathname) && verb === "GET") return "follows.read";
  if (/^\/2\/users\/[0-9]+\/following$/.test(pathname)) return verb === "GET" ? "follows.read" : verb === "POST" ? "follows.write" : null;
  if (/^\/2\/users\/[0-9]+\/following\/[0-9]+$/.test(pathname) && verb === "DELETE") return "follows.write";
  if (/^\/2\/users\/[0-9]+\/liked_tweets$/.test(pathname) && verb === "GET") return "like.read";
  if (/^\/2\/users\/[0-9]+\/likes$/.test(pathname)) return verb === "GET" ? "like.read" : verb === "POST" ? "like.write" : null;
  if (/^\/2\/users\/[0-9]+\/likes\/[0-9]+$/.test(pathname) && verb === "DELETE") return "like.write";
  return null;
}

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
    if (auth.authMethod === "vm") {
      const scopes = await activeVmAuthorization(this.env, auth);
      if (!scopes || !auth.vmGrantId) throw invalidIdentity();
      if (!scopes.includes("proxy:use")) throw new AgentApiError(403, "insufficient_scope", "The proxy:use scope is required.", "proxy:use");
      await this.database.pool.query(
        `INSERT INTO app.agent_identities(tenant_id,id,kind,subject,user_id,session_version)
         VALUES($1,$2,'vm',$2::uuid::text,$2,0) ON CONFLICT(tenant_id,id) DO NOTHING`,
        [auth.tenantId, auth.vmGrantId],
      );
      const policy: ConnectionPolicy = { disabled_scopes: [], integration_overrides: {} };
      return { id: auth.vmGrantId, kind: "vm" as const, policy, scopes };
    }
    const member = await new IdentityRepository(this.database, auth.tenantId).member(auth.userId);
    if (member?.role !== "owner" || member.sessionVersion !== auth.sessionVersion) throw invalidIdentity();
    let kind: "oauth", subject: string;
    if (auth.authMethod === "oauth" && auth.oauthGrantId && auth.oauthClientId && auth.oauthExpiresAt && auth.oauthExpiresAt > Date.now()/1000) {
      kind = "oauth"; subject = auth.oauthGrantId;
    } else throw invalidIdentity();
    const row = (await this.database.pool.query<ConnectionPolicy & {id: string; user_id: string; session_version: number; revoked_at: Date | null}>(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,integration_overrides)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,kind,subject) DO UPDATE SET subject=excluded.subject
      RETURNING id,user_id,session_version,revoked_at,integration_overrides,disabled_scopes`, [auth.tenantId, kind, subject, auth.userId, auth.sessionVersion, JSON.stringify(initialIntegrationOverrides(auth.initialIntegrationDenials))])).rows[0]!;
    if (row.revoked_at || row.user_id !== auth.userId || row.session_version !== auth.sessionVersion) throw invalidIdentity();
    return {id: row.id, kind, policy: row, scopes: auth.scopes};
  }
  async authorize(integration: string) {
    const identity = await this.identity();
    const row = (await this.database.pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, integration])).rows[0];
    if (!row || row.policy==="disabled") throw forbidden();
    if (identity.kind === "vm" && (!row.available || !identity.scopes.includes(requiredIntegrationScope(row)))) throw forbidden();
    const access = connectionAccess(row, identity.scopes, identity.policy, this.auth.explicitIntegrationScopes);
    if (access === "blocked") throw forbidden();
    if (access === "requestable") throw new AgentApiError(403, "insufficient_scope", "Approve this integration before making the request.", requiredIntegrationScope(row));
    return {identity, integration: row};
  }
  async reflection() {
    const identity = await this.identity();
    const rows = (await this.database.pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 ORDER BY name,id", [this.auth.tenantId])).rows;
    const result = [];
    for (const row of rows) {
      if (row.policy === "disabled" || (identity.kind === "vm" && !identity.scopes.includes(requiredIntegrationScope(row)))) continue;
      let access: "granted" | "requestable" | "unavailable" = "granted";
      try { await this.authorize(row.id); } catch (error) {
        if (!(error instanceof AgentApiError) || error.status === 401) throw error;
        access = error.code === "insufficient_scope" ? "requestable" : "unavailable";
      }
      const path = row.kind === "linear" ? "/graphql" : row.kind === "x" ? "/2/users/me" : row.kind === "cloudflare" ? "/zones" : row.kind === "fly" ? "/v1/apps" : row.kind === "exe" ? "/exec" : "/";
      const method = row.kind === "linear" || row.kind === "exe" ? "POST" : "GET";
      const requestExample = {integration:row.id,method,path,...(row.kind === "linear" ? {headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"query { viewer { id name } }"})} : row.kind === "exe" ? {headers:{"Content-Type":"text/plain"},body:"help"} : {})};
      result.push({...publicIntegration(row), access, requestExample, instructions: "Call MCP request_api with this integration ID and requestExample; no shell, local VM, raw HTTP client or access token is needed. Read retained results with read_api_response. " + (row.kind === "cloudflare" ? "Use paths relative to the Cloudflare v4 REST API. Cloudflare enforces the accounts and permissions authorized on its consent screen." : row.kind === "x" ? "Use the HTTP request endpoint with an X API v2 path, such as /2/users/me. Only granted OAuth scopes and supported resources are available." : row.kind === "linear" ? "Use the HTTP request endpoint with path /graphql and a JSON GraphQL body." : row.kind === "exe" ? "Use the HTTP request endpoint with POST /exec and a text/plain exe.dev command body." : row.kind === "amp" ? "Use the HTTP request endpoint with a path relative to the configured Amp API base." : row.kind === "clickup" ? "Use the HTTP request endpoint with a path relative to /api/v2." : row.kind === "fly" ? "Use the HTTP request endpoint with a Fly Machines API path, such as /v1/apps." : row.kind === "model" ? "Use the HTTP request endpoint with an OpenAI-compatible path relative to /v1." : "Use the HTTP request endpoint with a relative API path and query. Access covers this integration, bounded by the upstream credential permissions.")});
    }
    return {identity: {id: identity.id, kind: identity.kind}, scopes: normalizeScopes(identity.scopes).filter(scope => !identity.policy.disabled_scopes.includes(scope)), proxy: {
      requestUrl: this.env.APP_ORIGIN + "/api/v1/agent/requests",
      readResponseUrl: this.env.APP_ORIGIN + "/api/v1/agent/responses/read",
      requestTool: "request_api", readResponseTool: "read_api_response",
      authentication: "Call MCP request_api with integration, method and relative path (see each requestExample). MCP supplies authorization; never request or construct a credential. OAuth connections require proxy:use; renew consent if missing. read_api_response retrieves retained response handles. If these tools are missing from the client catalog, refresh/reconnect the connector and compare server tools/list; an HTTP URL alone is not usable by a tool-only client.",
    }, integrations: result};
  }
  async forward(integration: string, path: string, request: Request) {
    const grant = await this.authorize(integration);
    if (grant.integration.kind === "x") return this.forwardX(grant.integration.credential_id, path, request);
    let credential;
    try { credential = await resolveAgentCredential(this.env, this.auth.tenantId, grant.integration.kind, grant.integration.credential_id, path); }
    catch (error) {
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(502, "credential_unavailable", "The upstream credential could not be resolved.");
    }
    if (!credential) throw new AgentApiError(502, "credential_unavailable", "The upstream credential is unavailable; ask the owner to repair it.");
    // Refresh may await a remote provider. Recheck authorization before sending.
    const current = await this.authorize(integration);
    if (current.integration.epoch !== grant.integration.epoch) throw forbidden();
    try { return await forwardOutbound(request, credential); }
    catch { throw new AgentApiError(502, "proxy_failed", "The upstream request failed."); }
  }
  async forwardX(connectionId: string, path: string, request: Request) {
    const identity = await this.identity();
    const row = (await this.database.pool.query<{id: string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='x' AND credential_id=$2", [this.auth.tenantId, connectionId])).rows[0];
    if (!row) throw forbidden();
    const apiGrant = await this.authorize(row.id);
    const required = xRequiredScope(path, request.method);
    if (!required) throw forbidden();
    const repository = new XConnectionRepository(this.database, this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY);
    const connection = await repository.get(connectionId);
    if (!connection || connection.status !== "connected") throw forbidden();
    if (!connection.scopes.includes(required) || !connection.grantedScopes.includes(required)) throw new AgentApiError(403, "insufficient_scope", `This X connection does not grant ${required}.`);
    let accessToken: string | null;
    try {
      accessToken = await repository.accessToken(connectionId, async credentials => {
        const response = await fetch("https://api.x.com/2/oauth2/token", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }),
        });
        const body = await response.json().catch(() => null) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown } | null;
        if (!response.ok) {
          if (response.status === 401 || body?.error === "invalid_grant") throw new XReconnectRequiredError();
          throw new Error("X token refresh temporarily failed");
        }
        if (typeof body?.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error("X token refresh response was invalid");
        return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
      });
    } catch (error) {
      if (error instanceof XReconnectRequiredError) throw new AgentApiError(401, "reconnect_required", "X authorization expired or was revoked. Reconnect this connection in Settings.");
      throw new AgentApiError(502, "refresh_unavailable", "X authorization could not be refreshed temporarily. Retry the request later.");
    }
    if (!accessToken) throw forbidden();
    const current = await repository.get(connectionId);
    const currentGrant = await this.authorize(apiGrant.integration.id);
    if (currentGrant.integration.epoch !== apiGrant.integration.epoch) throw forbidden();
    if (current?.status !== "connected" || !current.scopes.includes(required) || !current.grantedScopes.includes(required)) throw forbidden();
    try { return await forwardOutbound(request, { origin: "https://api.x.com", path: path, credential: accessToken }); }
    catch { throw new AgentApiError(502, "proxy_failed", "The X API request failed. Check X API access, credits, and rate limits, then retry if safe."); }
  }
  async request(input: z.infer<typeof requestApiInput>, signal?: AbortSignal):Promise<z.infer<typeof requestApiResponse>> {
    if(this.auth.authMethod==="oauth"&&!this.auth.scopes.includes("proxy:use"))throw new AgentApiError(403,"insufficient_scope","The proxy:use scope is required.","proxy:use");
    const parsed = requestApiInput.parse(input);
    // Decode and size-check before any upstream operation.
    let bytes: Uint8Array | undefined;
    try { bytes = parsed.body === undefined ? undefined : parsed.encoding === "base64" ? decodeBase64(parsed.body) : new TextEncoder().encode(parsed.body); }
    catch { throw new AgentApiError(400, "invalid_request", "Invalid base64 request body."); }
    if (bytes && bytes.byteLength > 32*1024*1024) throw new AgentApiError(413, "request_too_large", "Request body exceeds the proxy limit.");
    const outbound=await proxyRequestBody(this.env,this.auth,parsed);
    const response = await this.forward(parsed.integration, parsed.path, new Request(`${this.env.APP_ORIGIN}/mcp`, {method:parsed.method,headers:outbound.headers,body:outbound.body,signal,duplex:"half"} as RequestInit));
    const headers: Record<string,string> = {}; response.headers.forEach((value,key) => {headers[key]=value;});
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let size = 0, buffered = 0, block = 0;
    let preview="";
    const inlineLimit=parsed.maxResultBytes ? Math.min(32768,Math.floor(parsed.maxResultBytes/4)) : 32768;
    let handle: string | undefined, expiresAt: string | undefined, key: string | undefined;
    // R2 accepts known-length byte buffers. Store bounded 1 MiB blocks while
    // consuming upstream, rather than buffering the complete response in memory.
    const pending = new Uint8Array(STORAGE_BLOCK_BYTES); let pendingSize = 0;
    const write = async (value: Uint8Array) => {
      for (let offset=0;offset<value.byteLength;) {
        const count=Math.min(pending.length-pendingSize,value.byteLength-offset);
        pending.set(value.subarray(offset,offset+count),pendingSize);pendingSize+=count;offset+=count;
        if(pendingSize===pending.length) { await this.env.PROXY_ARTIFACTS!.put(`${key}/${block++}`,pending.slice().buffer);pendingSize=0; }
      }
    };
    try {
      if (reader) for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        if(!size)preview=new TextDecoder().decode(value.subarray(0,160));
        size += value.byteLength;
        if (size > 64*1024*1024) throw new Error("Proxy response exceeds limit");
        if (!key && size > inlineLimit) {
          if (!this.env.PROXY_ARTIFACTS) throw new Error("Response storage unavailable");
          const grant = await this.authorize(parsed.integration);
          handle = crypto.randomUUID(); expiresAt = new Date(Date.now()+1800_000).toISOString();
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
        if(pendingSize) await this.env.PROXY_ARTIFACTS!.put(`${key}/${block++}`,pending.slice(0,pendingSize).buffer);
        await this.authorize(parsed.integration);
        await this.database.pool.query("UPDATE app.agent_proxy_responses SET size=$3 WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId,handle,size]);
        const receipt={status:response.status,headers,size,encoding:"base64" as const,handle:handle!,expiresAt:expiresAt!};
        return parsed.maxResultBytes ? proxyReceipt(receipt,parsed.maxResultBytes,preview) : receipt;
      }
      const body = new Uint8Array(buffered); let offset = 0; for (const chunk of chunks) {body.set(chunk,offset);offset+=chunk.byteLength;}
      await this.authorize(parsed.integration);
      let result:{status:number;headers:Record<string,string>;size:number;encoding:"utf8"|"base64";body:string};
      try { result={status:response.status,headers,size,encoding:"utf8",body:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(body)}; }
      catch { result={status:response.status,headers,size,encoding:"base64",body:encodeBase64(body)}; }
      if(!parsed.maxResultBytes || proxyResultSize(result)<=parsed.maxResultBytes)return result;
      if(!this.env.PROXY_ARTIFACTS)throw new Error("Response storage unavailable");
      const grant=await this.authorize(parsed.integration);handle=crypto.randomUUID();expiresAt=new Date(Date.now()+1800_000).toISOString();key=`agent-responses/${this.auth.tenantId}/${grant.identity.id}/${handle}`;
      await this.database.pool.query("INSERT INTO app.agent_proxy_responses(tenant_id,id,identity_id,integration_id,integration_epoch,object_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[this.auth.tenantId,handle,grant.identity.id,parsed.integration,grant.integration.epoch,key,expiresAt]);
      await write(body);if(pendingSize)await this.env.PROXY_ARTIFACTS.put(`${key}/${block++}`,pending.slice(0,pendingSize).buffer);
      await this.authorize(parsed.integration);await this.database.pool.query("UPDATE app.agent_proxy_responses SET size=$3 WHERE tenant_id=$1 AND id=$2",[this.auth.tenantId,handle,size]);
      if(this.env.SCHEDULER)await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake",{method:"POST"});
      return proxyReceipt({status:response.status,headers,size,encoding:"base64",handle,expiresAt},parsed.maxResultBytes,preview);
    } catch (error) {
      await reader?.cancel().catch(() => {});
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(502,"proxy_failed","The upstream response could not be retained.");
    }
  }
  async query(input:z.infer<typeof queryApiResponseInput>) {
    const value=queryApiResponseInput.parse(input),row=await this.authorizeRead({handle:value.handle,offset:0});
    if(this.auth.authMethod==="oauth"&&!this.auth.scopes.includes("proxy:use"))throw new AgentApiError(403,"insufficient_scope","The proxy:use scope is required.","proxy:use");
    const readBytes=async(offset:number,length:number)=>{
      const parts:Uint8Array[]=[];let size=0;
      while(size<length){const chunk=await this.read({handle:value.handle,offset:offset+size,limit:Math.min(65536,length-size)});const bytes=decodeBase64(chunk.body);if(!bytes.length)break;parts.push(bytes);size+=bytes.length;}
      const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
    };
    if(value.mode==="bytes"){
      if(value.offset>row.size)throw new AgentApiError(400,"invalid_request","Offset exceeds response size.");
      const bytes=await readBytes(value.offset,Math.min(value.limit,row.size-value.offset));
      let length=bytes.length;
      const result=()=>({handle:value.handle,mode:value.mode,data:encodeBase64(bytes.subarray(0,length)),offset:value.offset,nextOffset:value.offset+length,done:value.offset+length>=row.size,encoding:"base64" as const});
      while(length&&proxyResultSize(result())>value.maxResultBytes)length--;
      return result();
    }
    // Bounded parsing protects the Worker from arbitrary-size JSON and lines.
    if(row.size>1024*1024)throw new AgentApiError(413,"query_too_large","JSON/text query parsing is limited to 1 MiB. Use bounded byte ranges instead.");
    let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(await readBytes(0,row.size));}catch{throw new AgentApiError(400,"invalid_encoding","Response is binary; use mode bytes.");}
    let selected:unknown;
    if(value.mode==="text")selected=text.split("\n");
    else {
      // No root reference, function calls or multi-select constructors: those can
      // amplify a small document into quadratic/exponential intermediate data.
      if(/[(${},]/.test(value.expression))throw new AgentApiError(400,"query_not_supported","Use JMESPath field/index projections, slices and filters; functions, root references and constructors are not supported.");
      try{selected=search(JSON.parse(text),value.expression);}catch{throw new AgentApiError(400,"invalid_query","Response must be valid JSON and expression valid JMESPath.");}
    }
    const array=Array.isArray(selected),items=array?selected as unknown[]:[selected];
    if(value.offset>items.length)throw new AgentApiError(400,"invalid_request","Offset exceeds selected result length.");
    let count=Math.min(value.limit,items.length-value.offset);
    const result=()=>({handle:value.handle,mode:value.mode,data:array?items.slice(value.offset,value.offset+count):items[value.offset]??null,offset:value.offset,nextOffset:value.offset+count,done:value.offset+count>=items.length,encoding:value.mode==="text"?"utf8" as const:"json" as const});
    while(count>0&&proxyResultSize(result())>value.maxResultBytes)count--;
    if(!count&&value.offset<items.length)throw new AgentApiError(413,"query_result_too_large","A selected value exceeds the result budget. Select narrower fields or use byte ranges.");
    await this.authorizeRead({handle:value.handle,offset:0});return result();
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
    if(this.auth.authMethod==="oauth"&&!this.auth.scopes.includes("proxy:use"))throw new AgentApiError(403,"insufficient_scope","The proxy:use scope is required.","proxy:use");
    const {handle,offset} = readApiResponseInput.parse(input), row = await this.authorizeRead(input);
    const length = Math.min(input.limit ?? 65536,row.size-offset), body = new Uint8Array(length);
    let copied=0;
    while(copied<length) {
      const absolute=offset+copied, part=Math.floor(absolute/STORAGE_BLOCK_BYTES), within=absolute%STORAGE_BLOCK_BYTES, count=Math.min(length-copied,STORAGE_BLOCK_BYTES-within);
      const object=await this.env.PROXY_ARTIFACTS?.get(`${row.object_key}/${part}`,{range:{offset:within,length:count}});
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
  if (!env.PROXY_ARTIFACTS) return;
  const database = databaseFor(env);
  const rows = (await database.pool.query<{tenant_id:string;id:string;object_key:string}>("SELECT tenant_id,id,object_key FROM app.agent_proxy_responses WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 100")).rows;
  for (const row of rows) {
    let cursor: string | undefined;
    do {
      const page = await env.PROXY_ARTIFACTS.list({prefix: row.object_key+"/",cursor,limit:1000});
      if(page.objects.length) await env.PROXY_ARTIFACTS.delete(page.objects.map(object=>object.key));
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

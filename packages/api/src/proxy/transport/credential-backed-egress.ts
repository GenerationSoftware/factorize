import { signingConfig } from "../../config/runtime";
import type { Env } from "../../types";
import type { Database } from "../../postgres/database";
import { XConnectionRepository } from "../../credentials/storage/x-connection-repository";
import { refreshXProxyToken } from "../../credentials/application/x-proxy-token";
import { resolveAgentCredential } from "../../credentials/application/agent-credentials";
import { forwardOutbound } from "./outbound-forwarder";
import { AgentApiError } from "../api/agent-api-error";
import type { AgentIntegration } from "../application/agent-integration-access";

const forbidden = () => new AgentApiError(403, "forbidden", "This integration is not authorized.");

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

/** This adapter is the seam where already-authorized proxy requests become
 * credential-bound HTTP. Tokens never cross back into the use case. */
export class CredentialBackedEgress {
  constructor(
    private env: Env,
    private tenantId: string,
    private database: Database,
    private authorize: (integration: string) => Promise<{ integration: AgentIntegration }>,
    private requireIdentity: () => Promise<unknown>,
  ) {}

  async forward(integration: string, path: string, request: Request, expectedOperationEpoch?: number) {
    const grant = await this.authorize(integration);
    if (expectedOperationEpoch !== undefined && grant.integration.operation_epoch !== expectedOperationEpoch) throw forbidden();
    if (grant.integration.kind === "x") return this.forwardX(grant.integration.credential_id, path, request, expectedOperationEpoch);
    let credential;
    try { credential = await resolveAgentCredential(this.env, this.tenantId, grant.integration.kind, grant.integration.credential_id, path); }
    catch (error) {
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(502, "credential_unavailable", "The upstream credential could not be resolved.");
    }
    if (!credential) throw new AgentApiError(502, "credential_unavailable", "The upstream credential is unavailable; ask the owner to repair it.");
    // Refresh may await a remote provider. Recheck authorization before sending.
    const current = await this.authorize(integration);
    if (current.integration.operation_epoch !== grant.integration.operation_epoch) throw forbidden();
    try { return await forwardOutbound(request, credential); }
    catch { throw new AgentApiError(502, "proxy_failed", "The upstream request failed."); }
  }
  async forwardX(connectionId: string, path: string, request: Request, expectedOperationEpoch?: number) {
    await this.requireIdentity();
    const row = (await this.database.pool.query<{id: string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='x' AND credential_id=$2", [this.tenantId, connectionId])).rows[0];
    if (!row) throw forbidden();
    const apiGrant = await this.authorize(row.id);
    if (expectedOperationEpoch !== undefined && apiGrant.integration.operation_epoch !== expectedOperationEpoch) throw forbidden();
    const required = xRequiredScope(path, request.method);
    if (!required) throw forbidden();
    const repository = new XConnectionRepository(this.database, this.tenantId, signingConfig(this.env).credentialKey);
    const connection = await repository.get(connectionId);
    if (!connection || connection.status !== "connected") throw forbidden();
    if (!connection.scopes.includes(required) || !connection.grantedScopes.includes(required)) throw new AgentApiError(403, "insufficient_scope", `This X connection does not grant ${required}.`);
    const accessToken = await refreshXProxyToken(repository, connectionId);
    if (!accessToken) throw forbidden();
    const current = await repository.get(connectionId);
    const currentGrant = await this.authorize(apiGrant.integration.id);
    if (currentGrant.integration.operation_epoch !== apiGrant.integration.operation_epoch) throw forbidden();
    if (current?.status !== "connected" || !current.scopes.includes(required) || !current.grantedScopes.includes(required)) throw forbidden();
    try { return await forwardOutbound(request, { origin: "https://api.x.com", path: path, credential: accessToken }); }
    catch { throw new AgentApiError(502, "proxy_failed", "The X API request failed. Check X API access, credits, and rate limits, then retry if safe."); }
  }
}

import { AgentApiService, listAgentPolicies } from "./agent-api";
import { ProxyPayloads, createPayloadInput, appendPayloadInput, finalizePayloadInput, attachmentInput } from "./proxy-payloads";
import { ProxyOperations, operationRef, operationRead } from "./proxy-operations";
import { queryApiResponseInput } from "../api/agent-api-contracts";
import { apiPolicyInput, integrationRef, requestApiInput, readApiResponseInput } from "../api/agent-api-contracts";

import type { Env, OAuthProps } from "../../types";
import { databaseFor } from "../../postgres/database";

import { AGENT_SCOPES } from "../../access-control/domain/scopes";
import { ServiceError } from "../../service-contract";

export class ProxyService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>, private authorizeOwnerSession: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  agentApi() { return new AgentApiService(this.env, this.auth); }

  async getApiReflection() { return this.agentApi().reflection(); }

  async createProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).create(createPayloadInput.parse(input));}

  async getProxyPayload(id:string){return new ProxyPayloads(this.env,this.auth).get(id);}

  async uploadProxyPayload(id:string,request:Request){return new ProxyPayloads(this.env,this.auth).upload(id,request);}

  async appendProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).append(appendPayloadInput.parse(input));}

  async finalizeProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).finalize(finalizePayloadInput.parse(input));}

  async importProxyAttachment(input:unknown){return new ProxyPayloads(this.env,this.auth).importAttachment(attachmentInput.parse(input));}

  async fetchProxyPayload(input:{integration:string;path:string;name?:string;mediaType?:string}){return new ProxyPayloads(this.env,this.auth).importIntegration(input);}

  async requestApiMcp(input:unknown,signal?:AbortSignal){
    const parsed=requestApiInput.parse(input);
    return parsed.execution==="async" || parsed.execution!=="sync" && this.auth.authMethod==="oauth" ? this.startApiOperation(parsed) : this.requestApi(parsed,signal);
  }

  async startApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).start(requestApiInput.parse(input));}

  async getApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).get(operationRef.parse(input).operationId);}

  async cancelApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).cancel(operationRef.parse(input).operationId);}

  async readApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).read(operationRead.parse(input));}

  async requestApi(input: unknown, signal?: AbortSignal) { return this.agentApi().request(requestApiInput.parse(input), signal); }

  async queryApiResponse(input:unknown){return this.agentApi().query(queryApiResponseInput.parse(input));}

  async readApiResponse(input: unknown) { return this.agentApi().read(readApiResponseInput.parse(input)); }

  async listApiPolicies() { await this.authorizeOwnerSession("integrations:read"); return listAgentPolicies(this.env, this.auth.tenantId); }

  async updateApiPolicy(id: string, input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    integrationRef.parse(id); const parsed = apiPolicyInput.parse(input);
    const updated = await databaseFor(this.env).pool.query("UPDATE app.agent_integrations SET policy=$3 WHERE tenant_id=$1 AND id=$2 AND revision=$4 RETURNING id", [this.auth.tenantId,id,parsed.policy,parsed.expectedRevision]);
    if (!updated.rowCount) throw new ServiceError(409,"stale_policy","Integration policy changed or is unavailable. Reload before updating.");
    return this.listApiPolicies();
  }
}

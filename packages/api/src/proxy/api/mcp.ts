import { createPayloadInput, appendPayloadInput, finalizePayloadInput, attachmentInput } from "../../proxy/application/proxy-payloads";
import { operationRef, operationRead } from "../../proxy/application/proxy-operations";

import { queryApiResponseInput } from "../../proxy/api/agent-api-contracts";
import { requestApiInput, readApiResponseInput } from "../../proxy/api/agent-api-contracts";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

import { z } from "zod";

import { mcpTool, structured, type McpTool } from "../../transport/mcp/tool";
import type { ApiService } from "../../api-service";

export function proxyProtocol(server: McpServer, service: ApiService) {
  server.registerResource("proxy-response",new ResourceTemplate("proxy://responses/{handle}",{list:undefined}),{mimeType:"application/json",description:"Bounded authorized retained response byte range; use query_api_response for filtering."},async uri=>({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(await service.proxy.queryApiResponse({handle:uri.pathname.slice(1),mode:"bytes",limit:256}))}]}));
}

export const proxyTools = [
  mcpTool(null, "get_api_reflection", "Use this first to discover authorized integration APIs and request_api examples. Call request_api with the returned integration ID; no shell or raw credential is needed. Availability is not a credential health check.", z.object({}), service => () => service.proxy.getApiReflection()),
  mcpTool("proxy:use", "request_api", "Call an integration discovered by get_api_reflection. Use its integration ID and relative path; no VM, shell or credential is needed. Credentials stay in Factorize. OAuth requires proxy:use. Use read_api_response for retained response handles.", requestApiInput, service => (input:any,signal)=>service.proxy.requestApiMcp({...input,maxResultBytes:input.maxResultBytes??4096},signal)),
  mcpTool("proxy:use", "read_api_response", "Read a retained integration response chunk with the same authorization as the original request.", readApiResponseInput, service => (input:any)=>service.proxy.readApiResponse({...input,limit:Math.min(input.limit??384,384)})),
  mcpTool("proxy:use", "create_payload", "Reserve a temporary request body. Open browserUploadUrl to upload an existing file for that connection, or append/finalize generated text in chunks. Pass the finalized handle to request_api bodySource.", createPayloadInput, service => input=>service.proxy.createProxyPayload(input)),
  mcpTool("proxy:use", "append_payload_chunk", "Append a small generated UTF8/base64 chunk at the returned payload byte size. Identical retries are safe.", appendPayloadInput, service => input=>service.proxy.appendProxyPayload(input)),
  mcpTool("proxy:use", "finalize_payload", "Finalize an immutable request payload; optional SHA256 verifies exact bytes.", finalizePayloadInput, service => input=>service.proxy.finalizeProxyPayload(input)),
  {
    name: "import_attachment",
    scope: "proxy:use",
    description: "Import a user-attached ChatGPT file directly into temporary artifact storage. Returns a payload handle for request_api. Missing native download URLs require create_payload and its browserUploadUrl.",
    register(server, service) {
      server.registerTool(this.name, {
        description: this.description, inputSchema: attachmentInput, _meta: { "openai/fileParams": ["file"] },
      }, async input => structured(await service.proxy.importProxyAttachment(input)));
    },
  } satisfies McpTool,
  mcpTool("proxy:use", "fetch_payload", "Import unchanged file bytes from an authorized integration into a temporary request payload.", z.object({integration:z.uuid(),path:z.string().min(1).max(8192),name:z.string().optional(),mediaType:z.string().optional()}), service => (input:any)=>service.proxy.fetchProxyPayload(input)),
  mcpTool("proxy:use", "get_api_operation", "Poll a durable HTTP operation. Does not repeat the upstream request.", operationRef, service => input=>service.proxy.getApiOperation(input)),
  mcpTool("proxy:use", "read_api_operation", "Read bounded incremental response bytes, including partial bytes after failure. Poll get_api_operation for status.", operationRead, service => input=>service.proxy.readApiOperation(input)),
  mcpTool("proxy:use", "cancel_api_operation", "Cancel an HTTP operation. Upstream writes may already have taken effect.", operationRef, service => input=>service.proxy.cancelApiOperation(input)),
  mcpTool("proxy:use", "query_api_response", "Query a retained response without loading it into context. JSON supports bounded JMESPath fields/projections/filters, text uses line offsets, bytes uses byte offsets. Parsing is limited to 1 MiB; use byte ranges for larger bodies.", queryApiResponseInput, service => input=>service.proxy.queryApiResponse(input)),
];

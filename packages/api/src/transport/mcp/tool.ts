import type { McpServer } from "@modelcontextprotocol/server";
import type { ApiService } from "../../api-service";
import { proxyToolResult } from "../../proxy/application/proxy-result";
import { errorResponse } from "../rest/error-response";

export type McpTool = { name: string; scope: string | null; register(server: McpServer, service: ApiService, signal?: AbortSignal): unknown };

export function structured(value: unknown) {
  const output = Array.isArray(value) ? { items: value } : value && typeof value === "object" ? value as Record<string, unknown> : { value };
  return proxyToolResult(output);
}

export function mcpTool<T>(
  scope: string | null, name: string, description: string, schema: any,
  action: (service: ApiService) => (input: T, signal?: AbortSignal) => Promise<unknown>,
  rawContent = false, readOnly = false,
): McpTool {
  return { name, scope, register: (server, service, requestSignal) => server.registerTool(name, { description, inputSchema: schema, ...(readOnly ? { annotations: { readOnlyHint: true, openWorldHint: false } } : {}) }, async (input: T,context:{mcpReq:{signal:AbortSignal;_meta?:{progressToken?:string|number};notify:(value:any)=>Promise<void>}}) => {
      try { const token=context.mcpReq._meta?.progressToken;
        if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:0,total:1,message:"Processing request"}}).catch(()=>{});
        const result=await action(service)(input,requestSignal?AbortSignal.any([context.mcpReq.signal,requestSignal]):context.mcpReq.signal);if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:1,total:1,message:"Result available; poll operation handles for upstream progress"}}).catch(()=>{});return rawContent?result as any:structured(result); }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    }) };
}

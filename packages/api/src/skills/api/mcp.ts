import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

import { z } from "zod";

import type { ApiService } from "../../api-service";
import { resourceAction } from "../../transport/mcp/errors";

export function skillsProtocol(server: McpServer, service: ApiService) {
  server.server.setRequestHandler("skills/list",{params:z.object({cursor:z.guid().optional(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>resourceAction(()=>service.mcpListSkills(params.cursor)));
  server.server.setRequestHandler("skills/get",{params:z.object({uri:z.string(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>resourceAction(()=>service.mcpGetSkill(params.uri)));
  server.registerResource("factorize-workflow",new ResourceTemplate("skill://factorize/{version}/{name}/SKILL.md",{list:undefined}),{description:"Build-shipped Factorize workflow instructions"},uri=>resourceAction(()=>service.mcpReadSkill(uri.href)));
}

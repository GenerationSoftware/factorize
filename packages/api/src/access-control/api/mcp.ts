import { clientNameInput } from "../../settings-contracts";

import { mcpTool } from "../../transport/mcp/tool";

export const clientTools = [
  mcpTool(null, "rename_mcp_client", "Set the display name of this OAuth connection in Authorized clients.", clientNameInput, service => input => service.renameMcpClient(input)),
];

import { z } from "zod";

import { vmGrantInput, vmGrantRef } from "../../vm-grants/api/vm-grant-contracts";
import { mcpTool } from "../../transport/mcp/tool";

export const vmTools = [
  mcpTool("vms:read", "list_vms", "List active Factorize permission grants for team VMs. Requires vms:read.", z.object({}), service => () => service.listVmGrants()),
  mcpTool("vms:edit", "grant_vm_permissions", "Grant or replace Factorize permissions for an existing VM. Use explicit scopes within your effective access. Requires vms:edit.", vmGrantInput, service => input => service.grantVmPermissions(input)),
  mcpTool("vms:edit", "revoke_vm_permissions", "Revoke a VM's Factorize permissions. The VM keeps running. Requires vms:edit.", vmGrantRef, service => (input: z.infer<typeof vmGrantRef>) => service.revokeVmPermissions(input.grantId)),
];

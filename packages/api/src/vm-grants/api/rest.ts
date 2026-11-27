import { vmGrantInput, vmGrantList, vmGrantRef, vmGrantResult, vmRevokeResult } from "../../vm-grants/api/vm-grant-contracts";
import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

export const vmGrantRoutes = [
  route("GET", "/api/v1/vms", "vms:read", {
    summary: "List VMs with active Factorize permission grants",
    responses: { "200": { description: "Active team VM grants", content: { "application/json": { schema: jsonSchema(vmGrantList, "output") } } } },
  }, service => service.listVmGrants()),
  route("POST", "/api/v1/vms/grants", "vms:edit", {
    summary: "Grant or replace Factorize permissions for an existing VM",
    description: "Supply a preset ID or an explicit scope list. Factorize saves the resolved scope snapshot and rejects the entire request if any scope exceeds the caller's effective access. Use one requestKey per initial enrollment and reuse it for a retry. Supply the current revision when editing an existing grant.",
    responses: { "200": { description: "VM grant and guest authentication metadata", content: { "application/json": { schema: jsonSchema(vmGrantResult, "output") } } } },
  }, (service, { body }) => service.grantVmPermissions(body), { body: vmGrantInput }),
  route("DELETE", "/api/v1/vms/grants/{grantId}", "vms:edit", {
    summary: "Revoke a VM's Factorize permission grant",
    description: "Factorize immediately denies access under this grant. The VM keeps running. Retrying the same revocation is safe.",
    responses: { "200": { description: "VM grant revoked", content: { "application/json": { schema: jsonSchema(vmRevokeResult, "output") } } } },
  }, (service, { params }) => service.revokeVmPermissions(params.grantId), { parameters: vmGrantRef }),
] satisfies RouteContract[];

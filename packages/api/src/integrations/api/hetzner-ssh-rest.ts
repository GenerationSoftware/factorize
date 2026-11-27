import { z } from "zod";
import { jsonSchema, route } from "../../transport/rest/route-contract";
import { hetznerServerId, hetznerSshEnrollment, hetznerSshResult, hetznerSshTarget } from "./hetzner-ssh-contracts";

const parameters = z.object({ serverId: z.string().regex(/^[1-9][0-9]*$/).refine(value => hetznerServerId.safeParse(Number(value)).success) });
function ok(description: string, shape: z.ZodType) {
  return { "200": { description, content: { "application/json": { schema: jsonSchema(shape, "output") } } } };
}
export const hetznerSshRoutes = [
  route("GET", "/api/v1/hetzner/ssh", "integrations:read", {
    summary: "List Hetzner SSH enrollments", responses: ok("Enrollment metadata and public keys", z.object({ servers: z.array(hetznerSshTarget) })),
  }, service => service.hetznerSsh.list(), { ownerSession: true }),
  route("POST", "/api/v1/hetzner/ssh", "integrations:write", {
    summary: "Enroll a Hetzner server for SSH health checks", responses: ok("Enrollment and public key", hetznerSshTarget),
  }, (service, { body }) => service.hetznerSsh.enroll(body), { ownerSession: true, body: hetznerSshEnrollment, maxBodyBytes: 4096 }),
  route("POST", "/api/v1/hetzner/ssh/{serverId}/check", "integrations:read", {
    summary: "Check an enrolled Hetzner server over SSH", responses: ok("Result of a fresh SSH authentication check", hetznerSshResult),
  }, (service, { params }) => service.hetznerSsh.checkAsOwner(Number(params.serverId)), { ownerSession: true, parameters }),
  route("DELETE", "/api/v1/hetzner/ssh/{serverId}", "integrations:write", {
    summary: "Delete a Factorize Hetzner SSH enrollment", responses: ok("Local credential deletion result", z.object({ deleted: z.boolean() })),
  }, (service, { params }) => service.hetznerSsh.delete(Number(params.serverId)), { ownerSession: true, parameters }),
];

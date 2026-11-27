import { z } from "zod";
import { jsonSchema, route } from "../../transport/rest/route-contract";
import { sshTarget, sshTargetInput } from "./contracts";

const ok = (description: string, schema: z.ZodType) => ({
  "200": { description, content: { "application/json": { schema: jsonSchema(schema, "output") } } },
});
export const sshTargetRoutes = [
  route("GET", "/api/v1/ssh/targets", "integrations:read", {
    summary: "List saved SSH target identities", responses: ok("Targets", z.object({ targets: z.array(sshTarget) })),
  }, service => service.ssh.listTargets(), { ownerSession: true }),
  route("POST", "/api/v1/ssh/targets", "integrations:write", {
    summary: "Save an independently verified SSH target identity", responses: ok("Target", sshTarget),
  }, (service, { body }) => service.ssh.addTarget(body), { ownerSession: true, body: sshTargetInput, maxBodyBytes: 4096 }),
  route("DELETE", "/api/v1/ssh/targets/{targetId}", "integrations:write", {
    summary: "Remove a saved SSH target", responses: ok("Removal", z.object({ deleted: z.boolean() })),
  }, (service, { params }) => service.ssh.removeTarget(params.targetId), { ownerSession: true,
    parameters: z.object({ targetId: z.uuid() }),
  }),
];

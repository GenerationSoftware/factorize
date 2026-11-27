import { z } from "zod";
import { jsonSchema, route } from "../../transport/rest/route-contract";
import { hetznerSshPinInput, hetznerSshServerId, publicHetznerSshPin, sshTarget, sshTargetInput } from "./contracts";

const ok = (description: string, schema: z.ZodType) => ({
  "200": { description, content: { "application/json": { schema: jsonSchema(schema, "output") } } },
});
const serverParameters = z.object({ serverId: z.string().regex(/^[1-9][0-9]*$/).refine(value => hetznerSshServerId.safeParse(Number(value)).success) });
export const sshTargetRoutes = [
  route("GET", "/api/v1/ssh/hetzner-targets", "integrations:read", {
    summary: "List verified SSH identities for the connected Hetzner project", responses: ok("Targets", z.object({ targets: z.array(publicHetznerSshPin) })),
  }, service => service.ssh.listHetznerPins(), { ownerSession: true }),
  route("PUT", "/api/v1/ssh/hetzner-targets/{serverId}", "integrations:write", {
    summary: "Save an independently verified Hetzner SSH fingerprint", responses: ok("Target", publicHetznerSshPin),
  }, (service, { params, body }) => service.ssh.saveHetznerPin(Number(params.serverId), body),
  { ownerSession: true, parameters: serverParameters, body: hetznerSshPinInput, maxBodyBytes: 4096 }),
  route("DELETE", "/api/v1/ssh/hetzner-targets/{serverId}", "integrations:write", {
    summary: "Remove a saved Hetzner SSH fingerprint", responses: ok("Removal", z.object({ deleted: z.boolean() })),
  }, (service, { params }) => service.ssh.removeHetznerPin(Number(params.serverId)),
  { ownerSession: true, parameters: serverParameters }),
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

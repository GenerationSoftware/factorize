import { z } from "zod";
import { isPublicAddress } from "../../proxy/transport/public-address";

const sshUsername = z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).refine(username => username !== "root", "Use a non-root account.");
const target = {
  username: sshUsername,
  hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
};
export const sshTargetInput = z.strictObject({
  name: z.string().trim().min(1).max(96),
  address: z.string().max(45).refine(address => !address.includes("%") && isPublicAddress(address), "Use a public IP address."),
  ...target,
});
export const hetznerSshPinInput = z.strictObject(target);
export const hetznerSshServerId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const hetznerSshPin = hetznerSshPinInput.extend({ serverId: hetznerSshServerId, revision: z.uuid(), projectRevision: z.uuid(), needsVerification: z.boolean().default(false) });
export const publicHetznerSshPin = hetznerSshPin.omit({ revision: true, projectRevision: true }).strip();
export const sshTarget = sshTargetInput.extend({ id: z.uuid() });
const execFields = z.strictObject({ targetId: z.uuid().optional(), hetznerServerId: hetznerSshServerId.optional(), username: sshUsername.optional(), command: z.string().min(1).max(4096).refine(command => !command.includes("\0")) });
const oneSelector = (value: { targetId?: string; hetznerServerId?: number; username?: string }) =>
  (value.targetId !== undefined) !== (value.hetznerServerId !== undefined) &&
  (value.username === undefined || value.hetznerServerId !== undefined);
export const sshExecInput = execFields.refine(oneSelector, "Supply either targetId or hetznerServerId; username is only for Hetzner targets.");
export const sshRoutingTarget = (value: z.infer<typeof sshExecInput>) => value.targetId ?? "hetzner:" + value.hetznerServerId;
export const sshExecResult = z.strictObject({
  stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nullable(),
  signal: z.string().nullable(), reusedConnection: z.boolean(), truncated: z.boolean(),
});
export type SshTarget = z.infer<typeof sshTarget>;
export const sshClientAuthority = z.strictObject({
  tenantId: z.uuid(), userId: z.uuid(), sessionVersion: z.number().int().positive(),
  oauthInstallationId: z.string().min(1).max(512), oauthClientId: z.string().min(1).max(512).optional(),
  oauthGrantId: z.string().min(1).max(512), oauthExpiresAt: z.number().finite().positive(),
});
export const sshBrokerRequest = execFields.extend({ authority: sshClientAuthority }).refine(oneSelector);
export type SshClientAuthority = z.infer<typeof sshClientAuthority>;

import { z } from "zod";
import { isPublicAddress } from "../../proxy/transport/public-address";

export const sshTargetInput = z.strictObject({
  name: z.string().trim().min(1).max(96),
  address: z.string().max(45).refine(address => !address.includes("%") && isPublicAddress(address), "Use a public IP address."),
  username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).refine(username => username !== "root", "Use a non-root account."),
  hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
});
export const sshTarget = sshTargetInput.extend({ id: z.uuid() });
export const sshExecInput = z.strictObject({ targetId: z.uuid(), command: z.string().min(1).max(4096).refine(command => !command.includes("\0")) });
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
export const sshBrokerRequest = sshExecInput.extend({ authority: sshClientAuthority });
export type SshClientAuthority = z.infer<typeof sshClientAuthority>;

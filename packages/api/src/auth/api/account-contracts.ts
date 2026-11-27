import { z } from "zod";
import { ACCESS_SCOPES } from "../../access-control/domain/scopes";
import { usernameSchema } from "./usernames";

export const SESSION_SCOPES = [...ACCESS_SCOPES, "apps:manage"] as const;
const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(12).max(200).meta({ writeOnly: true });
const connection = z.uuid().optional();
const token = z.string().min(1).max(512).meta({ writeOnly: true });
export const authInputs = {
  login: z.object({ email: z.string().trim().toLowerCase().min(1).max(320), password, returnTo: z.string().max(8192).optional(), connection }).strict(),
  signup: z.object({ email, username: usernameSchema, password, connection }).strict(),
  request: z.object({ email, connection }).strict(),
  verify: z.object({ token }).strict(),
  reset: z.object({ token, password }).strict(),
  googleStart: z.object({ returnTo: z.string().max(8192).optional(), connection }).strict(),
  googleFinish: z.union([z.object({ username: usernameSchema }).strict(), z.object({ password }).strict()]),
  googleUsername: z.object({ username: usernameSchema }).strict(),
  totpBegin: z.object({ password: password.optional() }).strict(),
  totpEnroll: z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  totpCode: z.object({ code: z.string().trim().min(1).max(64) }).strict(),
  totpDisable: z.object({ password: password.optional(), code: z.string().trim().min(1).max(64) }).strict(),
  change: z.object({ currentPassword: password, password }).strict(),
};
export const sessionResponse = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }).strict(),
  z.object({
    authenticated: z.literal(true),
    user: z.object({ id: z.string(), email: z.email() }).strict(),
    team: z.object({ id: z.string(), name: z.string().nullable(), role: z.literal("owner") }).strict(),
    capabilities: z.array(z.enum(SESSION_SCOPES)),
    expiresAt: z.iso.datetime(),
    googleManagedRecovery: z.boolean().optional(),
    hasPassword: z.boolean().optional(),
  }).strict(),
]);
export const authSuccess = z.object({ ok: z.literal(true) }).strict();
export const continuationSuccess = authSuccess.extend({ returnTo: z.string().optional(), crossBrowser: z.boolean().optional(), pending: z.boolean().optional(), clientName: z.string().optional(), expiresAt: z.iso.datetime().optional() });
export const connectionStartInput = z.object({ returnTo: z.string().min(1).max(8192) }).strict();
export const connectionStartSuccess = z.object({ connection: z.uuid(), clientName: z.string(), expiresAt: z.iso.datetime() });
export const connectionResumeInput = z.object({ connection: z.uuid() }).strict();
export const googleAvailability = z.object({ enabled: z.boolean() });
export const googleStartResult = z.object({ authorizationUrl: z.url() });
export const googlePendingResult = z.object({ email: z.email(), mode: z.enum(["link", "signup", "verify-email", "set-password"]) });
export const googleUsernameResult = z.object({ available: z.boolean() });
export const loginSuccess = authSuccess.extend({ returnTo: z.string() });

export const totpStatusResponse = z.object({ enabled: z.boolean(), available: z.boolean(), method: z.enum(["password", "google", "unavailable"]), googleVerified: z.boolean() });
export const totpSetupResponse = z.object({ secret: z.string(), uri: z.string() });
export const totpEnabledResponse = authSuccess.extend({ recoveryCodes: z.array(z.string()).length(10) });

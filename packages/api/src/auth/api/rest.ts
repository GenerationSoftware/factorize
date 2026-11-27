import { profileInput, profileResponse } from "./usernames";

import { consentPreviewInput, consentPreviewResponse, consentDecisionInput, consentDecisionResponse } from "../application/consent-api";

import { z } from "zod";

import { authInputs, authSuccess, continuationSuccess, connectionStartInput, connectionStartSuccess, connectionResumeInput, loginSuccess, sessionResponse, googleAvailability, googleStartResult, googlePendingResult, googleUsernameResult, totpStatusResponse, totpSetupResponse, totpEnabledResponse } from "./account-contracts";

import { route, authRoute, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

export const authRoutes = [
  authRoute("POST", "/api/v1/auth/connections", "connection-start", "Persist an individual validated MCP connection; sets a per-attempt browser cookie", connectionStartSuccess, connectionStartInput),
  authRoute("POST", "/api/v1/auth/connections/resume", "connection-resume", "Resume verified onboarding in the initiating browser; never grants OAuth access", continuationSuccess, connectionResumeInput),
  {...authRoute("GET", "/api/v1/profile", "profile", "Read your profile; interactive owner browser session required", profileResponse),ownerSession:true},
  {...authRoute("PUT", "/api/v1/profile", "profile-update", "Change your globally unique username; interactive owner browser session required", profileResponse, profileInput),ownerSession:true},
  authRoute("GET", "/api/v1/session", "session", "Get current browser session", sessionResponse),
  authRoute("GET", "/api/v1/auth/google", "google-available", "Check whether Google sign-in is configured", googleAvailability),
  authRoute("POST", "/api/v1/auth/google/start", "google-start", "Start browser-bound Google sign-in", googleStartResult, authInputs.googleStart),
  authRoute("GET", "/api/v1/auth/google/pending", "google-pending", "Read Google signup or linking steps for the current browser", googlePendingResult),
  authRoute("POST", "/api/v1/auth/google/email/request", "google-email-request", "Send a verification link for a new Google signup", authSuccess),
  authRoute("POST", "/api/v1/auth/google/email/verify", "google-email-verify", "Verify the signup email in the initiating browser", authSuccess, authInputs.verify),
  authRoute("POST", "/api/v1/auth/google/username", "google-username", "Check username availability during Google signup", googleUsernameResult, authInputs.googleUsername),
  authRoute("POST", "/api/v1/auth/google/password/complete", "google-password-complete", "Set the Factorize password with fresh Google proof and email confirmation", loginSuccess, authInputs.reset),
  authRoute("POST", "/api/v1/auth/google/finish", "google-finish", "Choose a username or confirm your existing Factorize password", loginSuccess, authInputs.googleFinish),
  {...authRoute("POST", "/api/v1/auth/password/set-request", "password-set-request", "Start fresh Google verification before setting or recovering a password", googleStartResult),ownerSession:true},
  {...authRoute("GET", "/api/v1/auth/two-factor", "totp-status", "Read your two-factor settings", totpStatusResponse), ownerSession:true},
  {...authRoute("POST", "/api/v1/auth/two-factor/google", "totp-google", "Confirm a linked Google account for a two-factor settings change", googleStartResult), ownerSession:true},
  {...authRoute("POST", "/api/v1/auth/two-factor/enrollment", "totp-begin", "Create a short-lived authenticator setup secret", totpSetupResponse, authInputs.totpBegin), ownerSession:true},
  {...authRoute("POST", "/api/v1/auth/two-factor/enable", "totp-enable", "Enable two-factor authentication and show recovery codes once", totpEnabledResponse, authInputs.totpEnroll), ownerSession:true},
  {...authRoute("POST", "/api/v1/auth/two-factor/disable", "totp-disable", "Disable two-factor authentication using primary and second factors", authSuccess, authInputs.totpDisable), ownerSession:true},
  authRoute("POST", "/api/v1/auth/two-factor/challenge", "totp-challenge", "Finish a browser sign-in using a fresh authenticator or recovery code", loginSuccess, authInputs.totpCode),
  authRoute("POST", "/api/v1/auth/login", "login", "Sign in", loginSuccess, authInputs.login),
  authRoute("POST", "/api/v1/auth/signup", "signup", "Request signup; existing accounts return the same accepted response", authSuccess, authInputs.signup, 202),
  authRoute("POST", "/api/v1/auth/email-verification/request", "verification-request", "Request email verification", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/email-verification/complete", "verification", "Verify email, establish an owner session, and resume explicit consent; callbacks stay in the initiating browser", continuationSuccess, authInputs.verify),
  authRoute("POST", "/api/v1/auth/password-reset/request", "reset-request", "Request password reset", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/password-reset/complete", "reset", "Complete password reset and resume onboarding", continuationSuccess, authInputs.reset),
  authRoute("POST", "/api/v1/auth/password", "password", "Change password and invalidate sessions", authSuccess, authInputs.change),
  authRoute("POST", "/api/v1/auth/logout", "logout", "Revoke current session and clear browser cookie", authSuccess),
  route("POST", "/api/v1/oauth/device/preview", "triggers:read", { summary: "Inspect a device authorization code", responses: { "200": { description: "Pending device request", content: { "application/json": { schema: jsonSchema(z.object({ userCode: z.string(), clientName: z.string(), scopes: z.array(z.string()), expiresAt: z.string(), signature: z.string(), integrationLabels: z.array(z.object({scope:z.string(),name:z.string(),description:z.string().nullable()})).optional() }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32) }).strict(), authOperation: "device-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/device/decision", "triggers:write", { summary: "Approve or deny a device authorization code", responses: { "200": { description: "Device decision", content: { "application/json": { schema: jsonSchema(z.object({ status: z.enum(["approved", "denied"]) }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]) }).strict(), authOperation: "device-decision", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/preview", "triggers:read", { summary: "Inspect an OAuth consent request", responses: { "200": { description: "Owner-bound expiring consent", content: { "application/json": { schema: jsonSchema(consentPreviewResponse, "output") } } } } }, async () => undefined, { body: consentPreviewInput, authOperation: "consent-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/decision", "triggers:write", { summary: "Decide an OAuth consent request", responses: { "200": { description: "Validated protocol destination", content: { "application/json": { schema: jsonSchema(consentDecisionResponse, "output") } } } } }, async () => undefined, { body: consentDecisionInput, authOperation: "consent-decision", ownerSession: true }),
] satisfies RouteContract[];

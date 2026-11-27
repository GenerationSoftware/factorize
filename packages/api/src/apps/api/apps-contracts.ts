import { z } from "zod";

const redirectUri = z.string().max(2048).refine(value => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) &&
      !parsed.username && !parsed.password && !value.includes("#");
  } catch {
    return false;
  }
}, "Use an HTTPS callback URL, or an HTTP loopback URL for local development.");

export const appRegistrationInput = z.object({
  name: z.string().trim().min(1).max(100),
  redirectUris: z.array(redirectUri).min(1).max(10).refine(values => new Set(values).size === values.length),
  public: z.boolean().default(false),
}).strict();

export const appRegistrationUpdate = appRegistrationInput.extend({ enabled: z.boolean() });
export const registeredApp = z.object({
  id: z.uuid(),
  name: z.string(),
  redirectUris: z.array(z.string()),
  public: z.boolean(),
  enabled: z.boolean(),
  secretConfigured: z.boolean(),
});
export const appSecret = z.object({ clientId: z.uuid(), clientSecret: z.string() });
export const connectedApp = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  name: z.string(),
  scopes: z.array(z.string()),
  authorizedAt: z.iso.datetime(),
});

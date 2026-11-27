import { z } from "zod";

export const flyConnectionInput = z.object({
  token: z.string().trim().min(1).max(4096).meta({ writeOnly: true }),
  organizationSlug: z.string().trim().min(1).max(63).regex(/^[a-z0-9-]+$/),
}).strict();

export const flyConnectionMetadata = z.object({
  organizationSlug: z.string(),
  organizationName: z.string(),
});

export class FlyAccountError extends Error {
  constructor(readonly kind: "auth" | "organization" | "unavailable" | "invalid_response") {
    super(kind === "auth" ? "Fly authentication failed" : kind === "organization" ? "Fly organization is unavailable to this token" : kind === "unavailable" ? "Fly could not validate the account right now" : "Fly returned an invalid account response");
    this.name = "FlyAccountError";
  }
}

type FlyAccountOptions = { apiOrigin?: string; timeoutMs?: number; fetch?: typeof fetch };

/** Validates an org-scoped Fly token using the documented read-only current-token endpoint. */
export function createFlyAccountClient(options: FlyAccountOptions = {}) {
  const origin = (options.apiOrigin ?? "https://api.machines.dev").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const fetchImpl = options.fetch ?? fetch;
  return {
    async validate(token: string, organizationSlug: string): Promise<{ organizationSlug: string; organizationName: string }> {
      let response: Response;
      try {
        response = await fetchImpl(`${origin}/v1/tokens/current`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new FlyAccountError("unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new FlyAccountError("auth");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new FlyAccountError("unavailable");
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new FlyAccountError("invalid_response"); }
      const parsed = z.object({ tokens: z.array(z.object({ org_slug: z.string(), organization: z.string().optional() }).passthrough()) }).safeParse(body);
      if (!parsed.success) throw new FlyAccountError("invalid_response");
      const organization = parsed.data.tokens.find(item => item.org_slug.toLowerCase() === organizationSlug.toLowerCase());
      if (!organization) throw new FlyAccountError("organization");
      return { organizationSlug: organization.org_slug, organizationName: organization.organization?.trim() || organization.org_slug };
    },
  };
}

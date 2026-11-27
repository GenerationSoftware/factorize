import type { Context } from "hono";
import type { Env } from "../../config/bindings";
import { databaseFor } from "../../postgres/database";
import { IdentityRepository } from "../storage/identity-repository";
import { readBrowserSession } from "../application/browser-session";
import type { Session } from "../application/session";

export async function browserOwner(c: Context<{ Bindings: Env; Variables: { authorizationDuration: number } }>): Promise<Session | null> {
  const started = performance.now();
  try {
    const session = await readBrowserSession(c.req.raw, c.env); if (!session) return null;
    const member = await new IdentityRepository(databaseFor(c.env), session.tenantId).member(session.userId);
    return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? session : null;
  } finally { c.set("authorizationDuration", (c.get("authorizationDuration") ?? 0) + performance.now() - started); }
}

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export class GitHubInstallationRegistryV2 extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS installations (installation_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, account_login TEXT NOT NULL, account_type TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), installationId = Number(url.pathname.split("/")[2]);
    if (!Number.isSafeInteger(installationId)) return new Response("Invalid installation", { status: 400 });
    const row = [...this.ctx.storage.sql.exec("SELECT * FROM installations WHERE installation_id = ?", installationId)][0] as any;
    if (request.method === "GET") return row ? Response.json(row) : new Response("Not found", { status: 404 });
    if (request.method === "PUT") {
      const value = await request.json() as any;
      if (!value.tenantId) return new Response("Missing tenant", { status: 400 });
      if (row && row.tenant_id !== value.tenantId) return new Response("Installation belongs to another tenant", { status: 409 });
      this.ctx.storage.sql.exec("INSERT INTO installations VALUES (?,?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET account_login=excluded.account_login,account_type=excluded.account_type,state=excluded.state,updated_at=excluded.updated_at", installationId, value.tenantId, value.accountLogin ?? "", value.accountType ?? "", value.state ?? "active", new Date().toISOString());
      return Response.json({ ok: true });
    }
    if (request.method === "PATCH" && row) { const { state } = await request.json() as any; this.ctx.storage.sql.exec("UPDATE installations SET state=?,updated_at=? WHERE installation_id=?", state, new Date().toISOString(), installationId); return Response.json({ ok: true }); }
    if (request.method === "DELETE" && row) { this.ctx.storage.sql.exec("DELETE FROM installations WHERE installation_id=?", installationId); return Response.json({ ok: true, tenantId: row.tenant_id }); }
    return new Response("Not found", { status: 404 });
  }
}

/** @deprecated Retained only until the Phase 2 namespace-retirement deployment. */
export class GitHubInstallationRegistry extends DurableObject<Env> {}

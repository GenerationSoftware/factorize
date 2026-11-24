import { readFile } from "node:fs/promises";
import { Database } from "../../src/postgres/database";
import { IdentityRepository } from "../../src/postgres/identity-repository";
import { signSession } from "../../src/session";
import { cloneTestDatabase } from "../../../../scripts/test-database.mjs";
import type { Env, OAuthProps } from "../../src/types";

export async function loadingFixture(url: string) {
  const fixture = await cloneTestDatabase(url);
  const db = new Database({ connectionString: fixture.url });
  let env!: Env, auth!: OAuthProps, cookie!: string;
  let tearingDown = false;
  let unexpectedPoolError: Error | undefined;
  const tenantId = crypto.randomUUID(), userId = crypto.randomUUID(), otherTenant = crypto.randomUUID();
  async function setup() {
    db.pool.on("error", error => {
      if (tearingDown && (error as NodeJS.ErrnoException).code === "57P01") return;
      unexpectedPoolError = error;
    });
    env = { ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path !== "/index.html" && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) return new Response("Not found", { status: 404 });
      try { return new Response(request.method === "HEAD" ? null : await readFile(new URL("../../../app/dist" + path, import.meta.url)), { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : path.endsWith(".ico") ? "image/x-icon" : "text/html" } }); }
      catch { return new Response("Not found", { status: 404 }); }
    } } as unknown as Fetcher, DATABASE: db, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "local-test-signing", OAUTH_PROVIDER: { listUserGrants: async () => ({ items: [] }) } as any, CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32)) } as Env;
    await new IdentityRepository(db, tenantId).upsertOwner(userId, "owner@example.test");
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [otherTenant]);
    auth = { tenantId, userId, sessionVersion: 0, scopes: ["team:read", "triggers:read", "integrations:read", "team:write", "triggers:write", "integrations:write"], authMethod: "session" };
    const member = await new IdentityRepository(db, tenantId).member(userId); auth.sessionVersion = member!.sessionVersion;
    cookie = `factorize_session=${await signSession({ ...auth, email: "owner@example.test", exp: Math.floor(Date.now()/1000)+3600 }, env.SESSION_SIGNING_SECRET)}`;
  }

  async function seedEventTrigger(tenant = tenantId, triggerId = crypto.randomUUID()) {
    const definitionId = crypto.randomUUID();
    await db.transaction(async sql => {
      await sql.query("INSERT INTO app.event_definitions(tenant_id,id,name,current_revision) VALUES ($1,$2,'fixture-event',1)", [tenant, definitionId]);
      await sql.query("INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema) VALUES ($1,$2,1,$3)", [tenant, definitionId, { type: "object" }]);
      await sql.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES ($1,$2,$3,'Fixture trigger','fixture-trigger')", [tenant, triggerId, definitionId]);
      await sql.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config)
        VALUES ($1,$2,$4,'manual','manual',0,'{}'),
               ($1,$3,$4,'schedule','schedule',1,'{"cron":"0 * * * *","timezone":"UTC"}')`,
      [tenant, crypto.randomUUID(), crypto.randomUUID(), triggerId]);
    });
    return { triggerId, definitionId };
  }

  async function cleanup() {
    tearingDown = true;
    try {
      await db.close();
    } finally {
      await fixture.close();
    }
    if (unexpectedPoolError) throw unexpectedPoolError;
  }

  async function request(path: string, value = cookie) {
    const { default: worker } = await import("../../src/worker");
    return worker.fetch(new Request(`https://factorize.test${path}`, { headers: { Cookie: value } }), env, { waitUntil() {} } as any);
  }

  try { await setup(); } catch (error) { await cleanup(); throw error; }
  return { db, env, auth, cookie, seedEventTrigger, tenantId, userId, otherTenant, request, cleanup };
}
